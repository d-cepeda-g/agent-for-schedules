"use client";

import { useEffect, useMemo, useState } from "react";
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
  Phone,
  Play,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";

type Call = {
  id: string;
  scheduledAt: string;
  status: string;
  notes: string;
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

type ScheduledCallResponse = {
  id: string;
};

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

export default function DashboardPage() {
  const router = useRouter();
  const [upcomingCalls, setUpcomingCalls] = useState<Call[]>([]);
  const [recentEvals, setRecentEvals] = useState<Evaluation[]>([]);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [quickCalling, setQuickCalling] = useState(false);
  const [actionCreatingId, setActionCreatingId] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalCalls: 0,
    pending: 0,
    completed: 0,
    successRate: 0,
  });

  useEffect(() => {
    fetch("/api/calls")
      .then((r) => r.json())
      .then((calls: Call[]) => {
        const pending = calls.filter((c) => c.status === "pending");
        const completed = calls.filter((c) => c.status === "completed");
        const evaluations = calls.filter((c) => c.evaluation).map((c) => c.evaluation!);
        const successes = evaluations.filter((e) => e.result === "success").length;

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
          successRate:
            evaluations.length > 0
              ? Math.round((successes / evaluations.length) * 100)
              : 0,
        });
      })
      .catch(() => {
        setUpcomingCalls([]);
        setStats({ totalCalls: 0, pending: 0, completed: 0, successRate: 0 });
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

  const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    dispatching: "default",
    dispatched: "default",
    completed: "secondary",
    failed: "destructive",
    cancelled: "destructive",
  };

  const sortedActions = useMemo(
    () => insights?.proactive_actions?.slice(0, 6) || [],
    [insights]
  );

  async function handleQuickCallDavid() {
    setQuickCalling(true);
    try {
      const res = await fetch("/api/calls/quick-david", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callReason:
            "Reminder for clinic appointment at Kaulbachstraße on July 25",
          callPurpose:
            "Remind David to set up his clinic appointment at Kaulbachstraße for July 25 and confirm availability at that time",
          preferredLanguage: "English",
          notes:
            "Please remind David Cepeda to book his appointment at the Kaulbachstraße clinic for July 25 and confirm if that time works for him.",
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | { call?: { id: string }; error?: string }
        | null;

      if (!res.ok || !payload?.call?.id) {
        if (payload?.error) {
          alert(payload.error);
          return;
        }

        const fallbackMessage = await res
          .text()
          .catch(() => "Failed to trigger quick call");
        alert(fallbackMessage || "Failed to trigger quick call");
        return;
      }

      router.push(`/calls/${payload.call.id}`);
    } finally {
      setQuickCalling(false);
    }
  }

  async function handleRunProactiveAction(action: ProactiveAction) {
    if (!action.customer_id) {
      router.push(toPrefillUrl(action));
      return;
    }

    setActionCreatingId(action.id);
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: action.customer_id,
          scheduledAt: parseIsoFromAction(action),
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
        router.push(toPrefillUrl(action));
        return;
      }

      const created = (await response.json()) as ScheduledCallResponse;
      if (created?.id) {
        router.push(`/calls/${created.id}`);
      } else {
        router.push("/schedule");
      }
    } finally {
      setActionCreatingId(null);
    }
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
        <Button onClick={handleQuickCallDavid} disabled={quickCalling}>
          <Play className="mr-2 h-4 w-4" />
          {quickCalling ? "Calling David..." : "Call David Cepeda Now"}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-blue-500/10 p-3">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Success Rate</p>
              <p className="text-2xl font-bold">{stats.successRate}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Ops Copilot
          </CardTitle>
          {insights?.source && (
            <Badge variant={insights.source === "openai" ? "default" : "outline"}>
              {insights.source === "openai" ? "OpenAI" : "Fallback"}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {insightsLoading ? (
            <p className="text-sm text-muted-foreground">Generating insights...</p>
          ) : !insights ? (
            <p className="text-sm text-muted-foreground">
              Insights are currently unavailable.
            </p>
          ) : (
            <>
              <p className="text-sm">{insights.summary}</p>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Important Things
                </p>
                {insights.important_things.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No key items detected.</p>
                ) : (
                  <div className="space-y-2">
                    {insights.important_things.map((item, idx) => (
                      <p key={`${item}-${idx}`} className="text-sm text-muted-foreground">
                        {item}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Proactive Actions (Auto-filled at 8:00 PM)
                </p>
                {sortedActions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No proactive actions right now.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {sortedActions.map((action) => (
                      <div key={action.id} className="rounded-lg border p-3">
                        <p className="text-sm font-medium">{action.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {action.scheduled_date} at {action.scheduled_time}
                        </p>
                        <Button
                          className="mt-3"
                          size="sm"
                          disabled={actionCreatingId === action.id}
                          onClick={() => handleRunProactiveAction(action)}
                        >
                          {actionCreatingId === action.id
                            ? "Creating..."
                            : "Create Scheduled Call"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {insights?.valentines?.restaurants?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5" />
              Valentine Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{insights.valentines.prompt}</p>
            <div className="grid gap-3 md:grid-cols-3">
              {insights.valentines.restaurants.slice(0, 3).map((restaurant) => (
                <div key={restaurant.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{restaurant.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {restaurant.cuisine} · {restaurant.area}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {restaurant.reservation_hint}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    disabled={actionCreatingId === restaurant.call_action.id}
                    onClick={() => handleRunProactiveAction(restaurant.call_action)}
                  >
                    {actionCreatingId === restaurant.call_action.id
                      ? "Creating..."
                      : "Schedule Reservation Call"}
                  </Button>
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
                    <div>
                      <p className="text-sm font-medium">{call.customer.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(call.scheduledAt), "MMM d, h:mm a")}
                      </p>
                    </div>
                    <Badge variant={statusColor[call.status] || "outline"}>
                      {call.status}
                    </Badge>
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
    </div>
  );
}
