"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

import type {
  Call,
  Evaluation,
  DashboardInsights,
  ProactiveAction,
  CustomerLookup,
  ScheduledCallResponse,
} from "@/components/dashboard/types";
import {
  ONSITE_BLOCKER_ACTION_ID,
  ONSITE_SEARCH_DELAY_MS,
  readDismissedActionIds,
  writeDismissedActionIds,
  readValentinePanelDismissed,
  writeValentinePanelDismissed,
  normalizePhoneForMatch,
  getNextBusinessDayDateOnly,
  buildOnsiteBlockerAction,
  buildOnsiteLocationSuggestions,
  parseIsoFromAction,
  toPrefillUrl,
  hasPreviousCallHistory,
} from "@/components/dashboard/helpers";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { UpcomingCalls } from "@/components/dashboard/upcoming-calls";
import { RecentEvaluations } from "@/components/dashboard/recent-evaluations";
import { AiOpsCopilot } from "@/components/dashboard/ai-ops-copilot";
import { ValentinePanel } from "@/components/dashboard/valentine-panel";

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
  const [stats, setStats] = useState({ totalCalls: 0, pending: 0, completed: 0 });

  useEffect(() => {
    fetch("/api/calls")
      .then((r) => r.json())
      .then((calls: Call[]) => {
        const pending = calls.filter((c) => c.status === "pending");
        const completed = calls.filter((c) => c.status === "completed");
        setUpcomingCalls(
          pending
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
            .slice(0, 5)
        );
        setStats({ totalCalls: calls.length, pending: pending.length, completed: completed.length });
        setHasPriorCalls(hasPreviousCallHistory(calls));
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

  useEffect(() => () => clearOnsiteSearchTimer(), []);

  const dismissedActionIdSet = useMemo(() => new Set(dismissedActionIds), [dismissedActionIds]);
  const onsiteInquiryDate = useMemo(() => getNextBusinessDayDateOnly(), []);
  const onsiteBlockerAction = useMemo(() => buildOnsiteBlockerAction(onsiteInquiryDate), [onsiteInquiryDate]);
  const onsiteLocations = useMemo(() => buildOnsiteLocationSuggestions(onsiteInquiryDate), [onsiteInquiryDate]);

  const sortedActions = useMemo(() => {
    const visible = insights?.proactive_actions?.filter((a) => !dismissedActionIdSet.has(a.id)) || [];
    if (!hasPriorCalls) return [];
    return visible.slice(0, 6);
  }, [insights, dismissedActionIdSet, hasPriorCalls]);

  const proactiveActionsWithOnsite = useMemo(() => {
    const actions = sortedActions.filter((a) => a.id !== ONSITE_BLOCKER_ACTION_ID);
    if (dismissedActionIdSet.has(ONSITE_BLOCKER_ACTION_ID)) return actions;
    return [onsiteBlockerAction, ...actions];
  }, [sortedActions, dismissedActionIdSet, onsiteBlockerAction]);

  const visibleValentineRestaurants = useMemo(
    () =>
      insights?.valentines?.restaurants
        ?.filter((r) => !dismissedActionIdSet.has(r.call_action.id))
        .slice(0, 3) || [],
    [insights, dismissedActionIdSet]
  );

  const visibleOnsiteLocations = useMemo(
    () => onsiteLocations.filter((l) => !dismissedActionIdSet.has(l.call_action.id)),
    [onsiteLocations, dismissedActionIdSet]
  );

  async function scheduleProactiveAction(
    action: ProactiveAction,
    options?: { navigateOnSuccess?: boolean; fallbackToPrefill?: boolean }
  ): Promise<string | null> {
    const navigateOnSuccess = options?.navigateOnSuccess ?? true;
    const fallbackToPrefill = options?.fallbackToPrefill ?? true;
    let targetCustomerId = action.customer_id;

    if (!targetCustomerId) {
      const targetName = action.target_name?.trim() || "";
      const targetPhone = action.target_phone?.trim() || "";

      if (targetName && targetPhone) {
        const lookupResponse = await fetch(`/api/customers?q=${encodeURIComponent(targetPhone)}`);
        if (lookupResponse.ok) {
          const candidates = (await lookupResponse.json()) as CustomerLookup[];
          const normalizedTargetPhone = normalizePhoneForMatch(targetPhone);
          const exactMatch = candidates.find(
            (c) => normalizePhoneForMatch(c.phone) === normalizedTargetPhone
          );
          if (exactMatch?.id) targetCustomerId = exactMatch.id;
        }

        if (!targetCustomerId) {
          const createRes = await fetch("/api/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: targetName,
              phone: targetPhone,
              email: "",
              notes: action.notes || "Auto-created from dashboard suggestion",
              preferredLanguage: action.preferred_language || "English",
            }),
          });
          if (createRes.ok) {
            const created = (await createRes.json()) as { id?: string };
            if (created?.id) targetCustomerId = created.id;
          }
        }
      }
    }

    if (!targetCustomerId) {
      if (fallbackToPrefill) router.push(toPrefillUrl(action));
      return null;
    }

    const scheduledAt = parseIsoFromAction(action);
    if (Number.isNaN(new Date(scheduledAt).getTime())) {
      if (fallbackToPrefill) router.push(toPrefillUrl(action));
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
      const err = (await response.json().catch(() => null)) as { error?: string } | null;
      if (err?.error) alert(err.error);
      if (fallbackToPrefill) router.push(toPrefillUrl(action));
      return null;
    }

    const created = (await response.json()) as ScheduledCallResponse;
    if (created?.id) {
      if (navigateOnSuccess) router.push(`/calls/${created.id}`);
      return created.id;
    }

    if (navigateOnSuccess) router.push("/schedule");
    return null;
  }

  async function handleRunProactiveAction(action: ProactiveAction) {
    setActionCreatingId(action.id);
    try {
      await scheduleProactiveAction(action);
    } finally {
      setActionCreatingId(null);
    }
  }

  async function handleScheduleAllValentineCalls() {
    if (visibleValentineRestaurants.length === 0) return;
    setBulkValentineScheduling(true);
    try {
      let count = 0;
      for (const r of visibleValentineRestaurants.slice(0, 3)) {
        const id = await scheduleProactiveAction(r.call_action, {
          navigateOnSuccess: false,
          fallbackToPrefill: false,
        });
        if (id) count += 1;
      }
      if (count > 0) {
        setValentinePanelDismissed(true);
        writeValentinePanelDismissed(true);
        const res = await fetch("/api/ai/dashboard-insights");
        if (res.ok) setInsights((await res.json()) as DashboardInsights);
      }
    } finally {
      setBulkValentineScheduling(false);
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
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of your scheduled calls and evaluations
        </p>
      </div>

      {!valentinePanelDismissed && visibleValentineRestaurants.length > 0 ? (
        <ValentinePanel
          restaurants={visibleValentineRestaurants}
          actionCreatingId={actionCreatingId}
          bulkScheduling={bulkValentineScheduling}
          onScheduleAll={() => void handleScheduleAllValentineCalls()}
          onScheduleOne={(a) => void handleRunProactiveAction(a)}
          onDismissOne={handleDismissProactiveAction}
          onDismissPanel={() => {
            setValentinePanelDismissed(true);
            writeValentinePanelDismissed(true);
          }}
        />
      ) : null}

      <AiOpsCopilot
        insights={insights}
        insightsLoading={insightsLoading}
        hasPriorCalls={hasPriorCalls}
        proactiveActions={proactiveActionsWithOnsite}
        visibleOnsiteLocations={visibleOnsiteLocations}
        actionCreatingId={actionCreatingId}
        findingOnsiteLocations={findingOnsiteLocations}
        showOnsiteLocations={showOnsiteLocations}
        dismissedActionIdSet={dismissedActionIdSet}
        onRunAction={(a) => void handleRunProactiveAction(a)}
        onDismissAction={handleDismissProactiveAction}
        onToggleOnsiteLocations={handleToggleOnsiteLocations}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <UpcomingCalls calls={upcomingCalls} />
        <RecentEvaluations evaluations={recentEvals} />
      </div>

      <StatsCards stats={stats} />

      {dismissedActionIds.length > 0 || valentinePanelDismissed ? (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={handleResetDismissedSuggestions}
          >
            Reset Hidden Suggestions
          </Button>
        </div>
      ) : null}
    </div>
  );
}
