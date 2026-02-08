import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithConcurrency } from "@/lib/async-concurrency";
import { dispatchScheduledCall } from "@/lib/calls";
import { db } from "@/lib/db";
import {
  type Coordinate,
  type ProviderRecord,
  type TravelMode,
  getDistanceKm,
  getTravelMinutes,
  searchProviders,
} from "@/lib/provider-directory";
import { parseDateInput } from "@/lib/validation";

const DEFAULT_MAX_PROVIDERS = 15;
const HARD_MAX_PROVIDERS = 15;
const DEFAULT_CONCURRENCY = 15;

type SwarmBody = Record<string, unknown>;

type ProviderCandidate = ProviderRecord & {
  distanceKm: number | null;
  travelMinutes: number | null;
  preCallScore: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(body: SwarmBody, keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function readNumber(body: SwarmBody, keys: string[]): number | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readBoolean(body: SwarmBody, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return fallback;
}

function parseBoundedInt(
  value: number | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null) return fallback;
  const parsed = Math.floor(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseOrigin(body: SwarmBody): Coordinate | null {
  const originRecord = asRecord(body.origin);
  if (originRecord) {
    const lat = originRecord.lat;
    const lng = originRecord.lng;
    if (
      typeof lat === "number" &&
      Number.isFinite(lat) &&
      typeof lng === "number" &&
      Number.isFinite(lng)
    ) {
      return { lat, lng };
    }
  }

  const flatLat = readNumber(body, ["origin_lat", "originLat"]);
  const flatLng = readNumber(body, ["origin_lng", "originLng"]);
  if (flatLat !== null && flatLng !== null) {
    return { lat: flatLat, lng: flatLng };
  }

  return null;
}

function parseTravelMode(value: unknown): TravelMode {
  if (value === "walking" || value === "transit") return value;
  return "driving";
}

function getDistanceScore(distanceKm: number | null): number {
  if (distanceKm === null) return 50;
  return Number(Math.max(0, Math.min(100, 100 - distanceKm * 8)).toFixed(2));
}

function getPreCallScore(provider: ProviderRecord, distanceKm: number | null): number {
  const ratingScore = (provider.rating / 5) * 100;
  const reviewScore = Math.min(100, Math.log10(provider.reviewCount + 1) * 35);
  const distanceScore = getDistanceScore(distanceKm);

  return Number(
    (ratingScore * 0.6 + reviewScore * 0.2 + distanceScore * 0.2).toFixed(2)
  );
}

function buildProviderContext(
  provider: ProviderCandidate,
  campaignId: string,
  userNotes: string
): string {
  const lines = [
    `Swarm campaign ID: ${campaignId}`,
    `Provider ID: ${provider.id}`,
    `Provider name: ${provider.name}`,
    `Provider phone: ${provider.phone}`,
    `Provider rating: ${provider.rating} (${provider.reviewCount} reviews)`,
    provider.distanceKm !== null ? `Distance (km): ${provider.distanceKm}` : "",
    provider.travelMinutes !== null
      ? `Estimated travel time (minutes): ${provider.travelMinutes}`
      : "",
    `Pre-call score: ${provider.preCallScore}`,
    userNotes ? `User request context: ${userNotes}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

async function getOrCreateProviderCustomerId(provider: ProviderRecord): Promise<string> {
  const existing = await db.customer.findFirst({
    where: {
      name: provider.name,
      phone: provider.phone,
    },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await db.customer.create({
    data: {
      name: provider.name,
      phone: provider.phone,
      notes: `Provider contact (${provider.city})`,
      preferredLanguage: "English",
    },
    select: { id: true },
  });

  return created.id;
}

export async function POST(request: NextRequest) {
  if (
    !process.env.ELEVENLABS_API_KEY ||
    !process.env.ELEVENLABS_AGENT_ID ||
    !process.env.ELEVENLABS_PHONE_NUMBER_ID
  ) {
    return NextResponse.json(
      { error: "ElevenLabs environment variables are not configured" },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as SwarmBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const serviceType = readString(body, ["service_type", "serviceType"]);
  if (!serviceType) {
    return NextResponse.json(
      { error: "service_type is required" },
      { status: 400 }
    );
  }

  const location = readString(body, ["location"]);
  const minRatingRaw = readNumber(body, ["min_rating", "minRating"]);
  const minRating =
    minRatingRaw === null ? 0 : Math.max(0, Math.min(Number(minRatingRaw), 5));

  const maxProviders = parseBoundedInt(
    readNumber(body, ["max_providers", "maxProviders"]),
    DEFAULT_MAX_PROVIDERS,
    1,
    HARD_MAX_PROVIDERS
  );

  const dispatchNow = readBoolean(body, ["dispatch_now", "dispatchNow"], true);
  const preferredLanguage =
    readString(body, ["preferred_language", "preferredLanguage"]) || "English";
  const userNotes = readString(body, ["notes", "request_summary", "requestSummary"]);
  const travelMode = parseTravelMode(
    body.travel_mode ?? body.travelMode ?? "driving"
  );
  const origin = parseOrigin(body);
  const concurrency = parseBoundedInt(
    readNumber(body, ["concurrency"]),
    DEFAULT_CONCURRENCY,
    1,
    Math.min(HARD_MAX_PROVIDERS, maxProviders)
  );

  const scheduledAtInput = body.scheduled_at ?? body.scheduledAt;
  const requestedScheduledAt = parseDateInput(scheduledAtInput);
  const scheduledAt = dispatchNow ? new Date() : requestedScheduledAt || new Date();

  const callReason =
    readString(body, ["call_reason", "callReason"]) ||
    `Swarm outreach for ${serviceType}`;
  const callPurpose =
    readString(body, ["call_purpose", "callPurpose"]) ||
    `Request the earliest available ${serviceType} appointment slot and collect key details.`;
  const campaignName =
    readString(body, ["campaign_name", "campaignName"]) ||
    `${serviceType} swarm`;
  const campaignId = `swarm_${randomUUID()}`;

  const providers = searchProviders({
    serviceType,
    locationQuery: location,
    minRating,
    maxResults: maxProviders,
  });

  if (providers.length === 0) {
    return NextResponse.json(
      {
        error: "No providers matched the requested filters",
      },
      { status: 404 }
    );
  }

  const providerCandidates: ProviderCandidate[] = providers.map((provider) => {
    const distanceKm = origin ? getDistanceKm(origin, provider.location) : null;
    const travelMinutes =
      distanceKm === null ? null : getTravelMinutes(distanceKm, travelMode);

    return {
      ...provider,
      distanceKm: distanceKm === null ? null : Number(distanceKm.toFixed(2)),
      travelMinutes,
      preCallScore: getPreCallScore(provider, distanceKm),
    };
  });

  const scheduledCalls: Array<{
    callId: string;
    provider: ProviderCandidate;
  }> = [];

  for (const provider of providerCandidates) {
    const customerId = await getOrCreateProviderCustomerId(provider);
    const providerContext = buildProviderContext(provider, campaignId, userNotes);

    const call = await db.scheduledCall.create({
      data: {
        customerId,
        scheduledAt,
        status: "pending",
        agentId: process.env.ELEVENLABS_AGENT_ID || "",
        batchId: campaignId,
        callReason,
        callPurpose,
        preferredLanguage,
        notes: providerContext,
      },
      select: { id: true },
    });

    scheduledCalls.push({ callId: call.id, provider });
  }

  if (!dispatchNow) {
    return NextResponse.json({
      campaign_id: campaignId,
      campaign_name: campaignName,
      mode: "scheduled",
      service_type: serviceType,
      provider_count: scheduledCalls.length,
      scheduled_at: scheduledAt.toISOString(),
      calls: scheduledCalls
        .map((entry) => ({
          provider_id: entry.provider.id,
          provider_name: entry.provider.name,
          provider_phone: entry.provider.phone,
          rating: entry.provider.rating,
          review_count: entry.provider.reviewCount,
          distance_km: entry.provider.distanceKm,
          travel_minutes: entry.provider.travelMinutes,
          pre_call_score: entry.provider.preCallScore,
          call_id: entry.callId,
          status: "pending",
        }))
        .sort((left, right) => right.pre_call_score - left.pre_call_score),
    });
  }

  const dispatchAttempts = await runWithConcurrency(
    scheduledCalls,
    concurrency,
    async (entry) => {
      const result = await dispatchScheduledCall(entry.callId, {
        force: true,
        allowedStatuses: ["pending"],
      });

      if (result.ok) {
        return {
          callId: entry.callId,
          ok: true as const,
          status: result.call.status,
          conversationId: result.elevenlabs.conversation_id,
        };
      }

      return {
        callId: entry.callId,
        ok: false as const,
        status: "failed",
        error: result.error,
      };
    }
  );

  const attemptByCallId = new Map(dispatchAttempts.map((attempt) => [attempt.callId, attempt]));
  const calls = scheduledCalls
    .map((entry) => {
      const attempt = attemptByCallId.get(entry.callId);
      return {
        provider_id: entry.provider.id,
        provider_name: entry.provider.name,
        provider_phone: entry.provider.phone,
        rating: entry.provider.rating,
        review_count: entry.provider.reviewCount,
        distance_km: entry.provider.distanceKm,
        travel_minutes: entry.provider.travelMinutes,
        pre_call_score: entry.provider.preCallScore,
        call_id: entry.callId,
        status: attempt?.status || "pending",
        conversation_id: attempt?.ok ? attempt.conversationId : null,
        error: attempt && !attempt.ok ? attempt.error : null,
      };
    })
    .sort((left, right) => right.pre_call_score - left.pre_call_score);

  const dispatched = dispatchAttempts.filter((attempt) => attempt.ok).length;
  const failed = dispatchAttempts.length - dispatched;

  return NextResponse.json({
    campaign_id: campaignId,
    campaign_name: campaignName,
    mode: "dispatched",
    service_type: serviceType,
    provider_count: scheduledCalls.length,
    scheduled_at: scheduledAt.toISOString(),
    concurrency,
    summary: {
      created: scheduledCalls.length,
      dispatched,
      failed,
    },
    top_shortlist: calls.slice(0, Math.min(5, calls.length)),
    calls,
  });
}
