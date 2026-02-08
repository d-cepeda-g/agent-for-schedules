"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, ExternalLink, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ScheduledCall = {
  id: string;
  scheduledAt: string;
  status: string;
  callReason: string;
  callPurpose: string;
  preferredLanguage: string;
  customer: {
    id: string;
    name: string;
    phone: string;
  };
};

function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthRange(month: Date): { from: Date; to: Date } {
  const from = new Date(month.getFullYear(), month.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export default function CalendarViewPage() {
  const [month, setMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [calls, setCalls] = useState<ScheduledCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [upcomingEvents, setUpcomingEvents] = useState<ScheduledCall[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const { from, to } = monthRange(month);

    async function loadMonthCalls() {
      setLoading(true);
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });

      try {
        const res = await fetch(`/api/calls?${params.toString()}`);
        if (!res.ok) {
          if (active) {
            setCalls([]);
            setLoading(false);
          }
          return;
        }

        const payload = (await res.json()) as ScheduledCall[];
        if (active) {
          setCalls(payload);
          setLoading(false);
        }
      } catch {
        if (active) {
          setCalls([]);
          setLoading(false);
        }
      }
    }

    void loadMonthCalls();
    return () => {
      active = false;
    };
  }, [month]);

  useEffect(() => {
    let active = true;

    async function loadUpcomingEvents() {
      setUpcomingLoading(true);
      try {
        const res = await fetch("/api/calls");
        if (!res.ok) {
          if (active) {
            setUpcomingEvents([]);
            setUpcomingLoading(false);
          }
          return;
        }

        const payload = (await res.json()) as ScheduledCall[];
        if (!active) return;

        const now = Date.now();
        const upcoming = payload
          .filter((call) => {
            const timestamp = new Date(call.scheduledAt).getTime();
            if (!Number.isFinite(timestamp)) return false;
            if (timestamp < now) return false;
            return ["pending", "dispatching", "dispatched"].includes(call.status);
          })
          .sort(
            (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
          )
          .slice(0, 8);

        setUpcomingEvents(upcoming);
        setUpcomingLoading(false);
      } catch {
        if (active) {
          setUpcomingEvents([]);
          setUpcomingLoading(false);
        }
      }
    }

    void loadUpcomingEvents();
    return () => {
      active = false;
    };
  }, []);

  const callsByDay = useMemo(() => {
    const map = new Map<string, ScheduledCall[]>();
    for (const call of calls) {
      const key = toDayKey(new Date(call.scheduledAt));
      const existing = map.get(key) || [];
      existing.push(call);
      map.set(key, existing);
    }
    return map;
  }, [calls]);

  const daysWithCalls = useMemo(
    () => Array.from(callsByDay.keys()).map((key) => new Date(`${key}T00:00:00`)),
    [callsByDay]
  );

  const selectedCalls = useMemo(() => {
    if (!selectedDate) return [];
    const key = toDayKey(selectedDate);
    return (callsByDay.get(key) || []).sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );
  }, [callsByDay, selectedDate]);

  const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    dispatching: "default",
    dispatched: "default",
    completed: "secondary",
    failed: "destructive",
    cancelled: "destructive",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Call Calendar</h1>
        <p className="text-muted-foreground">
          Monthly view of scheduled calls with per-day details
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <Card>
          <CardContent className="p-4">
            <Calendar
              mode="single"
              month={month}
              onMonthChange={setMonth}
              selected={selectedDate}
              onSelect={setSelectedDate}
              modifiers={{ hasCalls: daysWithCalls }}
              modifiersClassNames={{
                hasCalls:
                  "bg-primary/15 text-primary font-semibold rounded-md border border-primary/30",
              }}
              className="rounded-md"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              {selectedDate
                ? `Calls on ${format(selectedDate, "EEEE, MMM d, yyyy")}`
                : "Select a day"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading calls...</p>
            ) : selectedCalls.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No calls on this day.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedCalls.map((call) => (
                  <div key={call.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{call.customer.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(call.scheduledAt), "h:mm a")} · {call.customer.phone}
                        </p>
                      </div>
                      <Badge variant={statusColor[call.status] || "outline"}>{call.status}</Badge>
                    </div>

                    {(call.callReason || call.callPurpose || call.preferredLanguage) && (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {call.callReason && <p>Reason: {call.callReason}</p>}
                        {call.callPurpose && <p>Purpose: {call.callPurpose}</p>}
                        {call.preferredLanguage && (
                          <p>Language: {call.preferredLanguage}</p>
                        )}
                      </div>
                    )}

                    <div className="mt-3">
                      <Link href={`/calls/${call.id}`} className="inline-flex items-center">
                        <Badge variant="secondary" className="gap-1">
                          <Phone className="h-3 w-3" />
                          Open Call
                          <ExternalLink className="h-3 w-3" />
                        </Badge>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Upcoming Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingLoading ? (
            <p className="py-2 text-sm text-muted-foreground">Loading upcoming events...</p>
          ) : upcomingEvents.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No upcoming events yet.
            </p>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.map((call) => (
                <div
                  key={call.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{call.customer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(call.scheduledAt), "EEE, MMM d 'at' h:mm a")} ·{" "}
                      {call.customer.phone}
                    </p>
                    {call.callReason ? (
                      <p className="text-xs text-muted-foreground">{call.callReason}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={statusColor[call.status] || "outline"}>
                      {call.status}
                    </Badge>
                    <Link href={`/calls/${call.id}`} className="inline-flex items-center">
                      <Badge variant="secondary" className="gap-1">
                        Open
                        <ExternalLink className="h-3 w-3" />
                      </Badge>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
