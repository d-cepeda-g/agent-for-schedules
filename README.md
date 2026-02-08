# Lumi — AI Agent for Schedules

A Next.js + Prisma app that manages outbound AI phone calls through ElevenLabs. Lumi researches venues, schedules reservation calls, dispatches them via voice AI, and captures transcript results — all from a single dashboard.

## What it does

- **Dashboard** with AI Ops Copilot — proactive action suggestions, Valentine restaurant scheduling, company on-site venue search
- **AI Chat Assistant** — researches venues/businesses via OpenAI web search, finds phone numbers, and suggests calls
- **Call Scheduling** — create, dispatch, and track outbound calls through ElevenLabs voice AI
- **Calendar View** — visual monthly calendar with per-day call details and delete support
- **Swarm Mode** — launch up to 15 concurrent provider outreach calls with ranked results
- **Webhook Integration** — automatic transcript capture, evaluation, and action item extraction from ElevenLabs
- **Customer Management** — track contacts, call history, and preferred languages

## Setup

```bash
npm install
npx prisma generate
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Set these in `.env`:

```bash
DATABASE_URL=postgresql://...

# ElevenLabs (required for voice calls)
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...
ELEVENLABS_PHONE_NUMBER_ID=...
ELEVENLABS_WEBHOOK_SECRET=...

# OpenAI (required for AI features)
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini

# Tool authentication
TOOL_API_KEY=...

# Optional
CALLPILOT_DISPATCH_CONCURRENCY=15
ENABLE_BASIC_AUTH=true
BASIC_AUTH_USERNAME=...
BASIC_AUTH_PASSWORD=...
```

- `ELEVENLABS_WEBHOOK_SECRET` — validates incoming webhook signatures
- `TOOL_API_KEY` — authenticates agentic function tool endpoints
- `OPENAI_API_KEY` (or `OPENAI_KEY`) — enables AI chat assistant, dashboard insights, and venue research
- `CALLPILOT_DISPATCH_CONCURRENCY` — controls due-call dispatch parallelism (default 15, max 15)

## Agentic Function Tool Endpoints

All tool routes require `x-tool-api-key` or `Authorization: Bearer` header.

| Endpoint | Purpose |
|---|---|
| `POST /api/tools/provider-lookup` | Search providers by service type, location, rating |
| `POST /api/tools/calendar-check` | Check calendar availability for proposed time slots |
| `POST /api/tools/distance-score` | Score providers by distance from origin |
| `POST /api/tools/slot-confirm` | Confirm a time slot with a specific provider |

## Swarm Mode (Concurrent Calls)

Dispatch due calls in parallel:

```bash
POST /api/calls/dispatch-due?limit=15&concurrency=15
```

Launch a provider outreach campaign:

```bash
POST /api/calls/swarm
{
  "service_type": "dentist",
  "location": "San Francisco",
  "min_rating": 4.2,
  "max_providers": 15,
  "dispatch_now": true,
  "concurrency": 15
}
```

Get ranked campaign results: `GET /api/calls/swarm/:batchId`

## ElevenLabs Webhook Setup

1. Configure your ElevenLabs conversational agent
2. Set webhook URL to `https://<your-domain>/api/elevenlabs/webhook`
3. Enable `post_call_transcription` and `post_call_analysis` events
4. Copy the webhook secret into `ELEVENLABS_WEBHOOK_SECRET`
5. Configure Data Collection fields: `follow_up_task`, `follow_up_date`, `customer_priority`, `next_step_owner`

## Call Context

When dispatching, these dynamic variables are sent to ElevenLabs:

- `customer_name`, `call_reason`, `call_purpose`
- `preferred_language`, `additional_context`, `call_context`

Reference them in your ElevenLabs agent prompt.

## Security

- Basic auth middleware protects all routes in production
- `/api/elevenlabs/webhook` is excluded (ElevenLabs needs access)
- `/api/tools/*` endpoints use `TOOL_API_KEY` instead
- Webhook authenticity is verified via `ELEVENLABS_WEBHOOK_SECRET`
