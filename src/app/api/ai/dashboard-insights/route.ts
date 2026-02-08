import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createJsonCompletion, hasOpenAiApiKey } from "@/lib/openai";

type ProactiveAction = {
  id: string;
  title: string;
  description: string;
  customer_id: string | null;
  call_reason: string;
  call_purpose: string;
  notes: string;
  preferred_language: string;
  scheduled_date: string;
  scheduled_time: string;
};

type RestaurantSuggestion = {
  id: string;
  name: string;
  cuisine: string;
  area: string;
  reservation_hint: string;
  call_action: ProactiveAction;
};

type DashboardInsights = {
  summary: string;
  important_things: string[];
  proactive_actions: ProactiveAction[];
  valentines: {
    prompt: string;
    restaurants: RestaurantSuggestion[];
  };
  source: "openai" | "fallback";
};

type CustomerLite = {
  id: string;
  name: string;
  phone: string;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeOnly(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultScheduledDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return formatDateOnly(date);
}

function getUpcomingValentineDate(today: Date = new Date()): string {
  const candidate = new Date(today.getFullYear(), 1, 14);
  if (candidate.getTime() < today.getTime()) {
    return formatDateOnly(new Date(today.getFullYear() + 1, 1, 14));
  }
  return formatDateOnly(candidate);
}

function sanitizeAction(
  input: unknown,
  fallbackId: string,
  customerIds: Set<string>,
  fallbackDate: string
): ProactiveAction | null {
  const record = toRecord(input);
  if (!record) return null;

  const title = normalizeText(record.title);
  if (!title) return null;

  const description = normalizeText(record.description, title);
  const customerId = normalizeText(record.customer_id) || null;

  const callReason = normalizeText(record.call_reason, title);
  const callPurpose = normalizeText(record.call_purpose, description);
  const notes = normalizeText(record.notes, callPurpose);
  const preferredLanguage = normalizeText(record.preferred_language, "English");

  const rawDate = normalizeText(record.scheduled_date, fallbackDate);
  const scheduledDate = isDateOnly(rawDate) ? rawDate : fallbackDate;

  const rawTime = normalizeText(record.scheduled_time, "20:00");
  const scheduledTime = isTimeOnly(rawTime) ? rawTime : "20:00";

  return {
    id: normalizeText(record.id, fallbackId),
    title,
    description,
    customer_id: customerId && customerIds.has(customerId) ? customerId : null,
    call_reason: callReason,
    call_purpose: callPurpose,
    notes,
    preferred_language: preferredLanguage,
    scheduled_date: scheduledDate,
    scheduled_time: scheduledTime || "20:00",
  };
}

function buildFallbackValentineRestaurants(
  targetCustomer: CustomerLite | null,
  valentineDate: string
): RestaurantSuggestion[] {
  const customerId = targetCustomer?.id || null;
  const customerName = targetCustomer?.name || "the customer";

  const restaurants = [
    {
      id: "rest-1",
      name: "Tantris Maison Culinaire",
      cuisine: "Modern European",
      area: "Schwabing, Munich",
      reservation_hint: "Call early evening and ask for a quiet table for two.",
    },
    {
      id: "rest-2",
      name: "Theresa Grill",
      cuisine: "Steakhouse",
      area: "Schwabing, Munich",
      reservation_hint: "Ask about Valentine tasting menu availability.",
    },
    {
      id: "rest-3",
      name: "Matsuhisa Munich",
      cuisine: "Japanese-Peruvian",
      area: "Altstadt, Munich",
      reservation_hint: "Request a dinner slot between 19:30 and 20:30.",
    },
  ];

  return restaurants.map((restaurant) => ({
    ...restaurant,
    call_action: {
      id: `valentine-${restaurant.id}`,
      title: `Book ${restaurant.name}`,
      description: `Call to request a Valentine date reservation at ${restaurant.name}.`,
      customer_id: customerId,
      call_reason: `Valentine restaurant reservation at ${restaurant.name}`,
      call_purpose: `Call ${restaurant.name} to book a dinner table for ${customerName} on ${valentineDate}.`,
      notes: `Target restaurant: ${restaurant.name} (${restaurant.area}). ${restaurant.reservation_hint}`,
      preferred_language: "English",
      scheduled_date: valentineDate,
      scheduled_time: "20:00",
    },
  }));
}

function buildFallbackInsights(calls: Array<{
  id: string;
  status: string;
  callReason: string;
  customer: CustomerLite;
  actionItems: Array<{ completed: boolean; title: string; detail: string }>;
}>): DashboardInsights {
  const fallbackDate = getDefaultScheduledDate();
  const valentineDate = getUpcomingValentineDate();

  const total = calls.length;
  const pending = calls.filter((call) => call.status === "pending").length;
  const failed = calls.filter((call) => call.status === "failed").length;
  const openItems = calls.flatMap((call) =>
    call.actionItems
      .filter((item) => !item.completed)
      .map((item) => `${call.customer.name}: ${item.title} - ${item.detail}`)
  );

  const mostRecent = calls[0];
  const targetCustomer = mostRecent?.customer || null;

  const proactiveActions: ProactiveAction[] = [];
  if (mostRecent) {
    proactiveActions.push({
      id: "follow-up-recent",
      title: `Follow up with ${mostRecent.customer.name}`,
      description:
        "Create a follow-up call to confirm outcomes and next steps from the latest conversation.",
      customer_id: mostRecent.customer.id,
      call_reason: mostRecent.callReason || "Follow-up",
      call_purpose:
        "Confirm progress, collect missing information, and align on the next appointment step.",
      notes: "Use transcript context and ask for concrete next action.",
      preferred_language: "English",
      scheduled_date: fallbackDate,
      scheduled_time: "20:00",
    });
  }

  proactiveActions.push({
    id: "valentine-date-plan",
    title: "Valentine date reservation planning",
    description:
      "Proactively call and shortlist reservation options for Valentine dinner.",
    customer_id: targetCustomer?.id || null,
    call_reason: "Valentine reservation planning",
    call_purpose:
      "Ask if they want a reservation booked and confirm preferred cuisine, budget, and area.",
    notes:
      "Open with: Valentine's Day is coming, want me to find and call 3 restaurant options?",
    preferred_language: "English",
    scheduled_date: valentineDate,
    scheduled_time: "20:00",
  });

  const restaurants = buildFallbackValentineRestaurants(targetCustomer, valentineDate);

  const important = [
    `Total calls tracked: ${total}`,
    `Pending calls: ${pending}`,
    `Failed calls: ${failed}`,
    ...openItems.slice(0, 4),
  ];

  return {
    summary:
      "Call operations snapshot generated locally. Review pending/failed calls and execute proactive follow-ups.",
    important_things: important.filter(Boolean).slice(0, 8),
    proactive_actions: proactiveActions,
    valentines: {
      prompt:
        "Valentine's Day is coming. Want me to look for a restaurant reservation?",
      restaurants,
    },
    source: "fallback",
  };
}

function sanitizeInsightsResponse(
  raw: unknown,
  customers: CustomerLite[],
  fallback: DashboardInsights
): DashboardInsights {
  const record = toRecord(raw);
  if (!record) return fallback;

  const customerIds = new Set(customers.map((customer) => customer.id));
  const fallbackDate = getDefaultScheduledDate();

  const summary = normalizeText(record.summary, fallback.summary);

  const importantRaw = Array.isArray(record.important_things)
    ? record.important_things
    : [];
  const importantThings = importantRaw
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 10);

  const actionsRaw = Array.isArray(record.proactive_actions)
    ? record.proactive_actions
    : [];
  const proactiveActions = actionsRaw
    .map((item, index) =>
      sanitizeAction(item, `action-${index + 1}`, customerIds, fallbackDate)
    )
    .filter((item): item is ProactiveAction => Boolean(item))
    .slice(0, 8)
    .map((action) => ({ ...action, scheduled_time: "20:00" }));

  const valentinesRecord = toRecord(record.valentines);
  const prompt = normalizeText(
    valentinesRecord?.prompt,
    fallback.valentines.prompt
  );

  const restaurantsRaw = Array.isArray(valentinesRecord?.restaurants)
    ? (valentinesRecord?.restaurants as unknown[])
    : [];

  const restaurants = restaurantsRaw
    .map((item, index) => {
      const itemRecord = toRecord(item);
      if (!itemRecord) return null;

      const action = sanitizeAction(
        itemRecord.call_action,
        `valentine-action-${index + 1}`,
        customerIds,
        getUpcomingValentineDate()
      );
      if (!action) return null;

      return {
        id: normalizeText(itemRecord.id, `valentine-${index + 1}`),
        name: normalizeText(itemRecord.name, `Restaurant ${index + 1}`),
        cuisine: normalizeText(itemRecord.cuisine, "Cuisine not specified"),
        area: normalizeText(itemRecord.area, "Area not specified"),
        reservation_hint: normalizeText(
          itemRecord.reservation_hint,
          "Ask for available reservation slots around 20:00."
        ),
        call_action: { ...action, scheduled_time: "20:00" },
      } satisfies RestaurantSuggestion;
    })
    .filter((item): item is RestaurantSuggestion => Boolean(item))
    .slice(0, 3);

  return {
    summary,
    important_things:
      importantThings.length > 0 ? importantThings : fallback.important_things,
    proactive_actions:
      proactiveActions.length > 0 ? proactiveActions : fallback.proactive_actions,
    valentines: {
      prompt,
      restaurants: restaurants.length > 0 ? restaurants : fallback.valentines.restaurants,
    },
    source: "openai",
  };
}

