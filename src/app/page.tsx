"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CalendarPlus,
  CheckCircle,
  Clock,
  Heart,
  Loader2,
  Phone,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";

type Call = {
  id: string;
  scheduledAt: string;
  status: string;
  notes: string;
  callReason: string;
  callPurpose: string;
  preferredLanguage: string;
  customer: { id: string; name: string; phone: string };
  evaluation: { id: string; result: string } | null;
};

type Evaluation = {
  id: string;
  result: string;
  rationale: string;
  createdAt: string;
  scheduledCall: {
    id: string;
    customer: { name: string };
  };
};

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

type OnsiteLocationSuggestion = {
  id: string;
  name: string;
  area: string;
  address: string;
  phone: string;
  capacity_hint: string;
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

type ScheduledCallResponse = {
  id: string;
};

const DISMISSED_ACTIONS_STORAGE_KEY = "dashboard:dismissed_proactive_action_ids";
const DISMISSED_VALENTINE_PANEL_STORAGE_KEY =
  "dashboard:dismissed_valentine_panel";

type CustomerLookup = {
  id: string;
  name: string;
  phone: string;
};

const COMPANY_ONSITE_DATE_LABEL = "06.03.2026";
const ONSITE_BLOCKER_ACTION_ID = "company-onsite-blocker-2026-03-06";
const ONSITE_SEARCH_DELAY_MS = 1600;

const ONSITE_VENUES = [
  {
    id: "venue-moc-event-center",
    name: "MOC Event Center Messe München",
    area: "Freimann, Munich",
    address: "Lilienthalallee 40, 80939 Munich",
    phone: "+49 89 32353-0",
    capacity_hint: "Large conference format, flexible multi-room setups.",
  },
  {
    id: "venue-smartvillage-bogenhausen",
    name: "smartvillage Bogenhausen",
    area: "Bogenhausen, Munich",
    address: "Rosenkavalierplatz 13, 81925 Munich",
    phone: "+49 89 24418290",
    capacity_hint: "Modern workshop spaces for medium-sized team on-sites.",
  },
  {
    id: "venue-infinity-conference",
    name: "Infinity Hotel & Conference Resort Munich",
    area: "Unterschleissheim (near Munich)",
    address: "Andreas-Danzer-Weg 1, 85716 Unterschleissheim",
    phone: "+49 89 370530-0",
    capacity_hint: "Hotel + conference option for all-day on-site programs.",
  },
  {
    id: "venue-h4-messe",
    name: "H4 Hotel München Messe",
    area: "Messestadt, Munich",
    address: "Konrad-Zuse-Platz 14, 81829 Munich",
    phone: "+49 89 9400850",
    capacity_hint: "Convenient transit access and business meeting facilities.",
  },
] as const;

function readDismissedActionIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_ACTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeDismissedActionIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  if (ids.length === 0) {
    window.localStorage.removeItem(DISMISSED_ACTIONS_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    DISMISSED_ACTIONS_STORAGE_KEY,
    JSON.stringify(ids)
  );
}

function readValentinePanelDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(DISMISSED_VALENTINE_PANEL_STORAGE_KEY) ===
      "true"
    );
  } catch {
    return false;
  }
}

