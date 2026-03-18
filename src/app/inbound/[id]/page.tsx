"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  PhoneIncoming,
  MessageSquare,
  ListTodo,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  CalendarPlus,
} from "lucide-react";

type InboundCallDetail = {
  id: string;
  conversationId: string;
  callerPhone: string;
  status: string;
  intent: string;
  summary: string;
  transcript: string;
  duration: number;
  sentiment: string;
  followUpNeeded: boolean;
  followUpNotes: string;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string; phone: string; email: string } | null;
  actionItems: Array<{
    id: string;
    title: string;
    detail: string;
    completed: boolean;
    createdAt: string;
  }>;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  missed: "destructive",
  failed: "destructive",
};

function formatDuration(seconds: number): string {
  if (seconds === 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function SentimentIcon({ sentiment }: { sentiment: string }) {
  if (sentiment === "positive") return <CheckCircle className="h-5 w-5 text-muted-foreground" />;
  if (sentiment === "negative") return <XCircle className="h-5 w-5 text-destructive" />;
  return <Clock className="h-5 w-5 text-muted-foreground" />;
}

export default function InboundCallDetailPage() {
  const params = useParams();
  const router = useRouter();
  const callId = params.id as string;

  const [call, setCall] = useState<InboundCallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [followUpNeeded, setFollowUpNeeded] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState("");

  useEffect(() => {
    let active = true;

    async function loadCall() {
      try {
        const response = await fetch(`/api/inbound-calls/${callId}`);
        const data = (await response.json().catch(() => null)) as
          | InboundCallDetail
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

        const callData = data as InboundCallDetail;
        setCall(callData);
        setFollowUpNeeded(callData.followUpNeeded);
        setFollowUpNotes(callData.followUpNotes);
        setLoading(false);
      } catch {
        if (!active) return;
        setCall(null);
        setErrorMessage("Failed to load call details");
        setLoading(false);
      }
    }

    void loadCall();
    return () => { active = false; };
  }, [callId]);

  async function handleSaveFollowUp() {
    setSaving(true);
    try {
      const response = await fetch(`/api/inbound-calls/${callId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpNeeded, followUpNotes }),
      });

      if (response.ok) {
        const updated = (await response.json()) as InboundCallDetail;
        setCall((prev) => prev ? { ...prev, ...updated } : prev);
      }
    } finally {
      setSaving(false);
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

  const transcriptLines = call.transcript?.split("\n").filter(Boolean) || [];
  const actionItems = call.actionItems || [];

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => router.push("/inbound")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Inbound Calls
      </Button>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          {/* Header card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <PhoneIncoming className="h-5 w-5" />
                  Inbound Call from {call.customer?.name || call.callerPhone}
                </CardTitle>
                <Badge variant={STATUS_VARIANT[call.status] || "outline"}>
                  {call.status}
                </Badge>
              </div>
              <CardDescription>
                Received {format(new Date(call.createdAt), "EEEE, MMMM d, yyyy 'at' h:mm a")}
                {call.duration > 0 && ` · Duration: ${formatDuration(call.duration)}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {call.intent && (
                <div>
                  <p className="text-sm font-medium">Caller Intent</p>
                  <p className="text-sm text-muted-foreground">{call.intent}</p>
                </div>
              )}
              {call.summary && (
                <div>
                  <p className="text-sm font-medium">Summary</p>
                  <p className="text-sm text-muted-foreground">{call.summary}</p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <SentimentIcon sentiment={call.sentiment} />
                <span className="text-sm capitalize">{call.sentiment} sentiment</span>
              </div>

              {call.followUpNeeded && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  <span>Follow-up needed</span>
                </div>
              )}

              {/* Schedule follow-up outbound call */}
              {call.customer && (
                <Link
                  href={`/schedule?customerId=${call.customer.id}&callReason=${encodeURIComponent(`Follow-up: ${call.intent || "inbound call"}`)}`}
                >
                  <Button variant="outline" size="sm">
                    <CalendarPlus className="mr-2 h-4 w-4" />
                    Schedule Follow-Up Call
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Follow-up management */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="h-4 w-4" />
                Follow-Up
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="follow-up-toggle"
                  checked={followUpNeeded}
                  onCheckedChange={setFollowUpNeeded}
                />
                <Label htmlFor="follow-up-toggle">Follow-up needed</Label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="follow-up-notes">Follow-up notes</Label>
                <Textarea
                  id="follow-up-notes"
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  placeholder="Notes about what to follow up on..."
                  rows={3}
                />
              </div>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => void handleSaveFollowUp()}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </CardContent>
          </Card>

          {/* Action items */}
          {actionItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListTodo className="h-5 w-5" />
                  Captured Data
                </CardTitle>
                <CardDescription>
                  Information extracted from the conversation
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {actionItems.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Transcript */}
          {transcriptLines.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Transcript
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {transcriptLines.map((line, i) => {
                    const isAgent = line.startsWith("agent:");
                    const message = line.replace(/^(agent|user):/, "").trim();

                    return (
                      <div
                        key={i}
                        className={`flex items-end gap-2 ${isAgent ? "justify-start" : "justify-end"}`}
                      >
                        {isAgent && (
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                            AI
                          </div>
                        )}
                        <div
                          className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                            isAgent
                              ? "rounded-bl-sm bg-muted"
                              : "rounded-br-sm bg-primary text-primary-foreground"
                          }`}
                        >
                          {message}
                        </div>
                        {!isAgent && (
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                            C
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Caller Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {call.customer ? (
                <>
                  <div>
                    <span className="text-muted-foreground">Name: </span>
                    <Link
                      href={`/customers/${call.customer.id}`}
                      className="text-primary hover:underline"
                    >
                      {call.customer.name}
                    </Link>
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
                </>
              ) : (
                <>
                  <div>
                    <span className="text-muted-foreground">Phone: </span>
                    {call.callerPhone}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Caller not matched to a known contact
                  </p>
                </>
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
              <div>
                <span className="text-muted-foreground">Conversation: </span>
                <span className="font-mono text-xs">{call.conversationId}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Duration: </span>
                {formatDuration(call.duration)}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
