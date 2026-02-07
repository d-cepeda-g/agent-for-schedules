import { NextRequest, NextResponse } from "next/server";
import {
  type Coordinate,
  type TravelMode,
  getDistanceKm,
  getTravelMinutes,
  searchProviders,
} from "@/lib/provider-directory";
import { requireToolApiKey } from "@/lib/tool-auth";

type ProviderLookupBody = {
  service_type?: unknown;
  location?: unknown;
  min_rating?: unknown;
  max_results?: unknown;
  origin?: unknown;
  travel_mode?: unknown;
};

function parseOrigin(origin: unknown): Coordinate | null {
  if (!origin || typeof origin !== "object") return null;
  const record = origin as Record<string, unknown>;
  if (typeof record.lat !== "number" || typeof record.lng !== "number") {
    return null;
  }
  return { lat: record.lat, lng: record.lng };
}

function parseTravelMode(value: unknown): TravelMode {
  if (value === "walking" || value === "transit") return value;
  return "driving";
}

export async function POST(request: NextRequest) {
  const unauthorized = requireToolApiKey(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => null)) as ProviderLookupBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const serviceType = typeof body.service_type === "string" ? body.service_type : "";
  const locationQuery = typeof body.location === "string" ? body.location : "";
  const minRating = typeof body.min_rating === "number" ? body.min_rating : 0;
  const maxResults =
    typeof body.max_results === "number" && Number.isFinite(body.max_results)
      ? body.max_results
      : 5;
  const origin = parseOrigin(body.origin);
  const travelMode = parseTravelMode(body.travel_mode);

  const providers = searchProviders({
    serviceType,
    locationQuery,
    minRating,
    maxResults,
  }).map((provider) => {
    if (!origin) {
      return {
        id: provider.id,
        name: provider.name,
        phone: provider.phone,
        address: provider.address,
        city: provider.city,
        rating: provider.rating,
        review_count: provider.reviewCount,
        service_types: provider.serviceTypes,
        location: provider.location,
      };
    }

    const distanceKm = getDistanceKm(origin, provider.location);
    return {
      id: provider.id,
      name: provider.name,
      phone: provider.phone,
      address: provider.address,
      city: provider.city,
      rating: provider.rating,
      review_count: provider.reviewCount,
      service_types: provider.serviceTypes,
      location: provider.location,
      distance_km: Number(distanceKm.toFixed(2)),
      travel_minutes: getTravelMinutes(distanceKm, travelMode),
    };
  });

  return NextResponse.json({
    providers,
    count: providers.length,
  });
}

