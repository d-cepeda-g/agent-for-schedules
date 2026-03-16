"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  ExternalLink,
  PhoneIncoming,
  AlertCircle,
  Trash2,
} from "lucide-react";

type InboundCall = {
  id: string;
  conversationId: string;
  callerPhone: string;
  status: string;
  intent: string;
  summary: string;
  duration: number;
  sentiment: string;
  followUpNeeded: boolean;
  createdAt: string;
  customer: { id: string; name: string; phone: string } | null;
  actionItems: { id: string; title: string; completed: boolean }[];
};

type PaginatedResponse = {
  items: InboundCall[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  missed: "destructive",
  failed: "destructive",
};

const SENTIMENT_LABEL: Record<string, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

function formatDuration(seconds: number): string {
  if (seconds === 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function InboundCallsPage() {
  const [calls, setCalls] = useState<InboundCall[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const refreshCalls = useCallback(
    async (filter: string, currentPage: number, currentPageSize: number) => {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      params.set("page", String(currentPage));
      params.set("pageSize", String(currentPageSize));

      const response = await fetch(`/api/inbound-calls?${params.toString()}`);
      if (!response.ok) {
        setCalls([]);
        setTotal(0);
        setTotalPages(1);
        return;
      }

      const payload = (await response.json()) as PaginatedResponse;
      setCalls(payload.items);
      setTotal(payload.total);
      setTotalPages(payload.totalPages);
      if (payload.page > payload.totalPages) {
        setPage(payload.totalPages);
      }
    },
    []
  );

  useEffect(() => {
    setLoading(true);
    void refreshCalls(statusFilter, page, pageSize)
      .catch(() => {
        setCalls([]);
        setTotal(0);
        setTotalPages(1);
      })
      .finally(() => setLoading(false));
  }, [statusFilter, page, pageSize, refreshCalls]);

  async function handleDelete(call: InboundCall) {
    const label = call.customer?.name || call.callerPhone;
    if (!confirm(`Delete inbound call from ${label}? This cannot be undone.`)) return;

    setDeletingId(call.id);
    try {
      const response = await fetch(`/api/inbound-calls/${call.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setPageError(payload?.error || "Failed to delete call");
        return;
      }
      await refreshCalls(statusFilter, page, pageSize);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PhoneIncoming className="h-6 w-6" />
            Inbound Calls
          </h1>
          <p className="text-muted-foreground">
            Incoming calls handled by the AI receptionist
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setLoading(true);
              setPage(1);
              setStatusFilter(value);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="missed">Missed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setLoading(true);
              setPage(1);
              setPageSize(Number.parseInt(value, 10));
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 / page</SelectItem>
              <SelectItem value="25">25 / page</SelectItem>
              <SelectItem value="50">50 / page</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {pageError && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <span>{pageError}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs text-destructive hover:text-destructive"
            onClick={() => setPageError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">Loading...</p>
          ) : calls.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No inbound calls recorded yet. Calls will appear here when the AI receptionist handles incoming calls.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sentiment</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell className="font-medium">
                      {call.customer ? (
                        <Link
                          href={`/customers/${call.customer.id}`}
                          className="text-primary hover:underline"
                        >
                          {call.customer.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unknown caller</span>
                      )}
                      {call.followUpNeeded && (
                        <AlertCircle className="ml-1 inline h-3.5 w-3.5 text-amber-500" />
                      )}
                    </TableCell>
                    <TableCell>{call.callerPhone}</TableCell>
                    <TableCell>
                      <span className="line-clamp-1 max-w-[200px]">
                        {call.intent || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {format(new Date(call.createdAt), "MMM d, yyyy h:mm a")}
                    </TableCell>
                    <TableCell>{formatDuration(call.duration)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[call.status] || "outline"}>
                        {call.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          call.sentiment === "positive"
                            ? "text-green-600"
                            : call.sentiment === "negative"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }
                      >
                        {SENTIMENT_LABEL[call.sentiment] || call.sentiment}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Link href={`/inbound/${call.id}`}>
                          <Button variant="ghost" size="icon">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete call"
                          disabled={deletingId === call.id}
                          onClick={() => void handleDelete(call)}
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
          {!loading && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
              <p>
                {total === 0
                  ? "Showing 0 of 0"
                  : `Showing ${(page - 1) * pageSize + 1}-${(page - 1) * pageSize + calls.length} of ${total}`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((v) => Math.max(1, v - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
