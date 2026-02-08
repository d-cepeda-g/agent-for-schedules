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

type DashboardInsights = {
  summary: string;
  important_things: string[];
  proactive_actions: ProactiveAction[];
  valentines: {
    prompt: string;
    restaurants: RestaurantSuggestion[];
  };
  source: "openai" | "fallback";
  source_reason: string | null;
};

type CustomerLite = {
  id: string;
  name: string;
  phone: string;
};

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
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

function formatTimeOnly(date: Date): string {
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${hour}:${minute}`;
}

function parseDateOnly(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function normalizeToStartOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function inferYearForMonthDay(
  monthIndex: number,
  day: number,
  explicitYear: number | null,
  today: Date
): number {
  if (explicitYear) return explicitYear;

  const currentYear = today.getFullYear();
  const candidate = new Date(currentYear, monthIndex, day, 0, 0, 0, 0);
  const todayStart = normalizeToStartOfDay(today);
  return candidate.getTime() < todayStart.getTime() ? currentYear + 1 : currentYear;
}

function parseEventDateFromText(
  text: string,
  today: Date = new Date()
): Date | null {
  const candidates: Date[] = [];

  const isoMatches = text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g);
  for (const match of isoMatches) {
    const parsed = parseDateOnly(`${match[1]}-${match[2]}-${match[3]}`);
    if (parsed) candidates.push(parsed);
  }

  const dottedMatches = text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g);
  for (const match of dottedMatches) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push(parsed);
    }
  }

  const monthPattern =
    "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const dayMonthRegex = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${monthPattern})(?:\\s*,?\\s*(20\\d{2}))?\\b`,
    "gi"
  );
  const monthDayRegex = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b`,
    "gi"
  );

  const dayMonthMatches = text.matchAll(dayMonthRegex);
  for (const match of dayMonthMatches) {
    const day = Number(match[1]);
    const monthIndex = MONTH_INDEX_BY_NAME[match[2].toLowerCase()];
    const explicitYear = typeof match[3] === "string" ? Number(match[3]) : null;
    if (monthIndex === undefined) continue;
    const year = inferYearForMonthDay(monthIndex, day, explicitYear, today);
    const parsed = new Date(year, monthIndex, day, 0, 0, 0, 0);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push(parsed);
    }
  }

  const monthDayMatches = text.matchAll(monthDayRegex);
  for (const match of monthDayMatches) {
    const monthIndex = MONTH_INDEX_BY_NAME[match[1].toLowerCase()];
    const day = Number(match[2]);
    const explicitYear = typeof match[3] === "string" ? Number(match[3]) : null;
    if (monthIndex === undefined) continue;
    const year = inferYearForMonthDay(monthIndex, day, explicitYear, today);
    const parsed = new Date(year, monthIndex, day, 0, 0, 0, 0);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push(parsed);
    }
  }

  const normalized = text.toLowerCase();
  if (normalized.includes("today")) {
    candidates.push(normalizeToStartOfDay(today));
  }
  if (normalized.includes("tomorrow")) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    candidates.push(normalizeToStartOfDay(tomorrow));
  }
  if (normalized.includes("next week")) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    candidates.push(normalizeToStartOfDay(nextWeek));
  }

  if (candidates.length === 0) return null;

  const todayStart = normalizeToStartOfDay(today).getTime();
  const upcoming = candidates
    .filter((date) => date.getTime() >= todayStart)
    .sort((left, right) => left.getTime() - right.getTime());
  if (upcoming.length > 0) {
    return upcoming[0];
  }

  return candidates.sort((left, right) => right.getTime() - left.getTime())[0];
}

function getNextBusinessContactSlot(now: Date = new Date()): Date {
  const slot = new Date(now);
  slot.setSeconds(0, 0);
  slot.setMinutes(slot.getMinutes() + 30);
  const roundedMinutes = slot.getMinutes() % 5;
  if (roundedMinutes !== 0) {
    slot.setMinutes(slot.getMinutes() + (5 - roundedMinutes));
  }

  if (slot.getDay() === 0) {
    slot.setDate(slot.getDate() + 1);
    slot.setHours(9, 30, 0, 0);
  }
  if (slot.getDay() === 6) {
    slot.setDate(slot.getDate() + 2);
    slot.setHours(9, 30, 0, 0);
  }

  if (slot.getHours() < 9 || (slot.getHours() === 9 && slot.getMinutes() < 30)) {
    slot.setHours(9, 30, 0, 0);
  } else if (slot.getHours() > 17 || (slot.getHours() === 17 && slot.getMinutes() > 0)) {
    slot.setDate(slot.getDate() + 1);
    slot.setHours(9, 30, 0, 0);
    while (slot.getDay() === 0 || slot.getDay() === 6) {
      slot.setDate(slot.getDate() + 1);
    }
  }

  return slot;
}

function getLatestBusinessSlotBeforeEvent(eventDate: Date): Date {
  const latest = new Date(eventDate);
  latest.setDate(latest.getDate() - 1);
  latest.setHours(16, 30, 0, 0);

  while (latest.getDay() === 0 || latest.getDay() === 6) {
    latest.setDate(latest.getDate() - 1);
  }

  return latest;
}

function deriveSoonOutreachSlot(
  eventDate: Date | null,
  now: Date = new Date()
): { scheduledDate: string; scheduledTime: string } {
  const soonSlot = getNextBusinessContactSlot(now);

  if (!eventDate) {
    return {
      scheduledDate: formatDateOnly(soonSlot),
      scheduledTime: formatTimeOnly(soonSlot),
    };
  }

  const latestBeforeEvent = getLatestBusinessSlotBeforeEvent(eventDate);
  if (soonSlot.getTime() <= latestBeforeEvent.getTime()) {
    return {
      scheduledDate: formatDateOnly(soonSlot),
      scheduledTime: formatTimeOnly(soonSlot),
    };
  }

  const urgentSlot = new Date(now);
  urgentSlot.setSeconds(0, 0);
  urgentSlot.setMinutes(urgentSlot.getMinutes() + 30);
  const roundedMinutes = urgentSlot.getMinutes() % 5;
  if (roundedMinutes !== 0) {
    urgentSlot.setMinutes(urgentSlot.getMinutes() + (5 - roundedMinutes));
  }

  if (urgentSlot.getTime() <= latestBeforeEvent.getTime()) {
    return {
      scheduledDate: formatDateOnly(latestBeforeEvent),
      scheduledTime: formatTimeOnly(latestBeforeEvent),
    };
  }

  return {
    scheduledDate: formatDateOnly(urgentSlot),
    scheduledTime: formatTimeOnly(urgentSlot),
  };
}

function applyOutreachSchedulePolicy(
  action: ProactiveAction,
  explicitEventDate: Date | null = null
): ProactiveAction {
  const inferredEventDate =
    explicitEventDate ||
    parseEventDateFromText(
      [
        action.title,
        action.description,
        action.call_reason,
        action.call_purpose,
        action.notes,
      ].join("\n")
    );
  const slot = deriveSoonOutreachSlot(inferredEventDate);
  return {
    ...action,
    scheduled_date: slot.scheduledDate,
    scheduled_time: slot.scheduledTime,
  };
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

  const rawTime = normalizeText(record.scheduled_time, "10:00");
  const scheduledTime = isTimeOnly(rawTime) ? rawTime : "10:00";

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

function buildFallbackValentineRestaurants(
  customers: CustomerLite[],
  targetCustomer: CustomerLite | null,
  valentineDate: string
): RestaurantSuggestion[] {
  const customerName = targetCustomer?.name || "the caller";

  const customerByPhone = new Map(
    customers.map((customer) => [customer.phone.replace(/\D+/g, ""), customer.id])
  );
  const valentineEventDate = parseDateOnly(valentineDate);
  const outreachSlot = deriveSoonOutreachSlot(valentineEventDate);

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
        scheduled_date: outreachSlot.scheduledDate,
        scheduled_time: outreachSlot.scheduledTime,
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
  evaluation: { result: string; createdAt: Date } | null;
  customer: CustomerLite;
  actionItems: Array<{ completed: boolean; title: string; detail: string }>;
}>, customers: CustomerLite[], reason: string): DashboardInsights {
  const fallbackDate = getDefaultScheduledDate();
  const valentineDate = getUpcomingValentineDate();
  const followUpSlot = deriveSoonOutreachSlot(null);

  const total = calls.length;
  const pending = calls.filter((call) => call.status === "pending").length;
  const failed = calls.filter((call) => call.status === "failed").length;
  const openItems = calls.flatMap((call) =>
    call.actionItems
      .filter((item) => !item.completed)
      .map((item) => `${call.customer.name}: ${item.title} - ${item.detail}`)
  );

  const hasCallOutcome = (call: {
    status: string;
    evaluation: { result: string; createdAt: Date } | null;
  }): boolean => {
    return (
      call.status === "completed" || Boolean(call.evaluation)
    );
  };

  const mostRecent = calls.find((call) => hasCallOutcome(call));
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
      scheduled_date: followUpSlot.scheduledDate || fallbackDate,
      scheduled_time: followUpSlot.scheduledTime,
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
  const customerIdByPhone = new Map(
    customers.map((customer) => [customer.phone.replace(/\D+/g, ""), customer.id])
  );
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
    .map((action) => applyOutreachSchedulePolicy(action));

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

      const restaurantName = normalizeText(itemRecord.name, `Restaurant ${index + 1}`);
      const restaurantPhone = normalizeText(itemRecord.phone, "");
      const normalizedRestaurantPhone = restaurantPhone.replace(/\D+/g, "");
      const phoneBackedCustomerId =
        normalizedRestaurantPhone.length > 0
          ? customerIdByPhone.get(normalizedRestaurantPhone) || null
          : null;

      const hydratedAction: ProactiveAction = {
        ...action,
        customer_id: action.customer_id || phoneBackedCustomerId,
        target_name: action.target_name || restaurantName,
        target_phone:
          action.target_phone ||
          (isLikelyPhoneNumber(restaurantPhone) ? restaurantPhone : null),
      };
      const scheduledAction = applyOutreachSchedulePolicy(
        hydratedAction,
        parseDateOnly(getUpcomingValentineDate())
      );

      return {
        id: normalizeText(itemRecord.id, `valentine-${index + 1}`),
        name: restaurantName,
        cuisine: normalizeText(itemRecord.cuisine, "Cuisine not specified"),
        area: normalizeText(itemRecord.area, "Area not specified"),
        address: normalizeText(itemRecord.address, "Address not provided"),
        phone: restaurantPhone,
        reservation_hint: normalizeText(
          itemRecord.reservation_hint,
          "Ask for available reservation slots around 20:00."
        ),
        call_action: scheduledAction,
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
    source: "openai",
    source_reason: null,
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

  const fallbackBase = buildFallbackInsights(
    calls,
    customers,
    "OPENAI_API_KEY is not configured in this environment."
  );
  const fallback: DashboardInsights = fallbackBase;

  if (!hasOpenAiApiKey()) {
    return NextResponse.json(fallback);
  }

  try {
    const contextPayload = {
      now: new Date().toISOString(),
      customers,
      calls,
      constraints: {
        schedule_policy:
          "Schedule outreach calls as soon as possible and always before the event date when an event date is known.",
        max_proactive_actions: 6,
      },
    };

    const systemPrompt = [
      "You are an operations copilot for an autonomous call scheduling dashboard.",
      "Return strict JSON with keys: summary, important_things, proactive_actions, valentines.",
      "proactive_actions must be an array of objects with fields:",
      "id,title,description,customer_id,call_reason,call_purpose,notes,preferred_language,scheduled_date,scheduled_time",
      "scheduled_date and scheduled_time must schedule calls soon and before event dates when event dates are known.",
      "Only use customer_id values that exist in the provided customers list. If unknown, use null.",
      "Do not include any Valentine's actions in proactive_actions; keep Valentine's actions only in valentines.restaurants[].call_action.",
      "valentines must include prompt and exactly 3 restaurants.",
      "Each valentines restaurant must include id,name,cuisine,area,reservation_hint,call_action.",
      "Each valentines restaurant should also include address and phone when available.",
      "Each call_action must follow the same action schema and may include target_name/target_phone.",
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
    return NextResponse.json(insights);
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
