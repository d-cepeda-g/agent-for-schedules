import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  type Coordinate,
  getDistanceKm,
  getProviderDirectory,
  getTravelMinutes,
} from "@/lib/provider-directory";

const DEFAULT_TOP = 5;
const MAX_TOP = 15;

const DEFAULT_WEIGHTS = {
  availability: 0.6,
  rating: 0.3,
  distance: 0.1,
};

type Params = { params: Promise<{ batchId: string }> };

type CallWithArtifacts = Prisma.ScheduledCallGetPayload<{
  include: {
    customer: true;
    evaluation: true;
    actionItems: true;
  };
}>;

function parseBoundedInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseBoundedFloat(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseOrigin(searchParams: URLSearchParams): Coordinate | null {
  const latRaw = searchParams.get("origin_lat");
  const lngRaw = searchParams.get("origin_lng");
  if (!latRaw || !lngRaw) return null;

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function normalizeWeights(input: {
  availability: number;
  rating: number;
  distance: number;
}) {
  const availability = Math.max(0, input.availability);
  const rating = Math.max(0, input.rating);
  const distance = Math.max(0, input.distance);
  const total = availability + rating + distance;

  if (total <= 0) {
    return { ...DEFAULT_WEIGHTS };
  }

  return {
    availability: availability / total,
    rating: rating / total,
    distance: distance / total,
  };
}

function extractDatesFromText(text: string): Date[] {
  if (!text.trim()) return [];

  const candidates: Date[] = [];
  const isoMatches =
    text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g) ||
    [];

  for (const match of isoMatches) {
    const parsed = new Date(match);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push(parsed);
    }
  }

  const segments = text
    .split(/[\n,;|]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const parsed = new Date(segment);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push(parsed);
    }
  }

  const deduplicatedByTime = new Map<number, Date>();
  for (const candidate of candidates) {
    deduplicatedByTime.set(candidate.getTime(), candidate);
  }

  return [...deduplicatedByTime.values()];
}

function extractEarliestAvailability(call: CallWithArtifacts): Date | null {
  const actionableItems = call.actionItems.filter((item) => {
    const searchable = `${item.key} ${item.title}`.toLowerCase();
    return (
      searchable.includes("slot") ||
      searchable.includes("time") ||
      searchable.includes("date") ||
      searchable.includes("available") ||
      searchable.includes("appointment")
    );
  });

  const detailsToScan = [
    ...actionableItems.map((item) => item.detail),
    ...call.actionItems.map((item) => item.detail),
    call.evaluation?.transcript || "",
  ];

  const now = Date.now();
  const oldestAllowed = now - 7 * 24 * 60 * 60 * 1000;
  const newestAllowed = now + 365 * 24 * 60 * 60 * 1000;

  const candidates = detailsToScan
    .flatMap((detail) => extractDatesFromText(detail))
    .filter((date) => {
      const time = date.getTime();
      return time >= oldestAllowed && time <= newestAllowed;
    })
    .sort((left, right) => left.getTime() - right.getTime());

  return candidates[0] || null;
}

function getAvailabilityScore(earliestAvailability: Date | null): number {
  if (!earliestAvailability) return 0;

  const hoursUntil = (earliestAvailability.getTime() - Date.now()) / 3_600_000;
  if (hoursUntil <= 0) return 100;

  return Number(Math.max(0, Math.min(100, 100 - hoursUntil / 4)).toFixed(2));
}

function getRatingScore(rating: number | null): number {
  if (rating === null) return 50;
  return Number(Math.max(0, Math.min(100, (rating / 5) * 100)).toFixed(2));
}

function getDistanceScore(distanceKm: number | null): number {
  if (distanceKm === null) return 50;
  return Number(Math.max(0, Math.min(100, 100 - distanceKm * 8)).toFixed(2));
}

export async function GET(request: NextRequest, { params }: Params) {
  const { batchId } = await params;
  if (!batchId || batchId.trim().length === 0) {
    return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  }

  const calls = await db.scheduledCall.findMany({
    where: { batchId },
    include: {
      customer: true,
      evaluation: true,
      actionItems: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (calls.length === 0) {
    return NextResponse.json(
      { error: `No calls found for batchId '${batchId}'` },
      { status: 404 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const top = parseBoundedInt(searchParams.get("top"), DEFAULT_TOP, 1, MAX_TOP);
  const origin = parseOrigin(searchParams);
  const weights = normalizeWeights({
    availability: parseBoundedFloat(
      searchParams.get("availability_weight"),
      DEFAULT_WEIGHTS.availability,
      0,
      10
    ),
    rating: parseBoundedFloat(
      searchParams.get("rating_weight"),
      DEFAULT_WEIGHTS.rating,
      0,
      10
    ),
    distance: parseBoundedFloat(
      searchParams.get("distance_weight"),
      DEFAULT_WEIGHTS.distance,
      0,
      10
    ),
  });

  const providerDirectory = getProviderDirectory();
  const providerByPhone = new Map(
    providerDirectory.map((provider) => [provider.phone, provider])
  );

  const ranked = calls
    .map((call) => {
      const provider = providerByPhone.get(call.customer.phone) || null;
      const rating = provider?.rating ?? null;
      const distanceKm =
        origin && provider
          ? Number(getDistanceKm(origin, provider.location).toFixed(2))
          : null;
      const travelMinutes =
        distanceKm !== null ? getTravelMinutes(distanceKm, "driving") : null;
      const earliestAvailability = extractEarliestAvailability(call);
      const availabilityScore = getAvailabilityScore(earliestAvailability);
      const ratingScore = getRatingScore(rating);
      const distanceScore = getDistanceScore(distanceKm);

      const finalScore = Number(
        (
          availabilityScore * weights.availability +
          ratingScore * weights.rating +
          distanceScore * weights.distance
        ).toFixed(2)
      );

      return {
        call_id: call.id,
        conversation_id: call.conversationId || null,
        status: call.status,
        provider: {
          id: provider?.id || null,
          name: call.customer.name,
          phone: call.customer.phone,
          rating,
          review_count: provider?.reviewCount || null,
        },
        metrics: {
          earliest_availability: earliestAvailability?.toISOString() || null,
          availability_score: availabilityScore,
          rating_score: ratingScore,
          distance_km: distanceKm,
          travel_minutes: travelMinutes,
          distance_score: distanceScore,
          final_score: finalScore,
        },
        evaluation: call.evaluation
          ? {
              result: call.evaluation.result,
              rationale: call.evaluation.rationale,
            }
          : null,
        action_items: call.actionItems.map((item) => ({
          key: item.key,
          title: item.title,
          detail: item.detail,
        })),
      };
    })
    .sort((left, right) => {
      if (right.metrics.final_score !== left.metrics.final_score) {
        return right.metrics.final_score - left.metrics.final_score;
      }

      const leftAvailability = left.metrics.earliest_availability
        ? new Date(left.metrics.earliest_availability).getTime()
        : Number.POSITIVE_INFINITY;
      const rightAvailability = right.metrics.earliest_availability
        ? new Date(right.metrics.earliest_availability).getTime()
        : Number.POSITIVE_INFINITY;
      return leftAvailability - rightAvailability;
    });

  const completed = calls.filter((call) => call.status === "completed").length;
  const failed = calls.filter((call) => call.status === "failed").length;

  return NextResponse.json({
    batch_id: batchId,
    total_calls: calls.length,
    completed_calls: completed,
    failed_calls: failed,
    in_progress_calls: calls.length - completed - failed,
    weights,
    top_shortlist: ranked.slice(0, Math.min(top, ranked.length)),
    ranked_calls: ranked,
  });
}
