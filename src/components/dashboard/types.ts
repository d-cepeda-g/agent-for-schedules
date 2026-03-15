export type Call = {
  id: string;
  scheduledAt: string;
  status: string;
  notes: string;
  callReason: string;
  callPurpose: string;
  preferredLanguage: string;
  customer: { id: string; name: string; phone: string };
  evaluation: { id: string; result: string } | null;
};

export type Evaluation = {
  id: string;
  result: string;
  rationale: string;
  createdAt: string;
  scheduledCall: {
    id: string;
    customer: { name: string };
  };
};

export type ProactiveAction = {
  id: string;
  title: string;
  description: string;
  customer_id: string | null;
  call_reason: string;
  call_purpose: string;
  notes: string;
  preferred_language: string;
  scheduled_date: string;
  scheduled_time: string;
  target_name: string | null;
  target_phone: string | null;
};

export type RestaurantSuggestion = {
  id: string;
  name: string;
  cuisine: string;
  area: string;
  address: string;
  phone: string;
  reservation_hint: string;
  call_action: ProactiveAction;
};

export type OnsiteLocationSuggestion = {
  id: string;
  name: string;
  area: string;
  address: string;
  phone: string;
  capacity_hint: string;
  call_action: ProactiveAction;
};

export type DashboardInsights = {
  summary: string;
  important_things: string[];
  proactive_actions: ProactiveAction[];
  valentines: {
    prompt: string;
    restaurants: RestaurantSuggestion[];
  };
  source: "openai" | "fallback";
  source_reason: string | null;
};

export type ScheduledCallResponse = {
  id: string;
};

export type CustomerLookup = {
  id: string;
  name: string;
  phone: string;
};

export const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  dispatching: "default",
  dispatched: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "destructive",
};
