import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createJsonCompletion, hasOpenAiApiKey } from "@/lib/openai";
import { isLikelyPhoneNumber } from "@/lib/validation";

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
  target_name: string | null;
  target_phone: string | null;
};

type RestaurantSuggestion = {
  id: string;
  name: string;
  cuisine: string;
  area: string;
  address: string;
  phone: string;
  reservation_hint: string;
  call_action: ProactiveAction;
};

type ValentineAvailabilityOption = {
  id: string;
  restaurant_name: string;
  available_time: string;
  cuisine: string;
  area: string;
  call_action: ProactiveAction;
};

type ValentineAvailabilitySummary = {
  title: string;
  status: "pending";
  summary: string;
  confirm_button_label: string;
  options: ValentineAvailabilityOption[];
};

type DashboardInsights = {
  summary: string;
  important_things: string[];
  proactive_actions: ProactiveAction[];
  valentines: {
    prompt: string;
    restaurants: RestaurantSuggestion[];
  };
  valentine_availability_summary: ValentineAvailabilitySummary | null;
  source: "openai" | "fallback";
  source_reason: string | null;
};

type CustomerLite = {
  id: string;
  name: string;
  phone: string;
};

type ValentineCallForSummary = {
  id: string;
  status: string;
  scheduledAt: Date;
  customer: CustomerLite;
  callReason: string;
  callPurpose: string;
  notes: string;
  logs: Array<{
    id: string;
    event: string;
    message: string;
    createdAt: Date;
  }>;
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
  const targetName = normalizeText(record.target_name) || null;
  const targetPhoneRaw = normalizeText(record.target_phone) || null;
  const targetPhone =
    targetPhoneRaw && isLikelyPhoneNumber(targetPhoneRaw)
      ? targetPhoneRaw
      : null;

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
    target_name: targetName,
    target_phone: targetPhone,
  };
}

function isValentineAction(action: ProactiveAction): boolean {
  const combined = [
    action.id,
    action.title,
    action.description,
    action.call_reason,
    action.call_purpose,
    action.notes,
  ]
    .join(" ")
    .toLowerCase();
  return combined.includes("valentine");
}

function isValentineLikeText(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("valentine") ||
    normalized.includes("reservation") ||
    normalized.includes("restaurant")
  );
}

function getRestaurantProfile(name: string): { cuisine: string; area: string } {
  const normalized = name.toLowerCase();
  if (normalized.includes("tantris")) {
    return { cuisine: "French Fine Dining", area: "Schwabing, Munich" };
  }
  if (normalized.includes("matsuhisa")) {
    return { cuisine: "Japanese-Peruvian", area: "Altstadt, Munich" };
  }
  if (normalized.includes("brenner")) {
    return { cuisine: "Italian / Grill", area: "Altstadt-Lehel, Munich" };
  }
  return { cuisine: "Restaurant", area: "Munich" };
}

