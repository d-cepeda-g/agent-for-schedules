import { NextRequest, NextResponse } from "next/server";
import {
  type Coordinate,
  type TravelMode,
  getDistanceKm,
  getProviderById,
  getTravelMinutes,
} from "@/lib/provider-directory";
import { requireToolApiKey } from "@/lib/tool-auth";

type DistanceScoreBody = {
  origin?: unknown;
  origin_lat?: unknown;
  origin_lng?: unknown;
  provider_ids?: unknown;
  provider_ids_csv?: unknown;
  providers?: unknown;
  travel_mode?: unknown;
  distance_weight?: unknown;
};

type ProviderCandidate = {
  id: string;
  location: Coordinate;
};

function parseOrigin(origin: unknown): Coordinate | null {
  if (!origin || typeof origin !== "object") return null;
  const record = origin as Record<string, unknown>;
  if (typeof record.lat !== "number" || typeof record.lng !== "number") return null;
  return { lat: record.lat, lng: record.lng };
}

function parseOriginFromFlatInput(lat: unknown, lng: unknown): Coordinate | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function parseTravelMode(value: unknown): TravelMode {
  if (value === "walking" || value === "transit") return value;
  return "driving";
}

function toProviderCandidates(
  providerIds: unknown,
  providerIdsCsv: unknown,
  providers: unknown
): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [];

  if (Array.isArray(providerIds)) {
    for (const providerId of providerIds) {
      if (typeof providerId !== "string") continue;
      const provider = getProviderById(providerId);
      if (!provider) continue;
      candidates.push({
        id: provider.id,
        location: provider.location,
      });
    }
  }

  if (typeof providerIds === "string") {
    const ids = providerIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const providerId of ids) {
      const provider = getProviderById(providerId);
      if (!provider) continue;
      candidates.push({
        id: provider.id,
        location: provider.location,
      });
    }
  }

  if (typeof providerIdsCsv === "string") {
    const ids = providerIdsCsv
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const providerId of ids) {
      const provider = getProviderById(providerId);
      if (!provider) continue;
      candidates.push({
        id: provider.id,
        location: provider.location,
      });
    }
  }

  if (Array.isArray(providers)) {
    for (const providerInput of providers) {
      if (!providerInput || typeof providerInput !== "object") continue;
      const record = providerInput as Record<string, unknown>;
      if (typeof record.id !== "string") continue;

      const lat = typeof record.lat === "number" ? record.lat : null;
      const lng = typeof record.lng === "number" ? record.lng : null;
      if (lat !== null && lng !== null) {
        candidates.push({
          id: record.id,
          location: { lat, lng },
        });
        continue;
      }

      const provider = getProviderById(record.id);
      if (!provider) continue;
      candidates.push({
        id: provider.id,
        location: provider.location,
      });
    }
  }

  const uniqueById = new Map<string, ProviderCandidate>();
  for (const candidate of candidates) {
    uniqueById.set(candidate.id, candidate);
  }

  return [...uniqueById.values()];
}

function getDistanceScore(distanceKm: number, weight: number): number {
  const normalizedWeight = Number.isFinite(weight) && weight > 0 ? weight : 1;
  const score = 100 / (1 + distanceKm * normalizedWeight);
  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

export async function POST(request: NextRequest) {
  const unauthorized = requireToolApiKey(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => null)) as DistanceScoreBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const origin =
    parseOrigin(body.origin) ||
    parseOriginFromFlatInput(body.origin_lat, body.origin_lng);
  if (!origin) {
    return NextResponse.json(
      {
        error:
          "Provide origin as {lat, lng} or origin_lat/origin_lng as numbers",
      },
      { status: 400 }
    );
  }

  const candidates = toProviderCandidates(
    body.provider_ids,
    body.provider_ids_csv,
    body.providers
  );
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "At least one valid provider candidate is required" },
      { status: 400 }
    );
  }

  const travelMode = parseTravelMode(body.travel_mode);
  const distanceWeight =
    typeof body.distance_weight === "number" ? body.distance_weight : 1;

  const scores = candidates.map((candidate) => {
    const distanceKm = getDistanceKm(origin, candidate.location);
    const travelMinutes = getTravelMinutes(distanceKm, travelMode);
    return {
      provider_id: candidate.id,
      distance_km: Number(distanceKm.toFixed(2)),
      travel_minutes: travelMinutes,
      distance_score: getDistanceScore(distanceKm, distanceWeight),
    };
  });

  scores.sort((left, right) => {
    if (left.distance_score !== right.distance_score) {
      return right.distance_score - left.distance_score;
    }
    return left.travel_minutes - right.travel_minutes;
  });

  return NextResponse.json({
    origin,
    travel_mode: travelMode,
    scores,
  });
}
