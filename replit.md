# Call Scheduler

## Overview
A Next.js application for scheduling and managing automated phone calls. It features a dashboard for tracking calls, managing customers, and reviewing call evaluations. The app uses ElevenLabs integration for call dispatching.

## Recent Changes
- **2026-02-07**: Migrated database from SQLite to Replit's built-in PostgreSQL (via Prisma ORM, env var: `DATABASE_URL`).
- **2026-02-07**: Initial Replit setup — allowed dev origins for Replit proxy, set up deployment.

## Project Architecture
- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database**: PostgreSQL (Replit built-in) via Prisma ORM (env var: `DATABASE_URL`)
- **Styling**: Tailwind CSS 4 + shadcn/ui components
- **Language**: TypeScript

### Key Directories
- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — React components (sidebar, UI library)
- `src/lib/` — Utilities (db client, ElevenLabs integration, validation)
- `prisma/` — Database schema and migrations
- `public/` — Static assets

### API Routes
- `POST /api/calls` — Create a scheduled call
- `GET /api/calls` — List calls with filters
- `POST /api/calls/dispatch-due` — Dispatch pending calls (heartbeat)
- `GET/DELETE /api/calls/[id]` — Get or cancel a call
- `POST /api/calls/[id]/dispatch` — Manually dispatch a call
- `GET /api/calls/[id]/evaluation` — Get call evaluation
- `POST/GET /api/customers` — Manage customers
- `POST /api/elevenlabs/webhook` — ElevenLabs webhook handler

### Authentication
- Basic auth middleware (enabled in production or when `ENABLE_BASIC_AUTH=true`)
- Requires `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` env vars

### Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (managed by Replit)
- `ELEVENLABS_API_KEY` — ElevenLabs API key (optional, for call dispatching)
- `ELEVENLABS_AGENT_ID` — ElevenLabs agent ID (optional)
- `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` — Basic auth credentials (for production)
- `ENABLE_BASIC_AUTH` — Enable auth in development (`true`/`false`)

## User Preferences
- None recorded yet
