# Lumi - Full Application Review & Audit

**Date:** 2026-03-14
**Reviewer:** Claude Code (Opus 4.6)
**Scope:** Full codebase review — architecture, security, code quality, reliability

---

## Executive Summary

Lumi is a well-structured Next.js + Prisma application for AI-powered outbound phone call scheduling via ElevenLabs. The codebase is TypeScript-strict, uses proper ORM patterns, and has solid separation of concerns. However, there are **security gaps**, **zero test coverage**, **missing rate limiting**, and several **reliability concerns** that should be addressed before production use with real data.

**Overall Grade: B-** — Good foundation, needs hardening.

---

## 1. Architecture Overview

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui | Client-side rendering for dashboard; SSR where applicable |
| API | Next.js Route Handlers (20 endpoints) | REST/JSON, no OpenAPI spec |
| Database | PostgreSQL via Prisma ORM | 5 models, 6 migrations, proper indexes |
| External APIs | ElevenLabs (voice calls), OpenAI (AI features) | No SDK wrappers, direct HTTP |
| Auth | Basic Auth (UI), API Key (tools), HMAC (webhooks) | Three separate auth mechanisms |
| Deployment | Replit | Single-instance, no horizontal scaling |

---

## 2. Security Findings

### CRITICAL

#### S1: Basic Auth credentials not compared with timing-safe equality
**File:** `middleware.ts:63`
```typescript
if (parsed.username !== expectedUser || parsed.password !== expectedPass)
```
Basic Auth password comparison uses `!==` (string comparison), which is vulnerable to timing attacks. The `tool-auth.ts` correctly uses `timingSafeEqual` — the middleware should do the same.

**Fix:** Use `crypto.timingSafeEqual` for both username and password comparison.

#### S2: Auth bypass when credentials are missing
**File:** `middleware.ts:52-55`
```typescript
if (!expectedUser || !expectedPass) {
  console.warn("...");
  return NextResponse.next(); // ← Bypasses auth entirely
}
```
If `BASIC_AUTH_USERNAME` or `BASIC_AUTH_PASSWORD` env vars are accidentally unset in production, **all routes become unauthenticated**. A warning log is easy to miss.

**Fix:** Return 503 (Service Unavailable) instead of bypassing auth when credentials are missing in production.

#### S3: No rate limiting on any endpoint
No rate limiting exists anywhere in the application. Critical exposure:
- `/api/calls/dispatch-due` — could spam outbound phone calls
- `/api/calls/swarm` — launches up to 15 concurrent calls per request
- `/api/ai/*` — could exhaust OpenAI API quota
- `/api/customers` POST — could flood customer database

**Fix:** Add rate limiting middleware (e.g., `next-rate-limit`, or custom token-bucket in middleware).

### HIGH

#### S4: Webhook action item data stored without sanitization
**File:** `src/lib/conversation-sync.ts`
Data from ElevenLabs webhooks (titles, details, transcripts) is stored directly in the database without sanitization. If ElevenLabs is compromised or sends malicious content, this data flows through to the UI.

**Fix:** Sanitize webhook data before storage; escape when rendering.

#### S5: Non-paginated GET `/api/calls` returns all records
**File:** `src/app/api/calls/route.ts:96-105`
When pagination parameters are not provided, the endpoint returns **all** calls with no limit. As data grows, this becomes a DoS vector and performance issue.

**Fix:** Enforce a default page size even when pagination is not explicitly requested.

#### S6: OpenAI API key checked under 3 different env var names
**File:** `src/lib/openai.ts`
The code checks `OPENAI_API_KEY`, `OPENAI_KEY`, and `OPENAI-KEY`. This is confusing and error-prone (note: `OPENAI-KEY` with a hyphen is an unusual env var name). Could lead to accidental key exposure if multiple are set.

**Fix:** Standardize on a single env var name (`OPENAI_API_KEY`).

### MEDIUM

#### S7: Call status transitions not validated
**File:** `src/app/api/calls/[id]/route.ts` (PATCH)
Any status can be set via PATCH with no state-machine validation. A caller could move a call from `completed` back to `pending`, potentially triggering re-dispatch.

**Fix:** Enforce valid state transitions (e.g., `pending → dispatching → dispatched → completed/failed`).

#### S8: No CSRF protection
The app uses cookie-based Basic Auth sessions but has no CSRF tokens. While Basic Auth mitigates some CSRF vectors, it's not a complete defense.

#### S9: No audit trail for deletions
Deleting calls via DELETE doesn't create a log entry. Deletions are irreversible with no record.

#### S10: `slot_confirm_tool.json` contains hardcoded example API key
**File:** `slot_confirm_tool.json`
Contains `"value": "1234567890"` as an example key. Ensure this is never a real key and document it as placeholder.

---

## 3. Code Quality Findings

### Architecture

| Finding | Severity | File(s) |
|---------|----------|---------|
| Q1: Dashboard page is 1062 lines — should be split into components | Medium | `src/app/page.tsx` |
| Q2: Chat assistant route is ~770 lines with complex logic | Medium | `src/app/api/ai/chat-assistant/route.ts` |
| Q3: Provider directory has 150+ hardcoded records | Low | `src/lib/provider-directory.ts` |
| Q4: Onsite venue data hardcoded in dashboard component | Low | `src/app/page.tsx:117-150` |
| Q5: No shared API client/fetcher — each component has raw `fetch()` calls | Low | Multiple components |

### Type Safety

| Finding | Severity | File(s) |
|---------|----------|---------|
| Q6: `Record<string, unknown>` used instead of specific interfaces | Low | API routes |
| Q7: `as` type assertions in several places without runtime validation | Low | Multiple files |
| Q8: `SwarmBody = Record<string, unknown>` — request body not typed | Medium | `src/app/api/calls/swarm/route.ts` |

