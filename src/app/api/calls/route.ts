import { NextRequest, NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { db } from "@/lib/db";
import {
  isCallStatus,
  normalizeOptionalString,
  normalizeRequiredString,
  parseDateInput,
} from "@/lib/validation";

const DUPLICATE_SCHEDULE_WINDOW_MS = 60_000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function parsePageSize(value: string | null): number {
  const parsed = parsePositiveInt(value);
  if (!parsed) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const customerId = searchParams.get("customerId");
    const batchId = searchParams.get("batchId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const page = parsePositiveInt(searchParams.get("page"));
    const paginationRequested =
      searchParams.has("page") || searchParams.has("pageSize");

    const where: Record<string, unknown> = {};
    if (status) {
      if (!isCallStatus(status)) {
        return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
      }
      where.status = status;
    }

    if (customerId) where.customerId = customerId;
    if (batchId) where.batchId = batchId;

    if (from || to) {
      const fromDate = from ? parseDateInput(from) : null;
      const toDate = to ? parseDateInput(to) : null;

      if (from && !fromDate) {
        return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
      }
      if (to && !toDate) {
        return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
      }

      where.scheduledAt = {
        ...(fromDate && { gte: fromDate }),
        ...(toDate && { lte: toDate }),
      };
    }

    if (paginationRequested) {
      const safePage = page ?? 1;
      const pageSize = parsePageSize(searchParams.get("pageSize"));
      const skip = (safePage - 1) * pageSize;

      const [total, calls] = await Promise.all([
        db.scheduledCall.count({ where }),
        db.scheduledCall.findMany({
          where,
          orderBy: { scheduledAt: "desc" },
          skip,
          take: pageSize,
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            evaluation: { select: { id: true, result: true } },
          },
        }),
      ]);

      return NextResponse.json({
        items: calls,
        page: safePage,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }

    const calls = await db.scheduledCall.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        evaluation: { select: { id: true, result: true } },
      },
    });

    return NextResponse.json(calls);
  } catch (error) {
    console.error("[calls:GET]", error);
    return NextResponse.json({ error: "Failed to fetch calls" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const customerId = normalizeRequiredString(body.customerId);
    const scheduledAt = parseDateInput(body.scheduledAt);
    const notes = normalizeOptionalString(body.notes) ?? "";
    const callReason = normalizeOptionalString(body.callReason) ?? "";
    const callPurpose = normalizeOptionalString(body.callPurpose) ?? "";
    const preferredLanguageFromBody = normalizeOptionalString(body.preferredLanguage);

    if (!customerId || !scheduledAt) {
      return NextResponse.json(
        { error: "customerId and scheduledAt are required" },
        { status: 400 }
      );
    }

    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!agentId) {
      return NextResponse.json(
        { error: "ELEVENLABS_AGENT_ID is not configured" },
        { status: 500 }
      );
    }

    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const duplicate = await db.scheduledCall.findFirst({
      where: {
        customerId,
        scheduledAt: {
          gte: new Date(scheduledAt.getTime() - DUPLICATE_SCHEDULE_WINDOW_MS),
          lte: new Date(scheduledAt.getTime() + DUPLICATE_SCHEDULE_WINDOW_MS),
        },
        callReason,
        callPurpose,
        notes,
        status: { in: ["pending", "dispatching", "dispatched", "completed", "failed"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    if (duplicate) {
      await createCallLogSafe({
        scheduledCallId: duplicate.id,
        event: "schedule_deduplicated",
        message: "Duplicate schedule request ignored",
        details: {
          customerId: duplicate.customer.id,
          scheduledAt: duplicate.scheduledAt.toISOString(),
        },
      });
      return NextResponse.json(duplicate, { status: 200 });
    }

    const call = await db.scheduledCall.create({
      data: {
        customerId,
        scheduledAt,
        notes,
        callReason,
        callPurpose,
        preferredLanguage:
          preferredLanguageFromBody && preferredLanguageFromBody.length > 0
            ? preferredLanguageFromBody
            : customer.preferredLanguage || "English",
        agentId,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "scheduled",
      message: `Call scheduled for ${call.customer.name}`,
      details: {
        customerId: call.customer.id,
        scheduledAt: call.scheduledAt.toISOString(),
        callReason: call.callReason,
        preferredLanguage: call.preferredLanguage,
      },
    });

    return NextResponse.json(call, { status: 201 });
  } catch (error) {
    console.error("[calls:POST]", error);
    return NextResponse.json({ error: "Failed to schedule call" }, { status: 500 });
  }
}
