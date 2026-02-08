"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Phone,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  MessageSquare,
  ListTodo,
  History,
  Trash2,
} from "lucide-react";

type CallDetail = {
  id: string;
  scheduledAt: string;
  status: string;
  notes: string;
  callReason: string;
  callPurpose: string;
  preferredLanguage: string;
  conversationId: string;
  agentId: string;
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string;
  };
  evaluation: {
    id: string;
    result: string;
    rationale: string;
    transcript: string;
    duration: number;
    createdAt: string;
  } | null;
  actionItems: Array<{
    id: string;
    title: string;
    detail: string;
    source: string;
    completed: boolean;
    createdAt: string;
  }>;
  logs: Array<{
    id: string;
    event: string;
    level: string;
    message: string;
    details: string;
    createdAt: string;
  }>;
};

type CustomerOption = {
  id: string;
  name: string;
  phone: string;
  preferredLanguage: string;
};

function isCallDetail(payload: unknown): payload is CallDetail {
  if (!payload || typeof payload !== "object") return false;

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.scheduledAt === "string" &&
    typeof candidate.conversationId === "string" &&
    typeof candidate.customer === "object" &&
    candidate.customer !== null
  );
}

function formatLogDetails(details: string): string {
  const trimmed = details.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return trimmed;
  }
}

function toLocalDateTimeInputParts(value: string): { date: string; time: string } {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: "", time: "" };
  }

  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  const hours = `${parsed.getHours()}`.padStart(2, "0");
  const minutes = `${parsed.getMinutes()}`.padStart(2, "0");

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
}

function toIsoFromDateTimeInputs(dateInput: string, timeInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeInput)) return null;

  const [year, month, day] = dateInput.split("-").map(Number);
  const [hour, minute] = timeInput.split(":").map(Number);
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

