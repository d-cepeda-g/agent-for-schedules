"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
} from "lucide-react";

type Call = {
  id: string;
  scheduledAt: string;
  status: string;
  notes: string;
  conversationId: string;
  customer: { id: string; name: string; phone: string };
  evaluation: { id: string; result: string } | null;
};

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [statusFilter, setStatusFilter] = useState("completed");
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [deletingCallId, setDeletingCallId] = useState<string | null>(null);

  const refreshCalls = useCallback(async (filter: string) => {
    const params = filter !== "all" ? `?status=${filter}` : "";
    const response = await fetch(`/api/calls${params}`);
    if (!response.ok) {
      setCalls([]);
      return;
    }
    const data = (await response.json()) as Call[];
    setCalls(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    void refreshCalls(statusFilter)
      .catch(() => {
        setCalls([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [statusFilter, refreshCalls]);

  async function handleDispatch(callId: string) {
    setDispatching(callId);
    try {
      const res = await fetch(`/api/calls/${callId}/dispatch`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to dispatch call");
      } else {
        await refreshCalls(statusFilter);
      }
    } finally {
      setDispatching(null);
    }
  }

  async function handleFetchEvaluation(callId: string) {
    const res = await fetch(`/api/calls/${callId}/evaluation`);
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to fetch evaluation");
      return;
    }
    await refreshCalls(statusFilter);
  }

  async function handleDeleteCall(call: Call) {
    if (
      !confirm(
        `Delete this call for ${call.customer.name} permanently? This cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingCallId(call.id);
    try {
      const response = await fetch(`/api/calls/${call.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(payload?.error || "Failed to delete call");
        return;
      }

      await refreshCalls(statusFilter);
    } finally {
      setDeletingCallId(null);
    }
  }

  const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    dispatching: "default",
    dispatched: "default",
    completed: "secondary",
    failed: "destructive",
    cancelled: "destructive",
  };

  function EvalIcon({ result }: { result: string }) {
    if (result === "success")
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (result === "failure")
      return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Call History</h1>
          <p className="text-muted-foreground">
            View, dispatch, and evaluate calls
          </p>
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setLoading(true);
            setStatusFilter(value);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="dispatching">Dispatching</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">
              Loading...
            </p>
          ) : calls.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No calls found.{" "}
              <Link href="/schedule" className="text-primary underline">
                Schedule one
              </Link>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Evaluation</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell className="font-medium">
                      {call.customer.name}
                    </TableCell>
                    <TableCell>{call.customer.phone}</TableCell>
                    <TableCell>
                      {format(
                        new Date(call.scheduledAt),
                        "MMM d, yyyy h:mm a"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusColor[call.status] || "outline"}
                      >
                        {call.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {call.evaluation ? (
                        <EvalIcon result={call.evaluation.result} />
                      ) : call.conversationId ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleFetchEvaluation(call.id)}
                        >
                          Fetch
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {["pending", "failed"].includes(call.status) &&
                          new Date(call.scheduledAt).getTime() <= Date.now() && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={dispatching === call.id}
                            onClick={() => handleDispatch(call.id)}
                          >
                            <Play className="mr-1 h-3 w-3" />
                            {dispatching === call.id
                              ? "Calling..."
                              : call.status === "failed"
                                ? "Retry"
                                : "Call Now"}
                          </Button>
                        )}
                        <Link href={`/calls/${call.id}`}>
                          <Button variant="ghost" size="icon">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete call"
                          aria-label="Delete call"
                          disabled={deletingCallId === call.id}
                          onClick={() => void handleDeleteCall(call)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
