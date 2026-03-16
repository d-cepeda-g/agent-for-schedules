"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, PhoneIncoming, AlertCircle } from "lucide-react";

export type RecentInboundCall = {
  id: string;
  callerPhone: string;
  status: string;
  intent: string;
  sentiment: string;
  followUpNeeded: boolean;
  duration: number;
  createdAt: string;
  customer: { id: string; name: string } | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  missed: "destructive",
  failed: "destructive",
};

export function RecentInbound({ calls }: { calls: RecentInboundCall[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <PhoneIncoming className="h-4 w-4" />
          Recent Inbound
        </CardTitle>
        <Link href="/inbound">
          <Button variant="ghost" size="sm">
            View all
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No inbound calls yet. Calls appear when the AI receptionist handles incoming calls.
          </p>
        ) : (
          <div className="space-y-3">
            {calls.map((call) => (
              <Link
                key={call.id}
                href={`/inbound/${call.id}`}
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {call.customer?.name || call.callerPhone}
                    </p>
                    {call.followUpNeeded && (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    )}
                  </div>
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {call.intent || format(new Date(call.createdAt), "MMM d, h:mm a")}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[call.status] || "outline"} className="ml-2 shrink-0">
                  {call.status}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
