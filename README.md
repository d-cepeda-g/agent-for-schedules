# Agent For Schedules

A Next.js + Prisma app to:

- Manage customers
- Schedule outbound AI calls
- Dispatch calls through ElevenLabs
- Store transcript + evaluation results
- Automatically capture transcript-derived items into the system

## 1. Local Setup

```bash
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`.

## 2. Environment Variables

Set these in `.env`:

```bash
DATABASE_URL=postgresql://...

ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...
ELEVENLABS_PHONE_NUMBER_ID=...
ELEVENLABS_WEBHOOK_SECRET=...
TOOL_API_KEY=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

`ELEVENLABS_WEBHOOK_SECRET` is required for validating incoming webhook signatures.
`TOOL_API_KEY` is required for Agentic Function tool endpoint authentication.
`OPENAI_API_KEY` (or `OPENAI_KEY`) enables proactive AI summaries and action suggestions on the main dashboard.

## 3. Agentic Function Tool Endpoints (MVP)

All tool routes require one of these headers:

- `x-tool-api-key: <TOOL_API_KEY>`
- `Authorization: Bearer <TOOL_API_KEY>`

Available endpoints:

1. `POST /api/tools/provider-lookup`
   - Input: `service_type`, `location`, `min_rating`, `max_results`, optional `origin`, optional `travel_mode`
2. `POST /api/tools/calendar-check`
   - Input: `proposed_start`, optional `duration_minutes`, optional `busy_windows`, optional `customer_id`
3. `POST /api/tools/distance-score`
   - Input: `origin`, `provider_ids` or `providers`, optional `travel_mode`, optional `distance_weight`
4. `POST /api/tools/slot-confirm`
   - Input: `provider_id` (or `provider_name` + `provider_phone`), `slot_start`, optional `duration_minutes`, optional `busy_windows`

Example:

```bash
curl -X POST http://localhost:3000/api/tools/provider-lookup \
  -H "Content-Type: application/json" \
  -H "x-tool-api-key: $TOOL_API_KEY" \
  -d '{
    "service_type": "dentist",
    "location": "San Francisco",
    "max_results": 3
  }'
```

## 4. ElevenLabs Configuration (Required for Auto Transcript Items)

1. Create/configure your ElevenLabs conversational agent.
2. In that agent, configure **Data Collection** fields for the items you want saved (examples below).
3. Configure webhook delivery in ElevenLabs to point to:
   - `https://<your-domain>/api/elevenlabs/webhook`
4. Enable post-call events (`post_call_transcription` and/or `post_call_analysis`).
5. Copy the webhook secret from ElevenLabs into `ELEVENLABS_WEBHOOK_SECRET`.

Suggested Data Collection fields:

- `follow_up_task`
- `follow_up_date`
- `customer_priority`
- `next_step_owner`

Each non-empty collected value is stored as a `CallActionItem` for that call.

## 5. Scheduled Context For Agent

When creating a scheduled call, the app stores:

- `callReason`
- `callPurpose`
- `preferredLanguage`
- `notes`

If `preferredLanguage` is omitted while creating a call, the app now defaults to the selected customer's `preferredLanguage`.

On dispatch, these are sent to ElevenLabs as dynamic variables:

- `customer_name`
- `call_reason`
- `call_purpose`
- `preferred_language`
- `additional_context`
- `call_context`

To make the agent use them, reference these variables in your ElevenLabs prompt.

## 6. How Transcript Items Flow Through This App

1. App dispatches call via ElevenLabs.
2. ElevenLabs sends webhook to `/api/elevenlabs/webhook`.
3. App verifies webhook signature.
4. App fetches conversation details from ElevenLabs.
5. App updates:
   - `CallEvaluation` (result, rationale, transcript, duration)
   - `ScheduledCall` status (`completed`/`failed`/`dispatched`)
   - `CallActionItem` records from `analysis.data_collection_results`
6. In the call detail page (`/calls/:id`), items appear in **Transcript Items**.

## 7. Security Notes

- In production this app uses basic auth middleware, but `/api/elevenlabs/webhook` is intentionally excluded so ElevenLabs can post events.
- `/api/tools/*` endpoints are excluded from basic auth and protected with `TOOL_API_KEY`.
- Webhook authenticity is checked with `ELEVENLABS_WEBHOOK_SECRET`.
- Keep `.env` out of version control and rotate any exposed API keys.

## 8. Manual Fallback

If a webhook is delayed or missed, you can still fetch results manually from the UI using **Fetch Evaluation** on a call. The same sync logic is used in both paths.

## 9. Dashboard AI Copilot

The dashboard now calls `GET /api/ai/dashboard-insights` to render:

- AI summary across calls/evaluations/action items
- Important items needing follow-up
- Proactive action buttons that create scheduled calls with prefilled reason/purpose/notes
- A Valentine section with 3 restaurant options and one-click reservation call scheduling

When no OpenAI key is configured or the model fails, the endpoint returns deterministic fallback insights.
