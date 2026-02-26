## Cursor Cloud specific instructions

### Overview

Lumi is a single Next.js 16 application (App Router, TypeScript, Prisma ORM, PostgreSQL, Tailwind CSS 4, shadcn/ui). Not a monorepo. See `README.md` for full setup and env var documentation.

### Prerequisites

- **PostgreSQL** must be running locally. The VM snapshot includes PostgreSQL 16 installed and configured.
- Start the cluster if not already running: `sudo pg_ctlcluster 16 main start`
- The dev database is `lumi_dev` with user `ubuntu` / password `devpass`.
- `DATABASE_URL` is set in `.env`.

### Common commands

| Task | Command |
|------|---------|
| Install deps | `npm install` (postinstall runs `prisma generate`) |
| Migrate DB | `npx prisma migrate dev` |
| Dev server | `npm run dev` (port 3000) |
| Lint | `npm run lint` |
| Build | `npx next build` |
| Prisma Studio | `npm run db:studio` |

### Gotchas

- **No test suite** exists in the project (no test scripts, no test framework).
- **Basic auth middleware** is disabled in development by default (`NODE_ENV !== "production"` and `ENABLE_BASIC_AUTH` is not set). No credentials needed for dev.
- **Call scheduling** via `POST /api/calls` requires `ELEVENLABS_AGENT_ID` in `.env`. A dummy value like `demo-agent-id` is sufficient for local CRUD — actual dispatching requires real ElevenLabs credentials.
- **AI features** (chat assistant, dashboard insights) require `OPENAI_API_KEY` in `.env`. These degrade gracefully without it.
- After changing `.env`, the Next.js dev server must be restarted to pick up new values.