export default function CallDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [fetchingEval, setFetchingEval] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingCall, setDeletingCall] = useState(false);
  const [editCustomerId, setEditCustomerId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [editLanguage, setEditLanguage] = useState("English");
  const [editNotes, setEditNotes] = useState("");

  const callId = params.id as string;

  function applyCallToEditForm(nextCall: CallDetail) {
    const { date, time } = toLocalDateTimeInputParts(nextCall.scheduledAt);
    setEditCustomerId(nextCall.customer.id || "");
    setEditDate(date);
    setEditTime(time);
    setEditReason(nextCall.callReason || "");
    setEditPurpose(nextCall.callPurpose || "");
    setEditLanguage(nextCall.preferredLanguage || "English");
    setEditNotes(nextCall.notes || "");
  }

  async function refreshCallDetails(): Promise<CallDetail | null> {
    const response = await fetch(`/api/calls/${callId}`);
    const data = (await response.json().catch(() => null)) as
      | CallDetail
      | { error?: string }
      | null;

    if (!response.ok || !data || "error" in data || !isCallDetail(data)) {
      return null;
    }

    setCall(data);
    setErrorMessage(null);
    applyCallToEditForm(data);
    return data;
  }

  useEffect(() => {
    let active = true;

    async function loadCall() {
      try {
        const response = await fetch(`/api/calls/${callId}`);
        const data = (await response.json().catch(() => null)) as
          | CallDetail
          | { error?: string }
          | null;

        if (!active) return;

        if (!response.ok || !data || "error" in data) {
          setCall(null);
          setErrorMessage(
            (data && "error" in data ? data.error : null) || "Call not found"
          );
          setLoading(false);
          return;
        }

        if (!isCallDetail(data)) {
          setCall(null);
          setErrorMessage("Call response had an unexpected format");
          setLoading(false);
          return;
        }

        setCall(data);
        applyCallToEditForm(data);
        setEditing(false);
        setErrorMessage(null);
        setLoading(false);
      } catch {
        if (!active) return;
        setCall(null);
        setErrorMessage("Failed to load call details");
        setLoading(false);
      }
    }

    void loadCall();
    return () => {
      active = false;
    };
  }, [callId]);

  useEffect(() => {
    let active = true;

    async function loadCustomers() {
      try {
        const response = await fetch("/api/customers");
        if (!response.ok) return;
        const data = (await response.json()) as CustomerOption[];
        if (!active || !Array.isArray(data)) return;
        setCustomers(data);
      } catch {
        // Keep existing state on transient failure.
      }
    }

    void loadCustomers();
    return () => {
      active = false;
    };
  }, []);

  function handleAssignedCustomerChange(nextCustomerId: string) {
    setEditCustomerId(nextCustomerId);
    const selected = customers.find((customer) => customer.id === nextCustomerId);
    if (selected?.preferredLanguage) {
      setEditLanguage(selected.preferredLanguage);
    }
  }

  async function handleDispatch() {
    setDispatching(true);
    try {
      const res = await fetch(`/api/calls/${callId}/dispatch`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to dispatch");
        return;
      }
      await refreshCallDetails();
    } finally {
      setDispatching(false);
    }
  }

  async function handleFetchEvaluation() {
    setFetchingEval(true);
    try {
      const res = await fetch(`/api/calls/${callId}/evaluation`);
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to fetch evaluation");
        return;
      }
      await refreshCallDetails();
    } finally {
      setFetchingEval(false);
    }
  }

  async function handleSaveEdits(e: React.FormEvent) {
    e.preventDefault();
    if (!call) return;

    if (!editCustomerId) {
      alert("Please select an assigned contact.");
      return;
    }

    const scheduledAt = toIsoFromDateTimeInputs(editDate, editTime);
    if (!scheduledAt) {
      alert("Please enter a valid date and time.");
      return;
    }

    setSavingEdit(true);
    try {
      const response = await fetch(`/api/calls/${call.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: editCustomerId,
          scheduledAt,
          callReason: editReason,
          callPurpose: editPurpose,
          preferredLanguage: editLanguage,
          notes: editNotes,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | CallDetail
        | { error?: string }
        | null;

      if (!response.ok || (payload && "error" in payload)) {
        const message =
          (payload && "error" in payload ? payload.error : null) ||
          "Failed to update call";
        alert(message);
        return;
      }

      await refreshCallDetails();
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  }

  function handleCancelEdit() {
    if (!call) return;
    applyCallToEditForm(call);
    setEditing(false);
  }

  async function handleDeleteCall() {
    if (!call) return;

    const confirmed = window.confirm(
      "Delete this scheduled call permanently? This cannot be undone."
    );
    if (!confirmed) return;

    setDeletingCall(true);
    try {
      const response = await fetch(`/api/calls/${call.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        alert(payload?.error || "Failed to delete call");
        return;
      }

      router.push("/calls");
    } finally {
      setDeletingCall(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading call details...</p>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">{errorMessage || "Call not found"}</p>
      </div>
    );
  }

  const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    dispatching: "default",
    dispatched: "default",
    completed: "secondary",
    failed: "destructive",
    cancelled: "destructive",
  };

  const transcriptLines = call.evaluation?.transcript
    ?.split("\n")
    .filter(Boolean) || [];
  const actionItems = call.actionItems || [];
  const logs = call.logs || [];
  const canEditCall = !["completed", "cancelled"].includes(call.status);

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => router.push("/calls")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Calls
      </Button>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5" />
                  Call to {call.customer.name}
                </CardTitle>
                <Badge variant={statusColor[call.status] || "outline"}>
                  {call.status}
                </Badge>
              </div>
              <CardDescription>
                Scheduled for{" "}
                {format(
                  new Date(call.scheduledAt),
                  "EEEE, MMMM d, yyyy 'at' h:mm a"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {call.notes && (
                <div>
                  <p className="text-sm font-medium">Notes</p>
                  <p className="text-sm text-muted-foreground">{call.notes}</p>
                </div>
              )}
              {(call.callReason || call.callPurpose || call.preferredLanguage) && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">Agent Context</p>
                  {call.callReason && (
                    <p className="text-sm text-muted-foreground">
                      Reason: {call.callReason}
                    </p>
                  )}
                  {call.callPurpose && (
                    <p className="text-sm text-muted-foreground">
                      Purpose: {call.callPurpose}
                    </p>
                  )}
                  {call.preferredLanguage && (
                    <p className="text-sm text-muted-foreground">
                      Language: {call.preferredLanguage}
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                {["pending", "failed"].includes(call.status) &&
                  new Date(call.scheduledAt).getTime() <= Date.now() && (
                  <Button
                    onClick={handleDispatch}
                    disabled={dispatching}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {dispatching
                      ? "Dispatching..."
                      : call.status === "failed"
                        ? "Retry Call"
                        : "Dispatch Call Now"}
                  </Button>
                )}
                {call.conversationId && !call.evaluation && (
                  <Button
                    variant="outline"
                    onClick={handleFetchEvaluation}
                    disabled={fetchingEval}
                  >
                    {fetchingEval
                      ? "Fetching..."
                      : "Fetch Evaluation"}
                  </Button>
                )}
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Edit Scheduled Call</p>
                  <div className="flex items-center gap-2">
                    {!editing ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canEditCall}
                        onClick={() => setEditing(true)}
                      >
                        Edit
                      </Button>
                    ) : null}
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!canEditCall || deletingCall || savingEdit}
                      onClick={() => void handleDeleteCall()}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {deletingCall ? "Deleting..." : "Delete Call"}
                    </Button>
                  </div>
                </div>

                {!canEditCall ? (
                  <p className="text-xs text-muted-foreground">
                    This call can no longer be edited after it is completed or cancelled.
                  </p>
                ) : editing ? (
                  <form onSubmit={handleSaveEdits} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Assigned contact</Label>
                      <Select
                        value={editCustomerId}
                        onValueChange={handleAssignedCustomerChange}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select contact" />
                        </SelectTrigger>
                        <SelectContent>
                          {customers.map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name} ({customer.phone})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-call-date">Date</Label>
                        <Input
                          id="edit-call-date"
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-call-time">Time</Label>
                        <Input
                          id="edit-call-time"
                          type="time"
                          value={editTime}
                          onChange={(e) => setEditTime(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="edit-call-reason">Reason</Label>
                      <Input
                        id="edit-call-reason"
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        placeholder="Reason for the call"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="edit-call-purpose">Purpose</Label>
                      <Textarea
                        id="edit-call-purpose"
                        value={editPurpose}
                        onChange={(e) => setEditPurpose(e.target.value)}
                        placeholder="What should the call achieve?"
                        rows={2}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="edit-call-language">Preferred language</Label>
                      <Input
                        id="edit-call-language"
                        value={editLanguage}
                        onChange={(e) => setEditLanguage(e.target.value)}
                        placeholder="English"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="edit-call-notes">Notes</Label>
                      <Textarea
                        id="edit-call-notes"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Extra context for the agent"
                        rows={3}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Button type="submit" disabled={savingEdit}>
                        {savingEdit ? "Saving..." : "Save Changes"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancelEdit}
                        disabled={savingEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Change date, time, reason, purpose, language, and notes for this call.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Call Event Log
              </CardTitle>
              <CardDescription>
                System timeline for this call
              </CardDescription>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No events recorded yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {logs.map((log) => (
                    <div key={log.id} className="rounded-lg border p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{log.message}</p>
                        <Badge
                          variant={
                            log.level === "error"
                              ? "destructive"
                              : log.level === "warn"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {log.level}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(log.createdAt), "MMM d, yyyy h:mm:ss a")} · {log.event}
                      </p>
                      {log.details && (
                        <pre className="mt-2 max-w-full overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
                          {formatLogDetails(log.details)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {call.evaluation && (
            <>
              {actionItems.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ListTodo className="h-5 w-5" />
                      Transcript Items
                    </CardTitle>
                    <CardDescription>
                      Captured from ElevenLabs data collection fields
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {actionItems.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border p-3"
                        >
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {call.evaluation.result === "success" ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : call.evaluation.result === "failure" ? (
                      <XCircle className="h-5 w-5 text-destructive" />
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground" />
                    )}
                    Evaluation: {call.evaluation.result}
                  </CardTitle>
                  {call.evaluation.duration > 0 && (
                    <CardDescription>
                      Duration: {Math.floor(call.evaluation.duration / 60)}m{" "}
                      {call.evaluation.duration % 60}s
                    </CardDescription>
                  )}
                </CardHeader>
                {call.evaluation.rationale && (
                  <CardContent>
                    <p className="text-sm">{call.evaluation.rationale}</p>
                  </CardContent>
                )}
              </Card>

              {transcriptLines.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5" />
                      Transcript
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {transcriptLines.map((line, i) => {
                        const isAgent = line.startsWith("agent:");
                        const message = line
                          .replace(/^(agent|user):/, "")
                          .trim();

                        return (
                          <div
                            key={i}
                            className={`flex ${isAgent ? "justify-start" : "justify-end"}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                                isAgent
                                  ? "bg-muted"
                                  : "bg-primary text-primary-foreground"
                              }`}
                            >
                              <p className="mb-0.5 text-xs font-medium opacity-70">
                                {isAgent ? "Agent" : "Customer"}
                              </p>
                              {message}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Name: </span>
                {call.customer.name}
              </div>
              <div>
                <span className="text-muted-foreground">Phone: </span>
                {call.customer.phone}
              </div>
              {call.customer.email && (
                <div>
                  <span className="text-muted-foreground">Email: </span>
                  {call.customer.email}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Technical Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Call ID: </span>
                <span className="font-mono text-xs">{call.id}</span>
              </div>
              {call.conversationId && (
                <div>
                  <span className="text-muted-foreground">
                    Conversation:{" "}
                  </span>
                  <span className="font-mono text-xs">
                    {call.conversationId}
                  </span>
                </div>
              )}
              {call.agentId && (
                <div>
                  <span className="text-muted-foreground">Agent: </span>
                  <span className="font-mono text-xs">{call.agentId}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
