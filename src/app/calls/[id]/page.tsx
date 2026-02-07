"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
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

export default function CallDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [fetchingEval, setFetchingEval] = useState(false);

  const callId = params.id as string;

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
      const refreshed = await fetch(`/api/calls/${callId}`);
      const refreshedData = (await refreshed.json()) as CallDetail;
      setCall(refreshedData);
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
      const refreshed = await fetch(`/api/calls/${callId}`);
      const refreshedData = (await refreshed.json()) as CallDetail;
      setCall(refreshedData);
    } finally {
      setFetchingEval(false);
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
                        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                          {log.details}
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
