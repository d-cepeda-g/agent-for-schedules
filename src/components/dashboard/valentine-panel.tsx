"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { ProactiveAction, RestaurantSuggestion } from "./types";

export function ValentinePanel({
  restaurants,
  actionCreatingId,
  bulkScheduling,
  onScheduleAll,
  onScheduleOne,
  onDismissOne,
  onDismissPanel,
}: {
  restaurants: RestaurantSuggestion[];
  actionCreatingId: string | null;
  bulkScheduling: boolean;
  onScheduleAll: () => void;
  onScheduleOne: (action: ProactiveAction) => void;
  onDismissOne: (actionId: string) => void;
  onDismissPanel: () => void;
}) {
  if (restaurants.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="min-w-0 shrink">Valentine Suggestions</CardTitle>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onScheduleAll}
            disabled={bulkScheduling}
          >
            {bulkScheduling ? "Scheduling..." : "Schedule 3 Reservation Calls"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss Valentine suggestions"
            onClick={onDismissPanel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          {restaurants.map((restaurant) => (
            <div
              key={restaurant.id}
              className="min-w-0 rounded-lg border p-3"
            >
              <p className="truncate text-sm font-medium">{restaurant.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {restaurant.cuisine} · {restaurant.area}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{restaurant.address}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{restaurant.phone}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{restaurant.reservation_hint}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={actionCreatingId === restaurant.call_action.id}
                  onClick={() => onScheduleOne(restaurant.call_action)}
                >
                  {actionCreatingId === restaurant.call_action.id
                    ? "Creating..."
                    : "Schedule Reservation Call"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDismissOne(restaurant.call_action.id)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
