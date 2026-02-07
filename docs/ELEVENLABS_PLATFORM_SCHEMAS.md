# ElevenLabs Platform — Webhook & Tool Schemas (CallPilot)

Use these in the ElevenLabs Conversational AI / Agentic Functions UI.

---

## Webhook (Conversation events)

**URL:** `https://<YOUR_APP_DOMAIN>/api/elevenlabs/webhook`

**Method:** POST

**Headers:** ElevenLabs sends a signature; the app verifies it with `ELEVENLABS_WEBHOOK_SECRET`.

**Payload the app expects (incoming from ElevenLabs):**

```json
{
  "type": "post_call_transcription" | "post_call_analysis" | "conversation_completed" | "conversation_ended",
  "data": {
    "conversation_id": "<string>",
    "status": "<optional string>"
  }
}
```

**Configure in ElevenLabs UI:** Set the webhook URL to your deployed base + `/api/elevenlabs/webhook` and set the same secret in the app as `ELEVENLABS_WEBHOOK_SECRET`.

---

## 1. provider-lookup

**URL:** `https://<YOUR_APP_DOMAIN>/api/tools/provider-lookup`  
**Method:** POST  
**Header:** `x-tool-api-key: <TOOL_API_KEY>`

**Request body:**

| Field         | Type   | Required | Description                                      |
|---------------|--------|----------|--------------------------------------------------|
| service_type  | string | no       | e.g. "dentist", "mechanic"                       |
| location      | string | no       | Location query for search                        |
| min_rating    | number | no       | Minimum Google rating (default 0)                |
| max_results   | number | no       | Max providers to return (default 5)              |
| origin        | object | no       | `{ "lat": number, "lng": number }` for distance  |
| travel_mode   | string | no       | "driving" \| "walking" \| "transit" (default driving) |

**Response:** `{ "providers": [...], "count": number }` — each provider includes id, name, phone, address, city, rating, review_count, service_types, location; if origin given, distance_km and travel_minutes.

---

## 2. calendar-check

**URL:** `https://<YOUR_APP_DOMAIN>/api/tools/calendar-check`  
**Method:** POST  
**Header:** `x-tool-api-key: <TOOL_API_KEY>`

**Request body:**

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| proposed_start | string | yes      | ISO 8601 datetime (e.g. "2025-02-10T14:00:00.000Z") |
| duration_minutes | number | no    | Default 60 |
| busy_windows   | array  | no       | Array of `{ "start": "<ISO>", "end": "<ISO>", "label": "<string>" }` |
| customer_id    | string | no       | If set, existing scheduled calls for this customer are treated as busy |

**Response:** `{ "available": boolean, "proposed_start", "proposed_end", "duration_minutes", "conflicts": [...], "next_available_start": "<ISO> \| null" }`

---

## 3. distance-score

**URL:** `https://<YOUR_APP_DOMAIN>/api/tools/distance-score`  
**Method:** POST  
**Header:** `x-tool-api-key: <TOOL_API_KEY>`

**Request body:**

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| origin         | object | yes      | `{ "lat": number, "lng": number }` |
| provider_ids   | string[] | no     | List of provider IDs from provider-lookup |
| providers      | array  | no       | Or list of `{ "id": string, "lat": number, "lng": number }` |
| travel_mode    | string | no       | "driving" \| "walking" \| "transit" |
| distance_weight | number | no      | Weight for score (default 1); higher = distance matters more |

At least one of `provider_ids` or `providers` must identify valid providers.

**Response:** `{ "origin", "travel_mode", "scores": [ { "provider_id", "distance_km", "travel_minutes", "distance_score" }, ... ] }` — scores sorted by distance_score desc, then travel_minutes asc.

---

## 4. slot-confirm

**URL:** `https://<YOUR_APP_DOMAIN>/api/tools/slot-confirm`  
**Method:** POST  
**Header:** `x-tool-api-key: <TOOL_API_KEY>`

**Request body:**

| Field                 | Type    | Required | Description |
|-----------------------|---------|----------|-------------|
| slot_start            | string  | yes      | ISO 8601 datetime |
| duration_minutes      | number  | no       | Default 60 |
| provider_id           | string  | no*      | From provider directory (preferred) |
| provider_name         | string  | no*      | Required if no provider_id |
| provider_phone        | string  | no*      | Required if no provider_id |
| service_type          | string  | no       | e.g. "checkup" |
| notes                 | string  | no       | Free text |
| busy_windows          | array   | no       | Same as calendar-check |
| customer_id           | string  | no       | For conflict check with scheduled calls |
| require_calendar_check | boolean | no      | Default true; if false, skips conflict check |

\* Either (provider_id) or (provider_name + provider_phone) must be provided.

**Response (no conflict):** `{ "confirmed": true, "confirmation_id", "provider": { "id", "name", "phone", "address", "rating" }, "slot_start", "slot_end", "duration_minutes", "service_type", "notes", "summary" }`  
**Response (conflict):** `{ "confirmed": false, "reason", "conflicts", "next_available_start" }`

---

## Summary for platform UI

| Item            | Value |
|-----------------|--------|
| Webhook URL     | `https://<YOUR_DOMAIN>/api/elevenlabs/webhook` |
| Webhook secret  | Same as `ELEVENLABS_WEBHOOK_SECRET` in .env |
| Tool auth       | Header `x-tool-api-key` = `TOOL_API_KEY` from .env |
| Base URL tools  | `https://<YOUR_DOMAIN>/api/tools/<tool-name>` |

Tool names: `provider-lookup`, `calendar-check`, `distance-score`, `slot-confirm`.
