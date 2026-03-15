"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { DashboardInsights, ProactiveAction, OnsiteLocationSuggestion } from "./types";
import { ONSITE_BLOCKER_ACTION_ID, COMPANY_ONSITE_DATE_LABEL } from "./helpers";

function InsightsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Generating insights...
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionCard({
  action,
  isCreating,
  isOnsiteBlocker,
  findingOnsiteLocations,
  showOnsiteLocations,
  onRun,
  onToggleOnsite,
  onDismiss,
}: {
  action: ProactiveAction;
  isCreating: boolean;
  isOnsiteBlocker: boolean;
  findingOnsiteLocations: boolean;
  showOnsiteLocations: boolean;
  onRun: () => void;
  onToggleOnsite: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{action.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {action.scheduled_date} at {action.scheduled_time}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={isOnsiteBlocker ? findingOnsiteLocations : isCreating}
          onClick={isOnsiteBlocker ? onToggleOnsite : onRun}
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
        <Button variant="outline" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function OnsiteLocationsPanel({
  locations,
  actionCreatingId,
  onRunAction,
}: {
  locations: OnsiteLocationSuggestion[];
  actionCreatingId: string | null;
  onRunAction: (action: ProactiveAction) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">
        Event locations near Munich for company on-site on {COMPANY_ONSITE_DATE_LABEL}
      </p>
      <p className="text-xs text-muted-foreground">
        Select a venue and schedule an availability inquiry call.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {locations.slice(0, 4).map((location) => (
          <div key={location.id} className="rounded-lg border p-3">
            <p className="text-sm font-medium">{location.name}</p>
            <p className="text-xs text-muted-foreground">{location.area}</p>
            <p className="mt-1 text-xs text-muted-foreground">{location.address}</p>
            <p className="mt-1 text-xs text-muted-foreground">{location.phone}</p>
            <p className="mt-1 text-xs text-muted-foreground">{location.capacity_hint}</p>
            <div className="mt-3">
              <Button
                size="sm"
                disabled={actionCreatingId === location.call_action.id}
                onClick={() => onRunAction(location.call_action)}
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
  );
}

export function AiOpsCopilot({
  insights,
  insightsLoading,
  hasPriorCalls,
  proactiveActions,
  visibleOnsiteLocations,
  actionCreatingId,
  findingOnsiteLocations,
  showOnsiteLocations,
  dismissedActionIdSet,
  onRunAction,
  onDismissAction,
  onToggleOnsiteLocations,
}: {
  insights: DashboardInsights | null;
  insightsLoading: boolean;
  hasPriorCalls: boolean;
  proactiveActions: ProactiveAction[];
  visibleOnsiteLocations: OnsiteLocationSuggestion[];
  actionCreatingId: string | null;
  findingOnsiteLocations: boolean;
  showOnsiteLocations: boolean;
  dismissedActionIdSet: Set<string>;
  onRunAction: (action: ProactiveAction) => void;
  onDismissAction: (actionId: string) => void;
  onToggleOnsiteLocations: () => void;
}) {
  const aiOpsSummary = (() => {
    if (!insights) return "";
    if (hasPriorCalls) return insights.summary;
    return "No previous calls have been made yet. Once your first call is completed, AI Ops will summarize outcomes here.";
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Ops Copilot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {insightsLoading ? (
          <InsightsSkeleton />
        ) : !insights ? (
          <p className="text-sm text-muted-foreground">Insights are currently unavailable.</p>
        ) : (
          <>
            <p className="text-sm">{aiOpsSummary}</p>
            {hasPriorCalls && insights.source === "fallback" && insights.source_reason ? (
              <p className="text-xs text-muted-foreground">{insights.source_reason}</p>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Proactive Actions (Auto-filled at 8:00 PM)
              </p>
              {proactiveActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No proactive actions right now.</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    {proactiveActions.map((action) => (
                      <ActionCard
                        key={action.id}
                        action={action}
                        isCreating={actionCreatingId === action.id}
                        isOnsiteBlocker={action.id === ONSITE_BLOCKER_ACTION_ID}
                        findingOnsiteLocations={findingOnsiteLocations}
                        showOnsiteLocations={showOnsiteLocations}
                        onRun={() => onRunAction(action)}
                        onToggleOnsite={onToggleOnsiteLocations}
                        onDismiss={() => onDismissAction(action.id)}
                      />
                    ))}
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
                    <OnsiteLocationsPanel
                      locations={visibleOnsiteLocations}
                      actionCreatingId={actionCreatingId}
                      onRunAction={onRunAction}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
