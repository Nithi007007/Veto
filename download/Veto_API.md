# Veto — API Reference

This document is the complete reference for Veto's HTTP API. The backend is a
Hono server exposing 13 routes under `/api/*`. All routes accept and return
JSON. The frontend talks to this API via typed fetch wrappers; curl examples
below let you exercise every endpoint from the command line.

> **Conventions**
> - All `POST`/`PATCH` bodies are JSON with `Content-Type: application/json`.
> - All responses are JSON. Errors return `{ "error": string }` (or
>   `{ "error": string, "details": object }` for zod-validation failures).
> - Timestamps are ISO 8601 UTC strings.
> - All Sui amounts are in whole SUI (not MIST) at the API boundary. MIST
>   conversion happens inside `vault.ts` and `sui.ts`.
> - Digests are Sui transaction digest strings (e.g. `5Zg...XYZ`).

---

## Table of Contents

1. [Base URL & Configuration](#1-base-url--configuration)
2. [Authentication](#2-authentication)
3. [Endpoints](#3-endpoints)
   - 3.1 [`POST /api/agent/message`](#31-post-apiagentmessage)
   - 3.2 [`POST /api/agent/confirm`](#32-post-apiagentconfirm)
   - 3.3 [`GET /api/requests`](#33-get-apirequests)
   - 3.4 [`GET /api/rules`](#34-get-apirules)
   - 3.5 [`POST /api/rules`](#35-post-apirules)
   - 3.6 [`PATCH /api/rules/:id`](#36-patch-apirulesid)
   - 3.7 [`DELETE /api/rules/:id`](#37-delete-apirulesid)
   - 3.8 [`GET /api/wallet`](#38-get-apiwallet)
   - 3.9 [`GET /api/aliases`](#39-get-apialiases)
   - 3.10 [`POST /api/seed`](#310-post-apiseed)
   - 3.11 [`POST /api/owner/login`](#311-post-apiownerlogin)
   - 3.12 [`POST /api/owner/logout`](#312-post-apiownerlogout)
   - 3.13 [`GET /api/owner/status`](#313-get-apiownerstatus)
4. [Error Responses](#4-error-responses)
5. [The Two-Step Confirmation Flow](#5-the-two-step-confirmation-flow)
6. [Rate Limiting](#6-rate-limiting)
7. [WebSocket Events (Future)](#7-websocket-events-future)

---

## 1. Base URL & Configuration

| Environment        | Base URL                                | Set via                                  |
|--------------------|-----------------------------------------|------------------------------------------|
| Local dev          | `http://localhost:3001`                 | `PORT=3001` in `backend/.env`            |
| Production backend | `https://veto-api.onrender.com`         | Render auto-assigns; same `PORT` env var |
| Frontend→Backend   | (whichever above)                       | `NEXT_PUBLIC_API_URL` on Vercel          |

The frontend reads `NEXT_PUBLIC_API_URL` at build time and prepends it to
every fetch. The backend listens on `PORT` (Render injects this
automatically; for local dev set it to `3001` to avoid clashing with the
Next.js dev server on `3000`).

All examples below assume `export API="https://veto-api.onrender.com"` (or
`export API="http://localhost:3001"` for local dev).

---

## 2. Authentication

Veto uses **two-factor auth at the application layer**:

1. **Owner-session cookie** (`veto_owner_session`) — preferred for browser
   sessions. Set by `POST /api/owner/login` after a successful password
   check. Format: `<expiresAtMs>.<hmac>` where the HMAC is SHA-256 of the
   expiry using `OWNER_COOKIE_SECRET`. HttpOnly, SameSite=None, Secure, 8-hour
   TTL. Verified with constant-time comparison.

2. **`x-owner-token` header** — alternative for API clients (curl, CI). The
   header value must match the `OWNER_TOKEN` env var verbatim. Useful when
   the client can't manage cookies (e.g. GitHub Actions smoke tests).

Both methods are accepted by the `requireOwner()` middleware on
`/api/rules*` routes. If neither is present (or both are invalid), the
middleware returns `401 Unauthorized`.

The owner password is compared against `OWNER_PASSWORD` using
constant-time byte comparison (no early-exit on first mismatch).

| Route prefix          | Auth required | Method |
|-----------------------|---------------|--------|
| `/api/agent/*`        | No (rate-limited) | Anonymous — anyone can submit agent messages |
| `/api/requests`       | No             | Read-only audit log |
| `/api/rules` GET      | No             | Read-only rule book (vault state + tamper flag included) |
| `/api/rules` POST     | **Yes**        | Cookie OR `x-owner-token` |
| `/api/rules/:id` PATCH/DELETE | **Yes** | Cookie OR `x-owner-token` |
| `/api/wallet`         | No             | Read-only wallet display |
| `/api/aliases`        | No             | Static alias list |
| `/api/seed`           | No             | Idempotent — safe to call repeatedly |
| `/api/owner/login`    | No             | Establishes session |
| `/api/owner/logout`   | No             | Clears session |
| `/api/owner/status`   | No             | Returns auth state (used for health checks) |

---

## 3. Endpoints

### 3.1 `POST /api/agent/message`

The first step of the two-step confirmation flow. Parses a natural-language
message into a structured intent (or fails), then stages the request as
`AWAITING_CONFIRMATION`. Does **not** execute any chain action.

**Auth:** None (rate-limited at 10 req/min per IP).

**Request body schema (zod):**

```ts
{ message: string }   // 1 ≤ length ≤ 500
```

**Example:**

```bash
curl -s -X POST "$API/api/agent/message" \
  -H "Content-Type: application/json" \
  -d '{"message":"send 5 SUI to alice"}' | jq
```

**Response (200, parsed successfully — staged for confirmation):**

```json
{
  "id": "cm2abc123def456",
  "parsedIntent": {
    "action": "transfer",
    "amountSui": 5,
    "recipient": "0x0000000000000000000000000000000000000000000000000000000000000bad",
    "recipientAlias": "alice",
    "rawRecipient": "alice"
  },
  "rawMessage": "send 5 SUI to alice",
  "status": "AWAITING_CONFIRMATION",
  "diff": {
    "amountMentioned": 5,
    "amountParsed": 5,
    "recipientMentioned": "alice",
    "recipientResolved": "0x0000...0bad",
    "recipientWasAlias": true
  }
}
```

**Response (200, parse failed):**

```json
{
  "id": "cm2abc123def456",
  "parsedIntent": null,
  "status": "FAILED",
  "failReason": "amount not specified"
}
```

The `diff` object is what the UI uses to render the confirmation dialog — it
highlights when the LLM parsed a different amount or recipient than what the
user typed. If `amountMentioned !== amountParsed`, the UI shows a red
warning.

---

### 3.2 `POST /api/agent/confirm`

The second step of the two-step confirmation flow. Takes the `id` from
`/api/agent/message` and either confirms or rejects the staged intent. On
confirm, runs the full policy pipeline (idempotency → vault pre-flight →
policy engine → SUI execution).

**Auth:** None (rate-limited).

**Request body schema (zod):**

```ts
{
  id: string,                              // 1+ chars
  decision: "confirm" | "reject"
}
```

**Example (confirm):**

```bash
curl -s -X POST "$API/api/agent/confirm" \
  -H "Content-Type: application/json" \
  -d '{"id":"cm2abc123def456","decision":"confirm"}' | jq
```

**Response (200, confirmed and executed):**

```json
{
  "id": "cm2abc123def456",
  "status": "EXECUTED",
  "txDigest": "5ZgABcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
  "agentAddress": "0xe21fa541fc2da38ef0c26741f83673b5699d0a61e176b3c37405f669720e20cc",
  "idempotencyKey": "a3f5...c2d9"
}
```

**Response (200, blocked by on-chain vault):**

```json
{
  "id": "cm2abc123def456",
  "status": "BLOCKED",
  "failedRule": "on_chain_vault:EAmountExceedsPerTx",
  "failReason": "Amount 100.0000 SUI exceeds on-chain per-tx cap of 5.00 SUI"
}
```

**Response (200, blocked by off-chain policy engine):**

```json
{
  "id": "cm2abc123def456",
  "status": "BLOCKED",
  "failedRule": "Known-bad address blocklist",
  "failReason": "Recipient address is on the denylist"
}
```

**Response (200, blocked by T5 idempotency check):**

```json
{
  "id": "cm2abc999def456",
  "status": "BLOCKED",
  "failedRule": "idempotency_check",
  "failReason": "Blocked as a duplicate within the 60-second idempotency window (T5 replay protection)."
}
```

**Response (200, rejected by user):**

```json
{
  "id": "cm2abc123def456",
  "status": "BLOCKED",
  "failedRule": "user_rejected",
  "failReason": "User rejected the parsed intent during confirmation step"
}
```

**Response (200, execution failed on-chain — e.g. insufficient gas):**

```json
{
  "id": "cm2abc123def456",
  "status": "FAILED",
  "failReason": "Agent wallet has insufficient balance (0.0010 SUI, needed 5.0000 + gas)",
  "agentAddress": "0xe21fa541..."
}
```

The full list of possible `failedRule` values: `on_chain_vault:EAmountZero`,
`on_chain_vault:EAmountExceedsPerTx`, `on_chain_vault:EAmountExceedsDailyCap`,
`on_chain_vault:EInsufficientFunds`, `idempotency_check`,
`user_rejected`, `fail_closed_no_rules`, or the human-readable name of any
rule in the rule book (e.g. `"Per-transaction cap"`).

---

### 3.3 `GET /api/requests`

Returns the most recent agent requests, newest first. Used by the activity
feed on the dashboard (polled every 4 seconds).

**Auth:** None.

**Query parameters:**

| Name   | Type | Default | Max | Notes                              |
|--------|------|---------|-----|------------------------------------|
| `limit`| int  | 20      | 100 | Caps result count                  |

**Example:**

```bash
curl -s "$API/api/requests?limit=5" | jq
```

**Response (200):**

```json
{
  "requests": [
    {
      "id": "cm2abc123def456",
      "rawMessage": "send 5 SUI to alice",
      "parsedIntent": { "action":"transfer","amountSui":5,"recipient":"0x...0bad","recipientAlias":"alice","rawRecipient":"alice" },
      "amountSui": 5,
      "recipient": "0x0000...0bad",
      "status": "EXECUTED",
      "failedRule": null,
      "failReason": null,
      "txDigest": "5ZgABcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
      "confirmedAt": "2026-03-14T10:42:17.000Z",
      "createdAt": "2026-03-14T10:42:15.000Z"
    }
    // ... up to `limit` rows
  ]
}
```

---

### 3.4 `GET /api/rules`

Returns the full rule book plus the current vault state, the latest commit,
and the T4 tamper-detection result. The dashboard polls this every 15 seconds
to drive the tamper banner.

**Auth:** None.

**Example:**

```bash
curl -s "$API/api/rules" | jq
```

**Response (200):**

```json
{
  "rules": [
    {
      "id": "cm1aaa...",
      "name": "Per-transaction cap",
      "type": "MAX_AMOUNT_PER_TX",
      "config": { "maxAmountSui": 5 },
      "enabled": true,
      "createdAt": "2026-03-14T10:00:00.000Z",
      "updatedAt": "2026-03-14T10:00:00.000Z"
    }
    // ... 2 more (Daily spend cap, Known-bad address blocklist)
  ],
  "vault": {
    "config": {
      "perTxCapMist": "5000000000",
      "dailyCapMist": "20000000000"
    },
    "spentTodayMist": "5000000000",
    "windowStartMs": 1742143200000,
    "rulesCommitHash": "0x9f3a...c2d9",
    "rulesVersion": 1
  },
  "commit": {
    "id": "cm1bbb...",
    "commitHash": "0x9f3a...c2d9",
    "version": 1,
    "txDigest": null,
    "createdAt": "2026-03-14T10:00:00.000Z"
  },
  "tamper": {
    "tampered": false,
    "currentHash": "0x9f3a...c2d9",
    "committedHash": "0x9f3a...c2d9",
    "lastCommittedAt": "2026-03-14T10:00:00.000Z"
  }
}
```

Note that `perTxCapMist`, `dailyCapMist`, and `spentTodayMist` are returned
as **strings** (not numbers) because the underlying values are BigInt and
BigInt cannot be JSON-serialized. The frontend parses them with `BigInt(str)`.

---

### 3.5 `POST /api/rules`

Create a new rule. Owner-only. Triggers a new `RuleBookCommit` (which, when
the Move module is deployed, would call `vault::commit_rules(OwnerCap, …)`).

**Auth:** Required (cookie OR `x-owner-token` header).

**Request body schema (zod):**

```ts
{
  name: string,                 // 1–80 chars
  type: "MAX_AMOUNT_PER_TX" | "DAILY_SPEND_CAP" | "ALLOWED_RECIPIENT" | "DENYLIST_ADDRESS",
  config: Record<string, unknown>
}
```

**Config shape per type:**

| Type                  | Config                                                    |
|-----------------------|-----------------------------------------------------------|
| `MAX_AMOUNT_PER_TX`   | `{ "maxAmountSui": number }`                              |
| `DAILY_SPEND_CAP`     | `{ "capSui": number }`                                    |
| `ALLOWED_RECIPIENT`   | `{ "addresses": string[] }` (0x-prefixed Sui addresses)   |
| `DENYLIST_ADDRESS`    | `{ "addresses": string[] }` (0x-prefixed Sui addresses)   |

**Example:**

```bash
# Using x-owner-token (curl-friendly)
curl -s -X POST "$API/api/rules" \
  -H "Content-Type: application/json" \
  -H "x-owner-token: $OWNER_TOKEN" \
  -d '{
    "name": "Allowlist (only alice + treasury)",
    "type": "ALLOWED_RECIPIENT",
    "config": {
      "addresses": [
        "0x0000000000000000000000000000000000000000000000000000000000000bad",
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      ]
    }
  }' | jq
```

**Response (201):**

```json
{
  "rule": {
    "id": "cm2ccc...",
    "name": "Allowlist (only alice + treasury)",
    "type": "ALLOWED_RECIPIENT",
    "config": { "addresses": ["0x0000...0bad", "0x1234...cdef"] },
    "enabled": true,
    "createdAt": "2026-03-14T10:45:00.000Z",
    "updatedAt": "2026-03-14T10:45:00.000Z"
  },
  "commit": {
    "id": "cm2ddd...",
    "commitHash": "0x7b1e...9a3f",
    "version": 2,
    "txDigest": null,
    "createdAt": "2026-03-14T10:45:00.000Z",
    "commitDurationMs": 3
  }
}
```

`commitDurationMs` is the measured wall-clock time of the commit (a few
milliseconds in simulator mode; ~1.8s on Sui testnet once Move is deployed).
The UI shows "committed in 3ms" — turning "fast" into a real number.

---

### 3.6 `PATCH /api/rules/:id`

Update an existing rule's `enabled` state, `name`, or `config`. Owner-only.
Any successful change triggers a new `RuleBookCommit`.

**Auth:** Required.

**Request body schema (zod — all fields optional):**

```ts
{
  enabled?: boolean,
  name?: string,                // 1–80 chars
  config?: Record<string, unknown>
}
```

**Example:**

```bash
curl -s -X PATCH "$API/api/rules/cm1aaa" \
  -H "Content-Type: application/json" \
  -H "x-owner-token: $OWNER_TOKEN" \
  -d '{ "enabled": false }' | jq
```

**Response (200):**

```json
{
  "rule": { "id": "cm1aaa...", "enabled": false /* ... */ },
  "commit": { "id": "cm2eee...", "commitHash": "0x4c2d...77ab", "version": 3, /* ... */ }
}
```

**Response (404):**

```json
{ "error": "Rule not found" }
```

---

### 3.7 `DELETE /api/rules/:id`

Delete a rule. Owner-only. Triggers a new `RuleBookCommit`.

**Auth:** Required.

**Example:**

```bash
curl -s -X DELETE "$API/api/rules/cm1aaa" \
  -H "x-owner-token: $OWNER_TOKEN" | jq
```

**Response (200):**

```json
{
  "ok": true,
  "commit": { "id": "cm2fff...", "commitHash": "0x1a9f...e8b2", "version": 4, /* ... */ }
}
```

**Response (404):**

```json
{ "error": "Rule not found" }
```

---

### 3.8 `GET /api/wallet`

Returns the agent's own testnet address and SUI balance. Used by the wallet
card on the dashboard. Read-only.

**Auth:** None.

**Example:**

```bash
curl -s "$API/api/wallet" | jq
```

**Response (200):**

```json
{
  "address": "0xe21fa541fc2da38ef0c26741f83673b5699d0a61e176b3c37405f669720e20cc",
  "balanceSui": 4.9821,
  "network": "testnet"
}
```

**Response (500 — usually means `SUI_AGENT_SECRET_KEY` is unset or the RPC is unreachable):**

```json
{ "error": "SUI_AGENT_SECRET_KEY env var is not set" }
```

---

### 3.9 `GET /api/aliases`

Returns the list of named recipient aliases. Used by the chat UI to populate
the "Send to…" autocomplete and by `/api/agent/message` to resolve aliases.

**Auth:** None.

**Example:**

```bash
curl -s "$API/api/aliases" | jq
```

**Response (200):**

```json
{
  "aliases": [
    { "name": "self",     "address": "0xe21fa541...e20cc" },
    { "name": "alice",    "address": "0x0000...0bad"       },
    { "name": "treasury", "address": "0x1234...cdef"       }
  ]
}
```

To add new aliases, edit `backend/src/lib/aliases.ts`. Aliases are
case-insensitive on lookup.

---

### 3.10 `POST /api/seed`

Idempotent: inserts the three default rules (per-tx cap 5 SUI, daily cap 20
SUI, denylist) only if no rules exist. Also creates the initial
`RuleBookCommit` if missing. Safe to call multiple times.

**Auth:** None.

**Example:**

```bash
curl -s -X POST "$API/api/seed" | jq
```

**Response (200, first run):**

```json
{
  "ok": true,
  "message": "Seeded 3 default rules + initial vault commit (v1)"
}
```

**Response (200, subsequent runs):**

```json
{
  "ok": true,
  "message": "Seed skipped — 3 rule(s) already exist"
}
```

---

### 3.11 `POST /api/owner/login`

Establishes an owner session. Verifies the password against `OWNER_PASSWORD`
using constant-time comparison, then sets an HttpOnly + SameSite=None +
Secure signed session cookie. Returns 401 on mismatch.

**Auth:** None.

**Request body schema (zod):**

```ts
{ password: string }
```

**Example:**

```bash
curl -s -c /tmp/veto-cookie.txt -X POST "$API/api/owner/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"'"$OWNER_PASSWORD"'"}' | jq
```

**Response (200):**

```json
{ "ok": true, "message": "Owner session established" }
```

The `Set-Cookie` header on the response contains:

```
Set-Cookie: veto_owner_session=1742162537000.a3f5b8c9...; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=28800
```

Save it with `curl -c` (as above) or let the browser manage it. Use it on
subsequent requests with `curl -b /tmp/veto-cookie.txt`.

**Response (401):**

```json
{ "error": "Invalid password" }
```

**Response (400 — missing password field):**

```json
{ "error": "Must include { password: string }" }
```

---

### 3.12 `POST /api/owner/logout`

Clears the owner session cookie. Always returns 200, even if there was no
active session.

**Auth:** None.

**Example:**

```bash
curl -s -b /tmp/veto-cookie.txt -X POST "$API/api/owner/logout" | jq
```

**Response (200):**

```json
{ "ok": true, "message": "Logged out" }
```

The `Set-Cookie` header sets `veto_owner_session=` with `Max-Age=0`, which
deletes the cookie.

---

### 3.13 `GET /api/owner/status`

Returns whether the current request has a valid owner session. Used by the
UI to render the LOGIN/OWNER button in the header and by Render as the
health-check endpoint.

**Auth:** None.

**Example:**

```bash
curl -s -b /tmp/veto-cookie.txt "$API/api/owner/status" | jq
```

**Response (200, authenticated):**

```json
{ "authenticated": true }
```

**Response (200, not authenticated):**

```json
{ "authenticated": false }
```

This endpoint **always returns 200** (never 401) — it's a state probe, not
a protected resource. Render's health checker relies on this: a 200 means
the process is up and the DB connection works.

---

## 4. Error Responses

All errors are returned as JSON with an `error` field. Validation errors
also include a `details` field with the zod flatten output.

| Status | When                                                                 | Body |
|--------|----------------------------------------------------------------------|------|
| `400`  | Malformed JSON body, missing required fields, or zod validation fails | `{ "error": "Must include { message: string }" }` or `{ "error": "Invalid rule", "details": { "formErrors": [], "fieldErrors": { "name": ["Required"] } } }` |
| `401`  | `requireOwner()` middleware rejected the request — neither cookie nor `x-owner-token` is valid | `{ "error": "Unauthorized — owner session or token required", "hint": "POST /api/owner/login with { password } to get a session cookie, or send x-owner-token header" }` |
| `404`  | Rule or AgentRequest ID not found                                     | `{ "error": "Rule not found" }` or `{ "error": "Request not found" }` |
| `429`  | Rate limit exceeded on `/api/agent/*` (more than 10 req/min per IP)   | `{ "error": "Rate limit exceeded. Try again in N seconds." }` |
| `500`  | Unhandled server error — usually missing env var (`SUI_AGENT_SECRET_KEY`), DB unreachable, or Sui RPC failure | `{ "error": "SUI_AGENT_SECRET_KEY env var is not set" }` |

The backend never returns a stack trace in production — the error message is
either the thrown error's `.message` (for known operational errors) or the
literal string `"Internal server error"` (for unhandled exceptions, which
also get logged with full stack).

---

## 5. The Two-Step Confirmation Flow

The two-step flow is Veto's defense against LLM hallucinations. The user
types a message; the LLM parses it; the user sees exactly what was parsed
before any policy check or chain call happens.

```
┌─────────┐                            ┌─────────┐
│ Browser │                            │ Backend │
└────┬────┘                            └────┬────┘
     │                                      │
     │  1. POST /api/agent/message          │
     │     { message: "send 5 SUI to alice" } │
     │ ───────────────────────────────────► │
     │                                      │
     │                  2. LLM parse + alias resolve + stage
     │                  3. Insert AgentRequest row
     │                  status = AWAITING_CONFIRMATION
     │                                      │
     │  ◄─────────────────────────────────  │
     │  200 { id, parsedIntent, diff }      │
     │                                      │
     │  4. Render confirmation dialog       │
     │     (show diff: amount, recipient)   │
     │                                      │
     │              [ User clicks CONFIRM ] │
     │                                      │
     │  5. POST /api/agent/confirm          │
     │     { id, decision: "confirm" }      │
     │ ───────────────────────────────────► │
     │                                      │
     │                  6. Load staged request
     │                  7. T5 idempotency check
     │                  8. Vault pre-flight
     │                  9. Policy engine
     │                 10. SUI transfer (only path that signs)
     │                 11. Update AgentRequest status
     │                                      │
     │  ◄─────────────────────────────────  │
     │  200 { id, status, txDigest? }       │
     │                                      │
     │  12. Render result in activity feed  │
     │      (poll /api/requests every 4s)   │
     │                                      │
```

**Why two steps instead of one:** if the LLM hallucinates (e.g. user says
"send ten SUI" but the LLM returns `amountSui: 100`), the one-shot flow
would either execute the wrong amount or block it for the wrong reason. The
two-step flow surfaces the parsed intent in the diff, letting the user catch
the hallucination with their own eyes before it costs gas.

**The `diff` object** returned by `/api/agent/message` is the key UX
innovation:

```json
{
  "amountMentioned": 10,           // extracted from raw message
  "amountParsed": 100,             // ← red flag! LLM drifted
  "recipientMentioned": "alice",
  "recipientResolved": "0x...0bad",
  "recipientWasAlias": true
}
```

The UI highlights `amountMentioned !== amountParsed` in red, prompting the
user to look closely before clicking CONFIRM.

---

## 6. Rate Limiting

All `/api/agent/*` endpoints are rate-limited to **10 requests per minute per
IP** via Upstash Redis. The limit is implemented as a sliding-window counter
keyed on `ratelimit:agent:<ip>`.

**Implementation:**

```ts
// backend/src/middleware/rate-limit.ts (sketch)
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 10;

export async function rateLimit(req: Request): Promise<Response | null> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const key = `ratelimit:agent:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SECONDS);
  if (count > MAX_REQUESTS) {
    const ttl = await redis.ttl(key);
    return Response.json(
      { error: `Rate limit exceeded. Try again in ${ttl} seconds.` },
      { status: 429, headers: { "Retry-After": String(ttl) } }
    );
  }
  return null;
}
```

**Behavior:**

- The 11th request within a 60-second window gets `429 Too Many Requests`
  with a `Retry-After` header.
- Only `/api/agent/*` is rate-limited (the expensive LLM-parsing routes).
  `/api/requests`, `/api/wallet`, `/api/rules` GET, and `/api/owner/*` are
  not — they're cheap and the UI polls them.
- The rate limit is per-IP, not per-user. Behind a corporate NAT all
  employees share a budget. For the demo this is fine; for production you'd
  want per-API-key limits.

**Response (429):**

```json
{ "error": "Rate limit exceeded. Try again in 47 seconds." }
```

Headers:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 47
Content-Type: application/json
```

---

## 7. WebSocket Events (Future)

Not implemented in v1. The dashboard currently polls `/api/requests` every
4 seconds and `/api/rules` every 15 seconds, which is sufficient for the
hackathon demo load.

**Planned for v2:**

| Event                | Direction    | Payload                                              | When |
|----------------------|--------------|------------------------------------------------------|------|
| `request:created`    | server→client| `AgentRequest` (status=PENDING)                      | New `/api/agent/message` |
| `request:confirmed`  | server→client| `AgentRequest` (status=EXECUTED/BLOCKED/FAILED)      | After `/api/agent/confirm` |
| `commit:new`         | server→client| `RuleBookCommit`                                     | After every rule edit |
| `tamper:detected`    | server→client| `{ currentHash, committedHash }`                     | T4 mismatch detected |
| `wallet:balance`     | server→client| `{ balanceSui, address }`                            | After every EXECUTED request |

The v2 implementation will use Hono's built-in WebSocket helpers, with the
WS endpoint at `wss://veto-api.onrender.com/ws` authenticated by the same
owner-session cookie. Until then, polling is fine — the 4-second cadence
feels instant to the user and the bandwidth cost is negligible.
