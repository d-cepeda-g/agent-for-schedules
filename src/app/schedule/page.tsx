"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { CalendarPlus, Clock, Phone, Trash2 } from "lucide-react";

type Customer = {
  id: string;
  name: string;
  phone: string;
  preferredLanguage: string;
};

type ScheduledCall = {
  id: string;
  customerId: string;
  scheduledAt: string;
  status: string;
  notes: string;
  callReason: string;
  callPurpose: string;
  preferredLanguage: string;
  customer: { id: string; name: string; phone: string };
};

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeOnly(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export default function SchedulePage() {
  const searchParams = useSearchParams();
  const hasAppliedPrefill = useRef(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    new Date()
  );
  const [customerId, setCustomerId] = useState("");
  const [time, setTime] = useState("09:00");
  const [callReason, setCallReason] = useState("");
  const [callPurpose, setCallPurpose] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("English");
  const [notes, setNotes] = useState("");
  const [daysCalls, setDaysCalls] = useState<ScheduledCall[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadCustomers() {
      try {
        const response = await fetch("/api/customers");
        if (!response.ok) return;
        const data = (await response.json()) as Customer[];
        if (active) setCustomers(data);
      } catch {
        // Ignore transient fetch errors and keep current UI state.
      }
    }

    void loadCustomers();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (hasAppliedPrefill.current) return;

    const prefillReason = searchParams.get("callReason");
    const prefillPurpose = searchParams.get("callPurpose");
    const prefillNotes = searchParams.get("notes");
    const prefillLanguage = searchParams.get("preferredLanguage");
    const prefillDate = searchParams.get("date");
    const prefillTime = searchParams.get("time");
    const prefillCustomerId = searchParams.get("customerId");

    if (prefillCustomerId && customers.length === 0) return;

    if (prefillReason) setCallReason(prefillReason);
    if (prefillPurpose) setCallPurpose(prefillPurpose);
    if (prefillNotes) setNotes(prefillNotes);
    if (prefillLanguage) setPreferredLanguage(prefillLanguage);
    if (prefillTime && isTimeOnly(prefillTime)) setTime(prefillTime);

    if (prefillDate && isDateOnly(prefillDate)) {
      const [year, month, day] = prefillDate.split("-").map(Number);
      const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
      if (!Number.isNaN(parsed.getTime())) {
        setSelectedDate(parsed);
      }
    }

    if (prefillCustomerId && customers.some((customer) => customer.id === prefillCustomerId)) {
      setCustomerId(prefillCustomerId);
      if (!prefillLanguage) {
        const selectedCustomer = customers.find(
          (customer) => customer.id === prefillCustomerId
        );
        if (selectedCustomer?.preferredLanguage) {
          setPreferredLanguage(selectedCustomer.preferredLanguage);
        }
      }
    }

    hasAppliedPrefill.current = true;
  }, [customers, searchParams]);

  useEffect(() => {
    let active = true;
    const currentDate = selectedDate;
    if (!currentDate) return;

    async function loadCallsForDay() {
      if (!currentDate) return;
      const from = new Date(currentDate);
      from.setHours(0, 0, 0, 0);
      const to = new Date(currentDate);
      to.setHours(23, 59, 59, 999);

      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });

      try {
        const response = await fetch(`/api/calls?${params}`);
        if (!response.ok) return;
        const data = (await response.json()) as ScheduledCall[];
        if (active) setDaysCalls(data);
      } catch {
        // Ignore transient fetch errors and keep current UI state.
      }
    }

    void loadCallsForDay();
    return () => {
      active = false;
    };
  }, [selectedDate, refreshKey]);

  function refreshDayCalls() {
    setRefreshKey((value) => value + 1);
  }

  function handleCustomerSelection(selectedCustomerId: string) {
    setCustomerId(selectedCustomerId);
    const selectedCustomer = customers.find(
      (customer) => customer.id === selectedCustomerId
    );
    if (selectedCustomer?.preferredLanguage) {
      setPreferredLanguage(selectedCustomer.preferredLanguage);
    }
  }

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDate || !customerId) return;

    setSubmitting(true);
    const [hours, minutes] = time.split(":").map(Number);
    const scheduledAt = new Date(selectedDate);
    scheduledAt.setHours(hours, minutes, 0, 0);

    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          scheduledAt: scheduledAt.toISOString(),
          callReason,
          callPurpose,
          preferredLanguage,
          notes,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error || "Failed to schedule call");
        return;
      }

      setNotes("");
      setCallReason("");
      setCallPurpose("");
      refreshDayCalls();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(callId: string) {
    const response = await fetch(`/api/calls/${callId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      alert(data?.error || "Failed to cancel call");
      return;
    }

    refreshDayCalls();
  }

  const statusColor: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
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
        <h1 className="text-2xl font-bold">Schedule Calls</h1>
        <p className="text-muted-foreground">
          Pick a date and time, then assign a customer
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <Card>
          <CardContent className="p-4">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              className="rounded-md"
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarPlus className="h-5 w-5" />
                New Call
                {selectedDate && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {format(selectedDate, "EEEE, MMMM d, yyyy")}
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Schedule an outbound AI call to a customer
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSchedule} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Customer</Label>
                    <Select
                      value={customerId}
                      onValueChange={handleCustomerSelection}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select customer" />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} ({c.phone})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Time</Label>
                    <Input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Reason for call</Label>
                    <Input
                      value={callReason}
                      onChange={(e) => setCallReason(e.target.value)}
                      placeholder="e.g., Appointment scheduling"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Preferred language</Label>
                    <Select
                      value={preferredLanguage}
                      onValueChange={setPreferredLanguage}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="English">English</SelectItem>
                        <SelectItem value="Spanish">Spanish</SelectItem>
                        <SelectItem value="German">German</SelectItem>
                        <SelectItem value="French">French</SelectItem>
                        <SelectItem value="Turkish">Turkish</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Purpose</Label>
                  <Textarea
                    value={callPurpose}
                    onChange={(e) => setCallPurpose(e.target.value)}
                    placeholder="e.g., Help patient book annual checkup this week"
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes (optional agent context)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g., Follow up on subscription renewal"
                    rows={2}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!customerId || !selectedDate || submitting}
                >
                  {submitting ? "Scheduling..." : "Schedule Call"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Calls on {selectedDate ? format(selectedDate, "MMM d, yyyy") : "..."}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {daysCalls.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No calls scheduled for this day
                </p>
              ) : (
                <div className="space-y-3">
                  {daysCalls.map((call) => (
                    <div
                      key={call.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{call.customer.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(call.scheduledAt), "h:mm a")} &middot;{" "}
                            {call.customer.phone}
                          </p>
                          {call.callReason && (
                            <p className="text-xs text-muted-foreground">
                              {call.callReason}
                              {call.preferredLanguage
                                ? ` · ${call.preferredLanguage}`
                                : ""}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={statusColor[call.status] || "outline"}>
                          {call.status}
                        </Badge>
                        {call.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCancel(call.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
