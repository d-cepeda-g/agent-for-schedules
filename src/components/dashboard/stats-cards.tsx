"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Phone, Clock, CheckCircle } from "lucide-react";

type Stats = {
  totalCalls: number;
  pending: number;
  completed: number;
};

export function StatsCards({ stats }: { stats: Stats }) {
  const items = [
    { label: "Total Calls", value: stats.totalCalls, icon: Phone },
    { label: "Pending", value: stats.pending, icon: Clock },
    { label: "Completed", value: stats.completed, icon: CheckCircle },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-muted p-3">
              <item.icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <p className="text-2xl font-semibold">{item.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
