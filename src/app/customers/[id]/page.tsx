"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink, History, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type CustomerHistory = {
  id: string;
  name: string;
  phone: string;
  email: string;
  calls: Array<{
    id: string;
    status: string;
    scheduledAt: string;
    notes: string;
    callReason: string;
    callPurpose: string;
    preferredLanguage: string;
    conversationId: string;
    evaluation: {
      result: string;
      transcript: string;
      duration: number;
      rationale: string;
      createdAt: string;
    } | null;
    actionItems: Array<{
      id: string;
      title: string;
      detail: string;
    }>;
    logs: Array<{
      id: string;
      event: string;
      level: string;
      message: string;
      createdAt: string;
    }>;
  }>;
};

function isCustomerHistory(payload: unknown): payload is CustomerHistory {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.phone === "string" &&
    Array.isArray(candidate.calls)
  );
}

function getTranscriptPreview(transcript: string): string {
  const cleaned = transcript.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 220) return cleaned;
  return `${cleaned.slice(0, 220)}...`;
}

export default function CustomerHistoryPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;
  const [customer, setCustomer] = useState<CustomerHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadHistory() {
      try {
        const res = await fetch(`/api/customers/${customerId}/history`);
        const payload = (await res.json().catch(() => null)) as
          | CustomerHistory
          | { error?: string }
          | null;

        if (!active) return;
        if (!res.ok || !payload || "error" in payload || !isCustomerHistory(payload)) {
          setError((payload && "error" in payload ? payload.error : null) || "Failed to load");
          setCustomer(null);
          setLoading(false);
          return;
        }

        setCustomer(payload);
        setError(null);
        setLoading(false);
      } catch {
        if (!active) return;
        setError("Failed to load");
        setCustomer(null);
        setLoading(false);
      }
    }

    void loadHistory();
    return () => {
      active = false;
    };
  }, [customerId]);

  if (loading) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Loading customer history...
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push("/customers")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Customers
        </Button>
        <p className="text-muted-foreground">{error || "Customer not found"}</p>
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

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => router.push("/customers")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Customers
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{customer.name}</CardTitle>
          <CardDescription>
            {customer.phone}
            {customer.email ? ` · ${customer.email}` : ""}
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        {customer.calls.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              No calls yet for this customer.
            </CardContent>
          </Card>
        ) : (
          customer.calls.map((call) => (
            <Card key={call.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-4 w-4" />
                    {format(new Date(call.scheduledAt), "MMM d, yyyy h:mm a")}
                  </CardTitle>
                  <Badge variant={statusColor[call.status] || "outline"}>
                    {call.status}
                  </Badge>
                </div>
                <CardDescription>
                  {call.logs.length} events
                  {call.conversationId ? ` · ${call.conversationId}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {call.evaluation?.transcript ? (
                  <div className="rounded border p-3">
                    <p className="mb-1 flex items-center gap-2 text-sm font-medium">
                      <MessageSquare className="h-4 w-4" />
                      Discussion summary
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {getTranscriptPreview(call.evaluation.transcript)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Transcript not available yet.
                  </p>
                )}

                {(call.callReason || call.callPurpose || call.preferredLanguage) && (
                  <div className="rounded border p-3 text-sm text-muted-foreground">
                    {call.callReason && <p>Reason: {call.callReason}</p>}
                    {call.callPurpose && <p>Purpose: {call.callPurpose}</p>}
                    {call.preferredLanguage && (
                      <p>Language: {call.preferredLanguage}</p>
                    )}
                  </div>
                )}

                {call.actionItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Action Items</p>
                    {call.actionItems.map((item) => (
                      <div key={item.id} className="rounded border p-2 text-sm">
                        <span className="font-medium">{item.title}: </span>
                        <span className="text-muted-foreground">{item.detail}</span>
                      </div>
                    ))}
                  </div>
                )}

                <Link href={`/calls/${call.id}`}>
                  <Button variant="outline" size="sm">
                    Open full call log
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