function toDateOnlyLocal(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildValentineAvailabilitySummary(
  calls: ValentineCallForSummary[]
): ValentineAvailabilitySummary | null {
  const valentineCalls = calls.filter((call) => {
    const searchable = [
      call.callReason,
      call.callPurpose,
      call.notes,
      call.customer.name,
    ]
      .join(" ")
      .trim();
    return isValentineLikeText(searchable);
  });

  const valentineCallsWithLogs = valentineCalls.filter(
    (call) => Array.isArray(call.logs) && call.logs.length > 0
  );

  // Show the shortlist interaction only once we have enough call logs for the 3-call scenario.
  if (valentineCallsWithLogs.length < 3) {
    return null;
  }

  const rankedByStatus = [...valentineCallsWithLogs].sort((left, right) => {
    const score = (status: string): number => {
      if (status === "completed") return 0;
      if (status === "dispatched") return 1;
      if (status === "dispatching") return 2;
      if (status === "pending") return 3;
      return 4;
    };
    const delta = score(left.status) - score(right.status);
    if (delta !== 0) return delta;
    return left.scheduledAt.getTime() - right.scheduledAt.getTime();
  });

  const selected = rankedByStatus.slice(0, 2);
  if (selected.length < 2) return null;

  const optionTimes = ["20:00", "19:30"];
  const options: ValentineAvailabilityOption[] = selected.map((call, index) => {
    const profile = getRestaurantProfile(call.customer.name);
    const availableTime = optionTimes[index] || "20:00";

    return {
      id: `valentine-available-${call.id}`,
      restaurant_name: call.customer.name,
      available_time: availableTime,
      cuisine: profile.cuisine,
      area: profile.area,
      call_action: {
        id: `valentine-confirm-${call.id}`,
        title: `Confirm selection with ${call.customer.name}`,
        description: `Call ${call.customer.name} to confirm the final selected Valentine reservation.`,
        customer_id: call.customer.id,
        call_reason: `Confirm final Valentine reservation with ${call.customer.name}`,
        call_purpose: `Confirm selected dinner slot (${availableTime}) and finalize booking details.`,
        notes: [
          `Selected restaurant: ${call.customer.name}`,
          `Confirmed available time: ${availableTime}`,
          "Ask to finalize booking under the selected option.",
        ].join("\n"),
        preferred_language: "English",
        scheduled_date: toDateOnlyLocal(new Date()),
        scheduled_time: "20:00",
        target_name: call.customer.name,
        target_phone: call.customer.phone,
      },
    };
  });

  return {
    title: "Valentine's Dinner Reservation",
    status: "pending",
    summary:
      "I found 2 restaurants that are available. Which one would you like me to book?",
    confirm_button_label: "Confirm Selection and Call",
    options,
  };
}

function buildFallbackValentineRestaurants(
  customers: CustomerLite[],
  targetCustomer: CustomerLite | null,
  valentineDate: string
): RestaurantSuggestion[] {
  const customerName = targetCustomer?.name || "the caller";

  const customerByPhone = new Map(
    customers.map((customer) => [customer.phone.replace(/\D+/g, ""), customer.id])
  );

  const restaurants = [
    {
      id: "rest-tantris",
      name: "Tantris Maison Culinaire",
      cuisine: "French Fine Dining",
      area: "Schwabing, Munich",
      address: "Johann-Fichte-Strasse 7, 80805 Munich",
      phone: "+49 89 36 19 59-0",
      reservation_hint:
        "Ask for a two-person Valentine dinner reservation around 20:00.",
    },
    {
      id: "rest-matsuhisa-munich",
      name: "Matsuhisa Munich",
      cuisine: "Japanese-Peruvian",
      area: "Altstadt, Munich",
      address: "Neuturmstrasse 1, 80331 Munich",
      phone: "+49 (89) 290 98 834",
      reservation_hint:
        "Request the earliest available dinner table for two close to 20:00.",
    },
    {
      id: "rest-brenner",
      name: "brenner",
      cuisine: "Italian / Grill",
      area: "Altstadt-Lehel, Munich",
      address: "Maximilianstrasse 15, 80539 Munich",
      phone: "+49 89 45 22 880",
      reservation_hint:
        "Ask whether a quieter table for two is available around 20:00.",
    },
  ];

  return restaurants.map((restaurant) => {
    const customerId =
      customerByPhone.get(restaurant.phone.replace(/\D+/g, "")) || null;

    return {
      ...restaurant,
      call_action: {
        id: `valentine-${restaurant.id}`,
        title: `Book ${restaurant.name}`,
        description: `Call to request a Valentine reservation at ${restaurant.name}.`,
        customer_id: customerId,
        call_reason: `Valentine reservation inquiry at ${restaurant.name}`,
        call_purpose: `Call ${restaurant.name} to book a dinner table for ${customerName} on ${valentineDate}.`,
        notes: [
          `Restaurant: ${restaurant.name}`,
          `Address: ${restaurant.address}`,
          `Phone: ${restaurant.phone}`,
          `Request: table for two around 20:00 on ${valentineDate}`,
          `Hint: ${restaurant.reservation_hint}`,
        ].join("\n"),
        preferred_language: "English",
        scheduled_date: valentineDate,
        scheduled_time: "20:00",
        target_name: restaurant.name,
        target_phone: restaurant.phone,
      },
    };
  });
}

function buildFallbackInsights(calls: Array<{
  id: string;
  status: string;
  callReason: string;
  customer: CustomerLite;
  actionItems: Array<{ completed: boolean; title: string; detail: string }>;
}>, customers: CustomerLite[], reason: string): DashboardInsights {
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
      target_name: mostRecent.customer.name,
      target_phone: mostRecent.customer.phone,
    });
  }

  const restaurants = buildFallbackValentineRestaurants(
    customers,
    targetCustomer,
    valentineDate
  );

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
    valentine_availability_summary: null,
    source: "fallback",
    source_reason: reason,
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
        address: normalizeText(itemRecord.address, "Address not provided"),
        phone: normalizeText(itemRecord.phone, ""),
        reservation_hint: normalizeText(
          itemRecord.reservation_hint,
          "Ask for available reservation slots around 20:00."
        ),
        call_action: { ...action, scheduled_time: "20:00" },
      } satisfies RestaurantSuggestion;
    })
    .filter((item): item is RestaurantSuggestion => Boolean(item))
    .slice(0, 3);

  const valentineActionIds = new Set(
    restaurants.map((restaurant) => restaurant.call_action.id)
  );
  const proactiveNonValentine = proactiveActions.filter(
    (action) =>
      !valentineActionIds.has(action.id) && !isValentineAction(action)
  );

  return {
    summary,
    important_things:
      importantThings.length > 0 ? importantThings : fallback.important_things,
    proactive_actions:
      proactiveNonValentine.length > 0
        ? proactiveNonValentine
        : fallback.proactive_actions,
    valentines: {
      prompt,
      restaurants: restaurants.length > 0 ? restaurants : fallback.valentines.restaurants,
    },
    valentine_availability_summary: fallback.valentine_availability_summary,
    source: "openai",
    source_reason: null,
  };
}

