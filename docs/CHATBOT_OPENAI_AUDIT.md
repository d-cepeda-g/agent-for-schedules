# Chatbot → OpenAI Audit

## Summary: Why You Get No Results

**Primary cause: `OPENAI_API_KEY` is not set in `.env`.**

Without it, the chat assistant never calls OpenAI. You only get the local fallback (static provider directory + your contacts). For venue-style requests (restaurant, bar, event space) the fallback does not search the web and the provider directory has no restaurants/bars, so you often get **zero suggestions**.

---

## Flow Overview

1. **Frontend** (`lumi-chat-widget.tsx`)  
   - Sends `POST /api/ai/chat-assistant` with `{ message, history }`.  
   - Expects `{ reply, suggestions, source?, sourceReason? }`.  
   - Renders `reply` and `suggestions` (contact cards).  
   - On non-OK response, shows error and a generic “could not complete research” message.

2. **API route** (`src/app/api/ai/chat-assistant/route.ts`)  
   - Reads `message` and `history`, builds `contextMessage`, detects `preferPlaces` (venue-like: restaurant, bar, venue, etc.).  
   - Loads customers from DB and builds a **fallback plan** from:  
     - Rule-based service type + location  
     - Your contacts (scored by message)  
     - **Only when `preferPlaces` is false:** static provider directory (dentist, auto, hair, physio, etc.).  
   - **If `hasOpenAiApiKey()` is false:**  
     - Returns the fallback plan immediately with `sourceReason: "OpenAI API key not configured"`.  
     - No OpenAI calls.  
   - **If API key is set:**  
     - Runs **online place research** (OpenAI `/v1/responses` with web search) when `preferPlaces` is true.  
     - When `preferPlaces` is false, runs **`buildOpenAiPlan`** (OpenAI `/v1/chat/completions` with JSON) and merges with fallback.  
   - **If `preferPlaces` is true:**  
     - Response is always “fallback plan + online research result” (no `buildOpenAiPlan` for that branch).  
     - So for “find me a restaurant/bar/venue”, the only way to get place suggestions is **online research**, which requires `OPENAI_API_KEY`.

3. **OpenAI lib** (`src/lib/openai.ts`)  
   - `hasOpenAiApiKey()`: true only if `OPENAI_API_KEY` or `OPENAI_KEY` or `OPENAI-KEY` is set in env.  
   - `createJsonCompletion`: calls `POST https://api.openai.com/v1/chat/completions` (used by `buildOpenAiPlan`).  
   - `createWebSearchTextCompletionWithMetadata`: calls `POST https://api.openai.com/v1/responses` (used by `researchPlacesOnline`).  
   - Model: `OPENAI_MODEL` or default `gpt-4.1-mini` (valid as of 2025).

---

## Where Things Go Wrong

| Issue | What happens |
|-------|----------------|
| **No `OPENAI_API_KEY` in `.env`** | `hasOpenAiApiKey()` is false. No chat/completions, no web search. Only fallback. For venue requests, fallback does not use provider directory and has no restaurants/bars → **no suggestions**. You still get a 200 response with a reply like “I could not identify callable venues from the current data” and `sourceReason: "OpenAI API key not configured"`. |
| **`.env.example` didn’t list OpenAI** | Easy to deploy or clone without setting the key; behavior looks like “no results” with no obvious config hint. |
| **Venue-style message without API key** | `preferPlaces === true` → fallback only; `shouldResearchProviders` is false so provider list isn’t used; provider directory has no restaurant/bar/venue entries anyway → **0 suggestions**. |
| **Non-venue message without API key** | Fallback uses provider directory (dentist, auto, hair, etc.) + contacts. You get suggestions only if the message matches those service types or existing contacts. |

So “not giving me any results” is expected when:

- `OPENAI_API_KEY` is missing, and  
- You’re asking for places (restaurant, bar, venue) or for something that doesn’t match the static directory or your contacts.

---

## Fixes Applied

1. **`.env.example`**  
   - Added `OPENAI_API_KEY` and `OPENAI_MODEL` so it’s obvious these must be set for the chatbot to use OpenAI and return real results.

---

## What You Need To Do

1. **Add your OpenAI API key to `.env`** (do not commit the real key):
   ```bash
   OPENAI_API_KEY=sk-...
   # optional:
   OPENAI_MODEL=gpt-4.1-mini
   ```
2. Restart the Next.js server so it picks up the new env.
3. Try again with a venue-style message (e.g. “find a restaurant in SF”); you should get web-researched place suggestions when the key is valid.

---

## Optional Checks If It Still Fails With a Key

- **4xx/5xx from OpenAI:** Check server logs and `sourceReason` in the JSON response; the route catches errors and returns fallback with a reason.
- **Wrong key / no usage:** OpenAI returns 401 or 403; the route will return fallback and `sourceReason` will mention the failure.
- **Model access:** `gpt-4.1-mini` may require a minimum usage tier; if the API returns “model not found” or similar, try `gpt-4o-mini` by setting `OPENAI_MODEL=gpt-4o-mini` in `.env`.
