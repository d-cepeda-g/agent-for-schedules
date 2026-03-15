"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle, XCircle, Clock } from "lucide-react";
import type { Evaluation } from "./types";

function EvalIcon({ result }: { result: string }) {
  if (result === "success") return <CheckCircle className="h-4 w-4 text-muted-foreground" />;
  if (result === "failure") return <XCircle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

export function RecentEvaluations({ evaluations }: { evaluations: Evaluation[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent Evaluations</CardTitle>
        <Link href="/calls">
          <Button variant="ghost" size="sm">
            View all
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {evaluations.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No evaluations yet. Evaluations appear after calls complete.
          </p>
        ) : (
          <div className="space-y-3">
            {evaluations.map((ev) => (
              <Link
                key={ev.id}
                href={`/calls/${ev.scheduledCall.id}`}
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted"
              >
                <div>
                  <p className="text-sm font-medium">{ev.scheduledCall.customer.name}</p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {ev.rationale || "No rationale"}
                  </p>
                </div>
                <EvalIcon result={ev.result} />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