export async function GET() {
  const [customers, calls] = await Promise.all([
    db.customer.findMany({
      select: { id: true, name: true, phone: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.scheduledCall.findMany({
      orderBy: { scheduledAt: "desc" },
      take: 120,
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        callReason: true,
        callPurpose: true,
        notes: true,
        preferredLanguage: true,
        customer: { select: { id: true, name: true, phone: true } },
        evaluation: {
          select: {
            result: true,
            rationale: true,
            duration: true,
            createdAt: true,
          },
        },
        actionItems: {
          select: {
            title: true,
            detail: true,
            completed: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    }),
  ]);

  const fallback = buildFallbackInsights(calls);

  if (!hasOpenAiApiKey()) {
    return NextResponse.json(fallback);
  }

  try {
    const contextPayload = {
      now: new Date().toISOString(),
      customers,
      calls,
      constraints: {
        scheduled_time_required: "20:00",
        max_proactive_actions: 6,
      },
    };

    const systemPrompt = [
      "You are an operations copilot for an autonomous call scheduling dashboard.",
      "Return strict JSON with keys: summary, important_things, proactive_actions, valentines.",
      "proactive_actions must be an array of objects with fields:",
      "id,title,description,customer_id,call_reason,call_purpose,notes,preferred_language,scheduled_date,scheduled_time",
      "scheduled_time must be '20:00' for all actions.",
      "Only use customer_id values that exist in the provided customers list. If unknown, use null.",
      "valentines must include prompt and exactly 3 restaurants.",
      "Each valentines restaurant must include id,name,cuisine,area,reservation_hint,call_action.",
      "Each call_action must follow the same action schema and schedule at 20:00.",
      "Be concise and actionable.",
    ].join(" ");

    const userPrompt = [
      "Generate dashboard insights and proactive scheduling actions from this data:",
      JSON.stringify(contextPayload),
    ].join("\n\n");

    const raw = await createJsonCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 1200,
    });

    const insights = sanitizeInsightsResponse(raw, customers, fallback);
    return NextResponse.json(insights);
  } catch {
    return NextResponse.json(fallback);
  }
}