function writeValentinePanelDismissed(value: boolean): void {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(DISMISSED_VALENTINE_PANEL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(DISMISSED_VALENTINE_PANEL_STORAGE_KEY, "true");
}

function normalizePhoneForMatch(phone: string): string {
  return phone.replace(/\D+/g, "");
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getNextBusinessDayDateOnly(): string {
  const candidate = new Date();
  candidate.setDate(candidate.getDate() + 1);
  candidate.setHours(9, 0, 0, 0);
  return formatDateOnly(candidate);
}

function buildOnsiteBlockerAction(inquiryDate: string): ProactiveAction {
  return {
    id: ONSITE_BLOCKER_ACTION_ID,
    title: "Blocker: company on-site is in ~1 month",
    description: `Your company on-site is on ${COMPANY_ONSITE_DATE_LABEL}. Start venue availability outreach near Munich now.`,
    customer_id: null,
    call_reason: `Company on-site venue planning for ${COMPANY_ONSITE_DATE_LABEL}`,
    call_purpose:
      "Identify and contact event locations near Munich for on-site availability and fit.",
    notes:
      "Goal: gather venue availability, rough pricing, and room setup options for the company on-site.",
    preferred_language: "English",
    scheduled_date: inquiryDate,
    scheduled_time: "10:00",
    target_name: null,
    target_phone: null,
  };
}

function buildOnsiteLocationSuggestions(
  inquiryDate: string
): OnsiteLocationSuggestion[] {
  return ONSITE_VENUES.map((venue) => ({
    ...venue,
    call_action: {
      id: `onsite-${venue.id}`,
      title: `Check ${venue.name} availability`,
      description: `Call ${venue.name} to inquire about on-site availability around ${COMPANY_ONSITE_DATE_LABEL}.`,
      customer_id: null,
      call_reason: `Availability inquiry for company on-site (${COMPANY_ONSITE_DATE_LABEL})`,
      call_purpose: `Ask ${venue.name} about availability, capacity fit, and indicative pricing for an on-site on ${COMPANY_ONSITE_DATE_LABEL}.`,
      notes: [
        `Venue: ${venue.name}`,
        `Address: ${venue.address}`,
        `Phone: ${venue.phone}`,
        `On-site date: ${COMPANY_ONSITE_DATE_LABEL}`,
        `Capacity context: ${venue.capacity_hint}`,
        "Ask for: available time windows, room setup options, and next booking steps.",
      ].join("\n"),
      preferred_language: "English",
      scheduled_date: inquiryDate,
      scheduled_time: "10:00",
      target_name: venue.name,
      target_phone: venue.phone,
    },
  }));
}

function parseIsoFromAction(action: ProactiveAction): string {
  const [year, month, day] = action.scheduled_date.split("-").map(Number);
  const [hour, minute] = action.scheduled_time.split(":").map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(20, 0, 0, 0);
    return fallback.toISOString();
  }

  const scheduledAt = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(scheduledAt.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(20, 0, 0, 0);
    return fallback.toISOString();
  }

  return scheduledAt.toISOString();
}

function toPrefillUrl(action: ProactiveAction): string {
  const params = new URLSearchParams({
    callReason: action.call_reason,
    callPurpose: action.call_purpose,
    notes: action.notes,
    preferredLanguage: action.preferred_language || "English",
    date: action.scheduled_date,
    time: action.scheduled_time || "20:00",
  });

  if (action.customer_id) {
    params.set("customerId", action.customer_id);
  }

  return `/schedule?${params.toString()}`;
}

function hasPreviousCallHistory(calls: Call[]): boolean {
  const completedStatuses = new Set(["completed", "failed"]);
  return calls.some(
    (call) => completedStatuses.has(call.status) || Boolean(call.evaluation)
  );
}

function isFollowUpAction(action: ProactiveAction): boolean {
  const searchable = [
    action.id,
    action.title,
    action.description,
    action.call_reason,
    action.call_purpose,
    action.notes,
  ]
    .join(" ")
    .toLowerCase();
  return searchable.includes("follow up") || searchable.includes("follow-up");
}

export default function DashboardPage() {
  const router = useRouter();
  const onsiteSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [upcomingCalls, setUpcomingCalls] = useState<Call[]>([]);
  const [recentEvals, setRecentEvals] = useState<Evaluation[]>([]);
  const [hasPriorCalls, setHasPriorCalls] = useState(false);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [actionCreatingId, setActionCreatingId] = useState<string | null>(null);
  const [bulkValentineScheduling, setBulkValentineScheduling] = useState(false);
  const [dismissedActionIds, setDismissedActionIds] = useState<string[]>([]);
  const [valentinePanelDismissed, setValentinePanelDismissed] = useState(false);
  const [showOnsiteLocations, setShowOnsiteLocations] = useState(false);
  const [findingOnsiteLocations, setFindingOnsiteLocations] = useState(false);
  const [selectedValentineOptionId, setSelectedValentineOptionId] = useState<string>("");
  const [stats, setStats] = useState({
    totalCalls: 0,
    pending: 0,
    completed: 0,
  });

  useEffect(() => {
    fetch("/api/calls")
      .then((r) => r.json())
      .then((calls: Call[]) => {
        const pending = calls.filter((c) => c.status === "pending");
        const completed = calls.filter((c) => c.status === "completed");
        const hasHistory = hasPreviousCallHistory(calls);

        setUpcomingCalls(
          pending
            .sort(
              (a, b) =>
                new Date(a.scheduledAt).getTime() -
                new Date(b.scheduledAt).getTime()
            )
            .slice(0, 5)
        );

        setStats({
          totalCalls: calls.length,
          pending: pending.length,
          completed: completed.length,
        });
        setHasPriorCalls(hasHistory);
      })
      .catch(() => {
        setUpcomingCalls([]);
        setStats({ totalCalls: 0, pending: 0, completed: 0 });
        setHasPriorCalls(false);
      });

    fetch("/api/evaluations")
      .then((r) => r.json())
      .then((evals: Evaluation[]) => setRecentEvals(evals.slice(0, 5)))
      .catch(() => setRecentEvals([]));

    fetch("/api/ai/dashboard-insights")
      .then((r) => r.json())
      .then((payload: DashboardInsights) => setInsights(payload))
      .catch(() => setInsights(null))
      .finally(() => setInsightsLoading(false));
  }, []);

  useEffect(() => {
    setDismissedActionIds(readDismissedActionIds());
    setValentinePanelDismissed(readValentinePanelDismissed());
  }, []);

  function clearOnsiteSearchTimer() {
    if (onsiteSearchTimerRef.current) {
      clearTimeout(onsiteSearchTimerRef.current);
      onsiteSearchTimerRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      clearOnsiteSearchTimer();
    };
  }, []);

  const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    dispatching: "default",
    dispatched: "default",
    completed: "secondary",
    failed: "destructive",
    cancelled: "destructive",
  };

  const dismissedActionIdSet = useMemo(
    () => new Set(dismissedActionIds),
    [dismissedActionIds]
  );

  const onsiteInquiryDate = useMemo(() => getNextBusinessDayDateOnly(), []);
  const onsiteBlockerAction = useMemo(
    () => buildOnsiteBlockerAction(onsiteInquiryDate),
    [onsiteInquiryDate]
  );
  const onsiteLocations = useMemo(
    () => buildOnsiteLocationSuggestions(onsiteInquiryDate),
    [onsiteInquiryDate]
  );

  const sortedActions = useMemo(() => {
    const visible = insights?.proactive_actions?.filter(
      (action) => !dismissedActionIdSet.has(action.id)
    ) || [];

    const historyAware = hasPriorCalls
      ? visible
      : visible.filter((action) => !isFollowUpAction(action));

    return historyAware.slice(0, 6);
  }, [insights, dismissedActionIdSet, hasPriorCalls]);

  const proactiveActionsWithOnsite = useMemo(() => {
    const actions = sortedActions.filter(
      (action) => action.id !== ONSITE_BLOCKER_ACTION_ID
    );

    if (dismissedActionIdSet.has(ONSITE_BLOCKER_ACTION_ID)) {
      return actions;
    }

    return [onsiteBlockerAction, ...actions];
  }, [sortedActions, dismissedActionIdSet, onsiteBlockerAction]);

  const visibleValentineRestaurants = useMemo(
    () =>
      insights?.valentines?.restaurants
        ?.filter(
          (restaurant) => !dismissedActionIdSet.has(restaurant.call_action.id)
        )
        .slice(0, 3) || [],
    [insights, dismissedActionIdSet]
  );

  const valentineAvailabilitySummary = useMemo(() => {
    if (!insights?.valentine_availability_summary) return null;
    const options = insights.valentine_availability_summary.options.filter(
      (option) => !dismissedActionIdSet.has(option.call_action.id)
    );
    if (options.length < 2) return null;
    return {
      ...insights.valentine_availability_summary,
      options,
    };
  }, [insights, dismissedActionIdSet]);

  useEffect(() => {
    if (!valentineAvailabilitySummary || valentineAvailabilitySummary.options.length === 0) {
      setSelectedValentineOptionId("");
      return;
    }

    const exists = valentineAvailabilitySummary.options.some(
      (option) => option.id === selectedValentineOptionId
    );
    if (!exists) {
      setSelectedValentineOptionId(valentineAvailabilitySummary.options[0].id);
    }
  }, [valentineAvailabilitySummary, selectedValentineOptionId]);

  const selectedValentineOption = useMemo(() => {
    if (!valentineAvailabilitySummary) return null;
    return (
      valentineAvailabilitySummary.options.find(
        (option) => option.id === selectedValentineOptionId
      ) || valentineAvailabilitySummary.options[0] || null
    );
  }, [valentineAvailabilitySummary, selectedValentineOptionId]);

  const visibleOnsiteLocations = useMemo(
    () =>
      onsiteLocations.filter(
        (location) => !dismissedActionIdSet.has(location.call_action.id)
      ),
    [onsiteLocations, dismissedActionIdSet]
  );

  const aiOpsSummary = useMemo(() => {
    if (!insights) return "";
    if (hasPriorCalls) return insights.summary;
    return "No previous calls have been made yet. Once your first call is completed, AI Ops will summarize outcomes here. Proactive updates below are still available.";
  }, [insights, hasPriorCalls]);

  async function scheduleProactiveAction(
    action: ProactiveAction,
    options?: {
      navigateOnSuccess?: boolean;
      fallbackToPrefill?: boolean;
    }
  ): Promise<string | null> {
    const navigateOnSuccess = options?.navigateOnSuccess ?? true;
    const fallbackToPrefill = options?.fallbackToPrefill ?? true;
    let targetCustomerId = action.customer_id;

    if (!targetCustomerId) {
      const targetName = action.target_name?.trim() || "";
      const targetPhone = action.target_phone?.trim() || "";

      if (targetName && targetPhone) {
        const lookupResponse = await fetch(
          `/api/customers?q=${encodeURIComponent(targetPhone)}`
        );

        if (lookupResponse.ok) {
          const candidates = (await lookupResponse.json()) as CustomerLookup[];
          const normalizedTargetPhone = normalizePhoneForMatch(targetPhone);
          const exactMatch = candidates.find(
            (candidate) =>
              normalizePhoneForMatch(candidate.phone) === normalizedTargetPhone
          );
          if (exactMatch?.id) {
            targetCustomerId = exactMatch.id;
          }
        }

        if (!targetCustomerId) {
          const createCustomerResponse = await fetch("/api/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: targetName,
              phone: targetPhone,
              email: "",
              notes:
                action.notes ||
                "Auto-created from dashboard AI restaurant suggestion",
              preferredLanguage: action.preferred_language || "English",
            }),
          });

          if (createCustomerResponse.ok) {
            const createdCustomer = (await createCustomerResponse.json()) as {
              id?: string;
            };
            if (createdCustomer?.id) {
              targetCustomerId = createdCustomer.id;
            }
          }
        }
      }
    }

    if (!targetCustomerId) {
      if (fallbackToPrefill) {
        router.push(toPrefillUrl(action));
      }
      return null;
    }

    const scheduledAt = parseIsoFromAction(action);
    if (Number.isNaN(new Date(scheduledAt).getTime())) {
      if (fallbackToPrefill) {
        router.push(toPrefillUrl(action));
      }
      return null;
    }

    const response = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: targetCustomerId,
        scheduledAt,
        callReason: action.call_reason,
        callPurpose: action.call_purpose,
        preferredLanguage: action.preferred_language || "English",
        notes: action.notes,
      }),
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (errorPayload?.error) {
        alert(errorPayload.error);
      }
      if (fallbackToPrefill) {
        router.push(toPrefillUrl(action));
      }
      return null;
    }

    const created = (await response.json()) as ScheduledCallResponse;
    if (created?.id) {
      if (navigateOnSuccess) {
        router.push(`/calls/${created.id}`);
      }
      return created.id;
    }

    if (navigateOnSuccess) {
      router.push("/schedule");
    }
    return null;
  }

  async function handleRunProactiveAction(action: ProactiveAction) {
    setActionCreatingId(action.id);
    try {
      await scheduleProactiveAction(action, {
        navigateOnSuccess: true,
        fallbackToPrefill: true,
      });
    } finally {
      setActionCreatingId(null);
    }
  }

  async function handleScheduleAllValentineCalls() {
    if (visibleValentineRestaurants.length === 0) return;
    setBulkValentineScheduling(true);
    try {
      let scheduledCount = 0;
      for (const restaurant of visibleValentineRestaurants.slice(0, 3)) {
        const createdId = await scheduleProactiveAction(restaurant.call_action, {
          navigateOnSuccess: false,
          fallbackToPrefill: false,
        });
        if (createdId) {
          scheduledCount += 1;
        }
      }

      if (scheduledCount > 0) {
        const insightsRes = await fetch("/api/ai/dashboard-insights");
        if (insightsRes.ok) {
          const payload = (await insightsRes.json()) as DashboardInsights;
          setInsights(payload);
        }
      }
    } finally {
      setBulkValentineScheduling(false);
    }
  }

  async function handleConfirmValentineSelectionAndCall() {
    if (!selectedValentineOption) return;
    setActionCreatingId(selectedValentineOption.call_action.id);
    try {
      await scheduleProactiveAction(selectedValentineOption.call_action, {
        navigateOnSuccess: true,
        fallbackToPrefill: true,
      });
    } finally {
      setActionCreatingId(null);
    }
  }

  function handleDismissProactiveAction(actionId: string) {
    if (actionId === ONSITE_BLOCKER_ACTION_ID) {
      clearOnsiteSearchTimer();
      setFindingOnsiteLocations(false);
      setShowOnsiteLocations(false);
    }
    setDismissedActionIds((current) => {
      if (current.includes(actionId)) return current;
      const next = [...current, actionId];
      writeDismissedActionIds(next);
      return next;
    });
  }

  function handleResetDismissedSuggestions() {
    clearOnsiteSearchTimer();
    setFindingOnsiteLocations(false);
    setDismissedActionIds([]);
    writeDismissedActionIds([]);
    setValentinePanelDismissed(false);
    writeValentinePanelDismissed(false);
    setShowOnsiteLocations(false);
    setSelectedValentineOptionId("");
  }

  function handleDismissValentinePanel() {
    setValentinePanelDismissed(true);
    writeValentinePanelDismissed(true);
  }

  function handleToggleOnsiteLocations() {
    if (showOnsiteLocations) {
      clearOnsiteSearchTimer();
      setFindingOnsiteLocations(false);
      setShowOnsiteLocations(false);
      return;
    }

    if (findingOnsiteLocations) return;

    clearOnsiteSearchTimer();
    setFindingOnsiteLocations(true);
    onsiteSearchTimerRef.current = setTimeout(() => {
      setShowOnsiteLocations(true);
      setFindingOnsiteLocations(false);
      onsiteSearchTimerRef.current = null;
    }, ONSITE_SEARCH_DELAY_MS);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your scheduled calls and evaluations
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Ops Copilot
          </CardTitle>
          {dismissedActionIds.length > 0 || valentinePanelDismissed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetDismissedSuggestions}
            >
              Reset Hidden Suggestions
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {insightsLoading ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating insights...
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-full animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-full animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              </div>
            </div>
          ) : !insights ? (
            <p className="text-sm text-muted-foreground">
              Insights are currently unavailable.
            </p>
          ) : (
            <>
              <p className="text-sm">{aiOpsSummary}</p>
              {hasPriorCalls && insights.source === "fallback" && insights.source_reason ? (
                <p className="text-xs text-amber-700">{insights.source_reason}</p>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Proactive Actions (Auto-filled at 8:00 PM)
                </p>
                {proactiveActionsWithOnsite.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No proactive actions right now.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                    {proactiveActionsWithOnsite.map((action) => {
                      const isOnsiteBlocker = action.id === ONSITE_BLOCKER_ACTION_ID;
                      const isCreating = actionCreatingId === action.id;

                      return (
                      <div key={action.id} className="rounded-lg border p-3">
                        <p className="text-sm font-medium">{action.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {action.scheduled_date} at {action.scheduled_time}
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={isOnsiteBlocker ? findingOnsiteLocations : isCreating}
                            onClick={() => {
                              if (isOnsiteBlocker) {
                                handleToggleOnsiteLocations();
                                return;
                              }
                              void handleRunProactiveAction(action);
                            }}
                          >
                            {isOnsiteBlocker
                              ? findingOnsiteLocations
                                ? "Finding locations..."
                                : showOnsiteLocations
                                ? "Hide Event Locations"
                                : "Find Event Locations"
                              : isCreating
                                ? "Creating..."
                                : "Create Scheduled Call"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDismissProactiveAction(action.id)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    );
                    })}
                    </div>

                    {findingOnsiteLocations &&
                    !showOnsiteLocations &&
                    !dismissedActionIdSet.has(ONSITE_BLOCKER_ACTION_ID) ? (
                      <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        AI is looking for event locations close to Munich...
                      </div>
                    ) : null}

                    {showOnsiteLocations &&
                    !dismissedActionIdSet.has(ONSITE_BLOCKER_ACTION_ID) ? (
                      <div className="space-y-2 rounded-lg border p-3">
                        <p className="text-sm font-medium">
                          Event locations near Munich for company on-site on {COMPANY_ONSITE_DATE_LABEL}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Select a venue and schedule an availability inquiry call.
                        </p>
                        <div className="grid gap-3 md:grid-cols-2">
                          {visibleOnsiteLocations.slice(0, 4).map((location) => (
                            <div key={location.id} className="rounded-lg border p-3">
                              <p className="text-sm font-medium">{location.name}</p>
                              <p className="text-xs text-muted-foreground">{location.area}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {location.address}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {location.phone}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {location.capacity_hint}
                              </p>
                              <div className="mt-3">
                                <Button
                                  size="sm"
                                  disabled={actionCreatingId === location.call_action.id}
                                  onClick={() =>
                                    void handleRunProactiveAction(location.call_action)
                                  }
                                >
                                  {actionCreatingId === location.call_action.id
                                    ? "Creating..."
                                    : "Schedule Availability Inquiry Call"}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {valentineAvailabilitySummary ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>{valentineAvailabilitySummary.title}</span>
              <Badge variant="outline" className="capitalize">
                {valentineAvailabilitySummary.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">{valentineAvailabilitySummary.summary}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {valentineAvailabilitySummary.options.map((option) => {
                const selected = selectedValentineOption?.id === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedValentineOptionId(option.id)}
                    className={`rounded-lg border p-3 text-left transition ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <p className="text-sm font-medium">{option.restaurant_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {option.available_time} - Available
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {option.cuisine} - {option.area}
                    </p>
                  </button>
                );
              })}
            </div>
            <div>
              <Button
                disabled={!selectedValentineOption}
                onClick={() => void handleConfirmValentineSelectionAndCall()}
              >
                {selectedValentineOption &&
                actionCreatingId === selectedValentineOption.call_action.id
                  ? "Creating..."
                  : valentineAvailabilitySummary.confirm_button_label}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!valentinePanelDismissed && visibleValentineRestaurants.length ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5" />
              Valentine Suggestions
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void handleScheduleAllValentineCalls()}
                disabled={bulkValentineScheduling}
              >
                {bulkValentineScheduling
                  ? "Scheduling..."
                  : "Schedule 3 Reservation Calls"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Dismiss Valentine suggestions"
                onClick={handleDismissValentinePanel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              {visibleValentineRestaurants.map((restaurant) => (
                <div key={restaurant.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{restaurant.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {restaurant.cuisine} · {restaurant.area}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {restaurant.address}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {restaurant.phone}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {restaurant.reservation_hint}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={actionCreatingId === restaurant.call_action.id}
                      onClick={() => handleRunProactiveAction(restaurant.call_action)}
                    >
                      {actionCreatingId === restaurant.call_action.id
                        ? "Creating..."
                        : "Schedule Reservation Call"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleDismissProactiveAction(restaurant.call_action.id)
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5" />
              Upcoming Calls
            </CardTitle>
            <Link href="/schedule">
              <Button variant="ghost" size="sm">
                View all
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {upcomingCalls.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No upcoming calls. <Link href="/schedule" className="text-primary underline">Schedule one</Link>
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingCalls.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{call.customer.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(call.scheduledAt), "MMM d, h:mm a")} ·{" "}
                        {call.customer.phone}
                      </p>
                      {(call.callReason || call.callPurpose || call.notes) && (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {call.callReason || call.callPurpose || call.notes}
                        </p>
                      )}
                    </div>
                    <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={statusColor[call.status] || "outline"}>
                        {call.status}
                      </Badge>
                      {call.preferredLanguage ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {call.preferredLanguage}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Recent Evaluations
            </CardTitle>
            <Link href="/calls">
              <Button variant="ghost" size="sm">
                View all
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentEvals.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No evaluations yet. Evaluations appear after calls complete.
              </p>
            ) : (
              <div className="space-y-3">
                {recentEvals.map((ev) => (
                  <Link
                    key={ev.id}
                    href={`/calls/${ev.scheduledCall.id}`}
                    className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
                  >
                    <div>
                      <p className="text-sm font-medium">{ev.scheduledCall.customer.name}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {ev.rationale || "No rationale"}
                      </p>
                    </div>
                    {ev.result === "success" ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : ev.result === "failure" ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-primary/10 p-3">
              <Phone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Calls</p>
              <p className="text-2xl font-bold">{stats.totalCalls}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-yellow-500/10 p-3">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold">{stats.pending}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-green-500/10 p-3">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold">{stats.completed}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