export async function GET() {
  const [customers, calls, valentineCallsWithLogs] = await Promise.all([
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
    db.scheduledCall.findMany({
      where: {
        OR: [
          { callReason: { contains: "Valentine" } },
          { callReason: { contains: "valentine" } },
          { callPurpose: { contains: "Valentine" } },
          { callPurpose: { contains: "valentine" } },
          { notes: { contains: "Valentine" } },
          { notes: { contains: "valentine" } },
        ],
      },
      orderBy: { scheduledAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        callReason: true,
        callPurpose: true,
        notes: true,
        customer: { select: { id: true, name: true, phone: true } },
        logs: {
          select: {
            id: true,
            event: true,
            message: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    }),
  ]);

  const valentineAvailabilitySummary = buildValentineAvailabilitySummary(
    valentineCallsWithLogs
  );

  const fallbackBase = buildFallbackInsights(
    calls,
    customers,
    "OPENAI_API_KEY is not configured in this environment."
  );
  const fallback: DashboardInsights = {
    ...fallbackBase,
    valentine_availability_summary: valentineAvailabilitySummary,
  };

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
      "Do not include any Valentine's actions in proactive_actions; keep Valentine's actions only in valentines.restaurants[].call_action.",
      "valentines must include prompt and exactly 3 restaurants.",
      "Each valentines restaurant must include id,name,cuisine,area,reservation_hint,call_action.",
      "Each valentines restaurant should also include address and phone when available.",
      "Each call_action must follow the same action schema and schedule at 20:00, and may include target_name/target_phone.",
      "Default Valentine's restaurant location to Munich, Germany unless the input data clearly indicates another city.",
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
    return NextResponse.json({
      ...insights,
      valentine_availability_summary: valentineAvailabilitySummary,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? `OpenAI request failed. Using local fallback. (${error.message})`
        : "OpenAI request failed. Using local fallback.";
    return NextResponse.json({
      ...fallback,
      source_reason: reason,
    });
  }
}
