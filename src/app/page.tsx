"use client";

import { useEffect, useState } from "react";
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
  CalendarPlus,
  Phone,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  ArrowRight,
  Play,
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

export default function DashboardPage() {
  const router = useRouter();
  const [upcomingCalls, setUpcomingCalls] = useState<Call[]>([]);
  const [recentEvals, setRecentEvals] = useState<Evaluation[]>([]);
  const [quickCalling, setQuickCalling] = useState(false);
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
        const evaluations = calls
          .filter((c) => c.evaluation)
          .map((c) => c.evaluation!);
        const successes = evaluations.filter(
          (e) => e.result === "success"
        ).length;

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
  }, []);

  const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    dispatching: "default",
    dispatched: "default",
    completed: "secondary",
    failed: "destructive",
    cancelled: "destructive",
  };

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
        alert(payload?.error || "Failed to trigger quick call");
        return;
      }

      router.push(`/calls/${payload.call.id}`);
    } finally {
      setQuickCalling(false);
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
                No upcoming calls.{" "}
                <Link href="/schedule" className="text-primary underline">
                  Schedule one
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingCalls.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {call.customer.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(
                          new Date(call.scheduledAt),
                          "MMM d, h:mm a"
                        )}
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
                      <p className="text-sm font-medium">
                        {ev.scheduledCall.customer.name}
                      </p>
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
