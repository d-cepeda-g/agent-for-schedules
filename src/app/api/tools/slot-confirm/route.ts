import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProviderById } from "@/lib/provider-directory";
import {
  type BusyWindow,
  collectConflicts,
  findNextAvailableStart,
  parseBusyWindowsInput,
  parseIsoDate,
  parsePositiveMinutes,
} from "@/lib/tool-calendar";
import { requireToolApiKey } from "@/lib/tool-auth";

type SlotConfirmBody = {
  provider_id?: unknown;
  provider_name?: unknown;
  provider_phone?: unknown;
  slot_start?: unknown;
  duration_minutes?: unknown;
  service_type?: unknown;
  notes?: unknown;
  busy_windows?: unknown;
  customer_id?: unknown;
  require_calendar_check?: unknown;
};

async function getScheduledCallWindows(
  customerId: string,
  durationMinutes: number
): Promise<BusyWindow[]> {
  const calls = await db.scheduledCall.findMany({
    where: {
      customerId,
      status: { notIn: ["cancelled", "failed"] },
    },
    select: {
      id: true,
      scheduledAt: true,
      status: true,
    },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });

  return calls.map((call) => ({
    start: call.scheduledAt,
    end: new Date(call.scheduledAt.getTime() + durationMinutes * 60_000),
    source: "scheduled_call",
    label: `Existing call (${call.status}) #${call.id}`,
  }));
}

export async function POST(request: NextRequest) {
  const unauthorized = requireToolApiKey(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => null)) as SlotConfirmBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slotStart = parseIsoDate(body.slot_start);
  if (!slotStart) {
    return NextResponse.json(
      { error: "slot_start must be a valid ISO date string" },
      { status: 400 }
    );
  }

  const durationMinutes = parsePositiveMinutes(body.duration_minutes, 60);
  const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

  const providerId =
    typeof body.provider_id === "string" && body.provider_id.trim().length > 0
      ? body.provider_id.trim()
      : "";
  const directoryProvider = providerId ? getProviderById(providerId) : null;
  if (providerId && !directoryProvider) {
    return NextResponse.json(
      { error: `provider_id '${providerId}' was not found in provider directory` },
      { status: 404 }
    );
  }

  const providerName =
    directoryProvider?.name ||
    (typeof body.provider_name === "string" ? body.provider_name.trim() : "");
  const providerPhone =
    directoryProvider?.phone ||
    (typeof body.provider_phone === "string" ? body.provider_phone.trim() : "");

  if (!providerName || !providerPhone) {
    return NextResponse.json(
      {
        error:
          "Provider details are incomplete. Provide a valid provider_id or provider_name/provider_phone.",
      },
      { status: 400 }
    );
  }

  const requireCalendarCheck = body.require_calendar_check !== false;
  if (requireCalendarCheck) {
    const busyWindows = parseBusyWindowsInput(body.busy_windows);
    if (typeof body.customer_id === "string" && body.customer_id.trim().length > 0) {
      const scheduledCallWindows = await getScheduledCallWindows(
        body.customer_id.trim(),
        durationMinutes
      );
      busyWindows.push(...scheduledCallWindows);
    }

    const conflicts = collectConflicts(slotStart, slotEnd, busyWindows);
    if (conflicts.length > 0) {
      const nextAvailableStart = findNextAvailableStart(
        slotStart,
        durationMinutes,
        busyWindows
      );

      return NextResponse.json({
        confirmed: false,
        reason: "Requested slot conflicts with existing calendar commitments",
        conflicts,
        next_available_start: nextAvailableStart?.toISOString() ?? null,
      });
    }
  }

  const serviceType =
    typeof body.service_type === "string" ? body.service_type.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const confirmationId = randomUUID();

  return NextResponse.json({
    confirmed: true,
    confirmation_id: confirmationId,
    provider: {
      id: directoryProvider?.id ?? null,
      name: providerName,
      phone: providerPhone,
      address: directoryProvider?.address ?? null,
      rating: directoryProvider?.rating ?? null,
    },
    slot_start: slotStart.toISOString(),
    slot_end: slotEnd.toISOString(),
    duration_minutes: durationMinutes,
    service_type: serviceType || null,
    notes: notes || null,
    summary: `Confirmed ${durationMinutes} minute appointment with ${providerName}`,
  });
}

