# Lumi — AI Agent for Schedules

AI-powered outbound phone call scheduling via ElevenLabs and OpenAI.

## Quick Start

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev          # http://localhost:3000
```

Production: `bash scripts/start-production.sh` (runs migrations, starts on port 5000).

## Stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript (strict)
- **Database**: PostgreSQL via Prisma ORM
- **Styling**: Tailwind CSS 4, shadcn/ui components
- **External APIs**: ElevenLabs (voice calls), OpenAI (AI features)
- **Auth**: Basic Auth (UI), TOOL_API_KEY (tool endpoints), HMAC-SHA256 (webhooks)

## Project Structure

```
src/
├── app/                    # Next.js pages and API routes
│   ├── page.tsx            # Dashboard (uses components/dashboard/*)
│   ├── api/
│   │   ├── calls/          # Call CRUD, dispatch, swarm
│   │   ├── customers/      # Customer CRUD
│   │   ├── ai/             # Chat assistant, dashboard insights
│   │   ├── tools/          # Agentic function tools (provider-lookup, calendar-check, etc.)
│   │   ├── elevenlabs/     # Webhook handler
│   │   ├── evaluations/    # Call evaluations
│   │   └── health/         # Health check
│   ├── calls/              # Call detail pages
│   ├── customers/          # Customer pages
│   ├── schedule/           # Call scheduling form
│   └── calendar/           # Calendar view
├── components/
│   ├── ui/                 # shadcn/ui primitives
│   ├── dashboard/          # Dashboard-specific components (stats, upcoming calls, etc.)
│   ├── sidebar.tsx         # Navigation sidebar
│   ├── lumi-chat-widget.tsx
│   └── dispatch-heartbeat.tsx
└── lib/
    ├── chat-assistant/     # Chat assistant logic (types, parsing, intent, suggestions, web-research)
    ├── db.ts               # Prisma client singleton
    ├── elevenlabs.ts       # ElevenLabs API client
    ├── elevenlabs-webhook.ts
    ├── openai.ts           # OpenAI API client
    ├── calls.ts            # Call dispatch orchestration
    ├── conversation-sync.ts
    ├── provider-directory.ts
    ├── tool-auth.ts        # TOOL_API_KEY validation (timing-safe)
    ├── tool-calendar.ts
    ├── async-concurrency.ts
    ├── call-logs.ts
    ├── validation.ts
    ├── prisma-errors.ts
    └── utils.ts
prisma/
├── schema.prisma           # 5 models: Customer, ScheduledCall, CallEvaluation, CallActionItem, CallLog
└── migrations/
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:studio` | Open Prisma Studio |

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `ELEVENLABS_API_KEY` | For calls | ElevenLabs auth |
| `ELEVENLABS_AGENT_ID` | For calls | Conversational agent ID |
| `ELEVENLABS_PHONE_NUMBER_ID` | For calls | Outbound phone number |
| `ELEVENLABS_WEBHOOK_SECRET` | For webhooks | HMAC verification |
| `OPENAI_API_KEY` | For AI | OpenAI auth |
| `TOOL_API_KEY` | For tools | Shared secret for /api/tools/* |
| `BASIC_AUTH_USERNAME` | Prod | Basic auth username |
| `BASIC_AUTH_PASSWORD` | Prod | Basic auth password |

## Conventions

- **UI style**: Clean, neutral, monochrome. No colorful gradients. Use `muted-foreground` for secondary text.
- **Components**: Break large pages into focused components under `src/components/<feature>/`.
- **API modules**: Break large route files into modules under `src/lib/<feature>/`.
- **Database**: Always add indexes for frequently queried fields. Use Prisma migrations.
- **Auth**: Use `timingSafeEqual` for all secret comparisons. Never bypass auth when credentials are missing.
- **Error handling**: Use `createCallLogSafe` for non-blocking logging. Catch errors at API boundaries.
- **TypeScript**: Strict mode. Prefer explicit types over `any`. Use `Record<string, unknown>` for untyped objects.