### Error Handling

| Finding | Severity | File(s) |
|---------|----------|---------|
| Q9: Generic "Failed to..." error messages leak no diagnostic info | Low | All API routes |
| Q10: `getMissingConfigError` returns `boolean` but name suggests it returns an error | Low | `src/lib/calls.ts:32-34` |
| Q11: Swallowed errors in dashboard `fetch().catch(() => {})` calls | Medium | `src/app/page.tsx:361-365` |

---

## 4. Reliability Findings

### R1: No test coverage
**Severity:** Critical

Zero test files exist. No unit tests, integration tests, or E2E tests. For an application that makes real phone calls, this is high-risk. Key areas that need tests:
- Webhook signature verification
- Call dispatch state machine
- Input validation functions
- API endpoint behavior
- Concurrency control

### R2: Race condition in concurrent dispatch
**File:** `src/lib/calls.ts:104-111`
The `updateMany` claim pattern is good but has a gap: between reading the call (`findUnique`) and claiming it (`updateMany`), another request could modify the call. The `updateMany` WHERE clause handles this, but the initial `findUnique` data (phone number, customer info) could be stale.

### R3: No retry logic for ElevenLabs API calls
**File:** `src/lib/elevenlabs.ts`
If ElevenLabs returns a transient error (429, 503), the call immediately fails with no retry. For a call-dispatching system, at least one retry with backoff would improve reliability.

### R4: No health check for external dependencies
**File:** `src/app/api/health/route.ts`
The health endpoint likely doesn't verify database connectivity or external API availability. A proper health check should verify all critical dependencies.

### R5: Single-instance deployment on Replit
No horizontal scaling, no queue for call dispatch. If the server restarts during a swarm dispatch, in-flight calls may be left in `dispatching` state with no recovery mechanism.

---

## 5. Performance Findings

### P1: Dashboard fetches all calls on load
**File:** `src/app/page.tsx:337-339`
```typescript
fetch("/api/calls").then(r => r.json()).then((calls: Call[]) => { ... });
```
This fetches ALL calls without pagination to compute stats. As the call volume grows, this will slow down the dashboard significantly.

**Fix:** Add a dedicated `/api/stats` endpoint that runs `COUNT` queries.

### P2: No caching strategy
No caching on any API response. The dashboard makes 3 API calls on every page load (`/api/calls`, `/api/evaluations`, `/api/ai/dashboard-insights`). The AI insights call hits OpenAI every time.

**Fix:** Add `Cache-Control` headers or implement SWR/React Query for client-side caching.

### P3: Provider directory search is in-memory linear scan
**File:** `src/lib/provider-directory.ts`
With 150+ providers this is fine, but it won't scale. If the provider list grows significantly, consider indexing or moving to the database.

---

## 6. Positive Observations

These things are done well:

- **Timing-safe comparison** for API key validation (`tool-auth.ts`)
- **HMAC-SHA256 webhook verification** with replay protection (`elevenlabs-webhook.ts`)
- **Call deduplication** prevents double-scheduling within 60-second windows
- **Optimistic locking** via `updateMany` prevents double-dispatch
- **Safe logging** — `createCallLogSafe` never throws, preventing log failures from breaking call flow
- **Input validation** — phone numbers, dates, and statuses are properly validated
- **Database indexes** on frequently queried fields (status, scheduledAt, batchId, conversationId)
- **Concurrency control** for batch dispatch with configurable limits
- **TypeScript strict mode** enabled
- **Clean separation of concerns** — lib/, components/, api/ properly organized
- **Graceful degradation** — AI features fail gracefully when OpenAI is unavailable

---

## 7. Prioritized Recommendations

### Immediate (before any production use with real data)
1. Fix Basic Auth timing vulnerability (S1)
2. Fix auth bypass when credentials missing (S2)
3. Add rate limiting to call dispatch and AI endpoints (S3)
4. Add basic test coverage for critical paths (R1)

### Short-term (within next sprint)
5. Enforce call status state machine (S7)
6. Add paginated stats endpoint for dashboard (P1)
7. Sanitize webhook data before storage (S4)
8. Default-paginate the calls GET endpoint (S5)
9. Standardize OpenAI env var (S6)
10. Add retry logic for ElevenLabs API (R3)

### Medium-term
11. Split dashboard page into smaller components (Q1)
12. Add client-side caching (P2)
13. Add E2E tests for critical user flows
14. Add monitoring/alerting for failed calls
15. Implement stuck-call recovery for `dispatching` state (R5)
16. Add audit logging for deletions (S9)

---

## 8. File-by-File Summary

| File | LOC | Issues | Grade |
|------|-----|--------|-------|
| `middleware.ts` | 73 | S1, S2 | C |
| `src/lib/tool-auth.ts` | 39 | None | A |
| `src/lib/elevenlabs-webhook.ts` | 138 | None | A |
| `src/lib/validation.ts` | 77 | None | A |
| `src/lib/calls.ts` | 185 | Q10, R2 | B+ |
| `src/lib/call-logs.ts` | ~30 | None | A |
| `src/app/api/calls/route.ts` | 213 | S5 | B |
| `src/app/api/calls/swarm/route.ts` | 390 | Q8, S3 | B- |
| `src/app/page.tsx` | 1062 | Q1, P1, Q11 | C+ |
| `src/app/api/ai/chat-assistant/route.ts` | ~770 | Q2, S6 | B- |
| `prisma/schema.prisma` | ~80 | None | A |

---

*End of audit. Findings are based on static code review only — no dynamic testing was performed.*
