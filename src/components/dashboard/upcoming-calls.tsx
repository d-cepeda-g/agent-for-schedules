"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import type { Call } from "./types";
import { STATUS_VARIANT } from "./types";

export function UpcomingCalls({ calls }: { calls: Call[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Upcoming Calls</CardTitle>
        <Link href="/schedule">
          <Button variant="ghost" size="sm">
            View all
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No upcoming calls.{" "}
            <Link href="/schedule" className="underline">
              Schedule one
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            {calls.map((call) => (
              <div
                key={call.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{call.customer.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(call.scheduledAt), "MMM d, h:mm a")} ·{" "}
                    {call.customer.phone}
                  </p>
                  {(call.callReason || call.callPurpose || call.notes) && (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {call.callReason || call.callPurpose || call.notes}
                    </p>
                  )}
                </div>
                <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={STATUS_VARIANT[call.status] || "outline"}>
                    {call.status}
                  </Badge>
                  {call.preferredLanguage ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {call.preferredLanguage}
                    </Badge>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
