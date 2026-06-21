# Veto — Security Model

Veto is a policy gate for AI agents that sign transactions on Sui. The
security claim is concrete: **even if the agent's off-chain server is fully
compromised, an attacker cannot move more SUI per transaction or per day than
the owner's last-committed caps, and cannot change those caps without the
owner's on-chain OwnerCap object.** This document is the threat model, the
mitigations, and the demo-able proofs for each.

---

## Table of Contents

1. [Threat Model (T1–T6)](#1-threat-model-t1t6)
2. [The Three Layers of Defense](#2-the-three-layers-of-defense)
3. [Owner / Agent Trust Boundary Enforcement](#3-owner--agent-trust-boundary-enforcement)
4. [Cookie Security](#4-cookie-security)
5. [CORS Configuration](#5-cors-configuration)
6. [Rate Limiting](#6-rate-limiting)
7. [Idempotency (T5)](#7-idempotency-t5)
8. [Tamper Detection (T4)](#8-tamper-detection-t4)
9. [Fail-Closed Behavior](#9-fail-closed-behavior)
10. [Input Validation (Zod)](#10-input-validation-zod)
11. [LLM Output Validation](#11-llm-output-validation)
12. [Private Key Handling](#12-private-key-handling)
13. [Production Hardening Checklist](#13-production-hardening-checklist)

---

## 1. Threat Model (T1–T6)

Six threats were identified during the design review. Each has a specific
mitigation and a demo-able proof — "we say it's safe" must be convertible to
"we can show it's enforced."

| ID | Threat                                         | Scenario                                                                                       | Mitigation                                                                                                                                | Demo-able? |
|----|------------------------------------------------|------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|------------|
| T1 | **LLM hallucination** — agent moves wrong amount | User says "send ten SUI"; LLM returns `amountSui: 100`.                                        | Two-step confirmation flow: parsed intent is shown to user before any chain call. UI highlights when `amountMentioned !== amountParsed`. | ✅ Type "send ten SUI to alice" → confirmation dialog shows `amountParsed: 100` in red, user clicks REJECT → `failedRule: "user_rejected"` |
| T2 | **Empty rule book** — agent approves everything  | Owner accidentally disables all rules; agent immediately approves a 100 SUI transfer.          | Policy engine fails closed: zero enabled rules → `BLOCKED` with `failedRule: "fail_closed_no_rules"`.                                     | ✅ Disable all three rules → submit transfer → BLOCKED with `fail_closed_no_rules` |
| T3 | **Server compromise** — attacker steals agent keypair | Attacker gets `SUI_AGENT_SECRET_KEY`, submits raw `vault::spend` calls.                       | On-chain `Vault` enforces `per_tx_cap` and `daily_cap` in Move — attacker cannot exceed them. Cannot call `configure()` without `OwnerCap`. | ✅ `sui client call --function spend` with a huge amount → aborted with `EAmountExceedsPerTx` |
| T4 | **Direct DB tampering** — attacker edits rules bypassing API | Attacker with DB credentials mutates `Rule.config` to raise the cap.                          | Tamper detection: `computeRulesHash()` recomputes the canonical hash every 15s and compares to the last `RuleBookCommit.commitHash`. UI shows red banner on mismatch. | ✅ `psql` to update a rule's `config` → within 15s the UI shows "RULE BOOK TAMPERING DETECTED" with both hashes |
| T5 | **Replay / double-submit** — network retry double-spends | User clicks CONFIRM, network is slow, user clicks again; both requests execute.               | Idempotency check: SHA-256(`rawMessage + amountSui + recipient`) of any EXECUTED request in last 60s → BLOCKED with `failedRule: "idempotency_check"`. | ✅ Submit + confirm a transfer → immediately submit + confirm the same → second one is BLOCKED as duplicate |
| T6 | **Owner/Agent boundary collapse** — agent can edit its own rules | Agent has a bug that allows it to call `/api/rules` POST and raise its own cap.               | Two-layer auth: (1) app-level `requireOwner()` middleware on `/api/rules*` (cookie or `x-owner-token`); (2) chain-level `OwnerCap` arg in `vault::commit_rules` and `vault::configure`. | ✅ `curl -X POST /api/rules` without cookie → `401 Unauthorized`. On-chain: `sui client call --function commit_rules` without OwnerCap object → rejected at protocol level |

Every threat is closed by a combination of off-chain policy and on-chain
enforcement — never by off-chain alone.

---

## 2. The Three Layers of Defense

```
┌──────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Two-step confirmation (UI + backend)                       │
│   Catches: T1 (LLM hallucination)                                    │
│   Where it runs: /api/agent/message stages as AWAITING_CONFIRMATION, │
│                  /api/agent/confirm executes only after user click    │
│   Bypassable by: attacker who can control the user's browser         │
└──────────────────────────────────────────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Off-chain policy engine (pure TS)                          │
│   Catches: T2 (fail-closed), and the rule-book portion of T3/T4      │
│   Where it runs: runPolicyEngine() in /api/agent/confirm             │
│   Bypassable by: attacker with full server control                  │
│   (which is why Layer 3 exists)                                      │
└──────────────────────────────────────────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — On-chain vault (Sui Move)                                  │
│   Catches: T3 (caps enforced even with server compromise), T6        │
│            (OwnerCap required for configure/commit_rules)            │
│   Where it runs: veto::vault module on Sui Testnet                   │
│   Bypassable by: nobody — Sui consensus is the root of trust         │
└──────────────────────────────────────────────────────────────────────┘
```

**Key insight:** Layer 3 doesn't replace Layer 2 — it bounds the damage if
Layer 2 is compromised. If an attacker fully controls the backend, they can
still only spend *within* the owner's last-committed caps. They cannot raise
the caps, cannot change the rule hash, cannot call `vault::configure` or
`vault::commit_rules` — both require the `OwnerCap` object, which the
attacker doesn't have (it's held by the owner's key, not the agent's).

---

## 3. Owner / Agent Trust Boundary Enforcement

The Owner/Agent boundary is enforced at **two layers**, in series:

### App layer: `requireOwner()` middleware

Every `/api/rules*` mutation route (POST, PATCH, DELETE) calls
`requireOwner(req)` as its first line. If the check fails, the request never
reaches the handler — it returns `401 Unauthorized` immediately.

```ts
// backend/src/lib/auth.ts
export function requireOwner(req: NextRequest): NextResponse | null {
  // 1. Cookie check (browser sessions)
  if (verifySessionCookie(cookies[OWNER_COOKIE_NAME])) return null;
  // 2. Token check (API clients / curl)
  if (provided === expectedToken) return null;
  // 3. Neither — reject
  return NextResponse.json({ error: "Unauthorized — owner session or token required", ... }, { status: 401 });
}
```

This is the **app-level** gate. It's bypassable by anyone with full server
control (they could just edit the source). Its purpose is to enforce the
boundary in normal operation, not to resist server compromise.

### Chain layer: `OwnerCap` capability object

```move
// contracts/sources/vault.move
public fun commit_rules(
    _cap: &OwnerCap,        // ← runtime checks you OWN this object
    vault: &mut Vault,
    new_hash: vector<u8>,
) { /* ... */ }

public fun configure(
    _cap: &OwnerCap,        // ← runtime checks you OWN this object
    vault: &mut Vault,
    per_tx_cap_mist: u64,
    daily_cap_mist: u64,
) { /* ... */ }
```

The `_cap` parameter is unused inside the function body (note the underscore
prefix) — its presence in the signature is what matters. The Sui runtime
checks object ownership **before** the function body executes. A transaction
without the OwnerCap object is rejected at the protocol level.

This is the **chain-level** gate. It's bypassable by nobody — not even an
attacker with full server control, because they don't have the OwnerCap
object (it's owned by the owner's key, which they haven't stolen).

### Why both layers

| Attack                              | App layer stops it? | Chain layer stops it? |
|-------------------------------------|---------------------|------------------------|
| Agent process tries to call `/api/rules` (normal bug) | ✅ 401 | n/a (never reaches chain) |
| Attacker steals agent keypair, tries `vault::configure` | n/a (no HTTP) | ✅ Move abort |
| Attacker steals agent keypair, tries `vault::spend` | n/a | ⚠️ within caps only |
| Attacker steals owner password, edits rules via API | ✗ | ✅ commit event is on-chain + auditable |
| Attacker steals owner key, transfers OwnerCap to self | n/a | ✗ (this is the root of trust — must be protected with multisig/zkLogin in production) |

The chain layer is the actual security boundary. The app layer is UX + audit
trail.

---

## 4. Cookie Security

The owner session cookie (`veto_owner_session`) is the browser-facing
half of the Owner auth story. Its security properties:

| Property           | Value                              | Why |
|--------------------|------------------------------------|-----|
| `HttpOnly`         | `true`                             | JavaScript can't read it → no XSS cookie theft |
| `SameSite`         | `None` (production) / `Lax` (local) | Cross-origin frontend needs to send it; `Strict` would break the cookie flow |
| `Secure`           | `true`                             | Only sent over HTTPS — Render and Vercel both auto-HTTPS |
| `Path`             | `/`                                | Sent on every backend request |
| `Max-Age`          | `28800` (8 hours)                  | Long enough to demo, short enough to limit session-hijack window |
| Value format       | `<expiresAtMs>.<hmac>`             | HMAC-SHA-256 of the expiry using `OWNER_COOKIE_SECRET` |
| Comparison         | constant-time                      | No early-exit on first mismatch → no timing oracle on cookie forgery |

**Cookie value construction** (`createSessionCookie`):

```ts
const expiresAt = Date.now() + expiresInSeconds * 1000;
const payload = String(expiresAt);
const hmac = createHmac("sha256", getCookieSecret())
  .update(payload)
  .digest("hex");
return `${payload}.${hmac}`;
```

**Cookie verification** (`verifySessionCookie`) uses constant-time
comparison:

```ts
if (sig.length !== expected.length) return false;
let diff = 0;
for (let i = 0; i < sig.length; i++) {
  diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
}
return diff === 0;
```

The `diff |=` accumulates XOR differences across the whole string without
short-circuiting, so the loop runs in constant time regardless of where
the first mismatch occurs. This prevents an attacker from timing the
response to figure out how many bytes of the HMAC they got right.

**Cookie secret rotation:** `OWNER_COOKIE_SECRET` can be rotated at any
time. All existing cookies become invalid immediately (the HMAC won't
verify), forcing owners to re-login. There's no graceful rotation in v1 —
in production you'd accept both old and new secrets for a grace period.

---

## 5. CORS Configuration

The backend uses Hono's `cors()` middleware configured for
credentials-bearing cross-origin requests:

```ts
// backend/src/index.ts
import { cors } from "hono/cors";

app.use("/api/*", cors({
  origin: (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()),
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "x-owner-token", "Authorization"],
  credentials: true,                     // ← required for cookies
  maxAge: 86400,                         // cache preflight for 24h
}));
```

| Setting            | Value                              | Why |
|--------------------|------------------------------------|-----|
| `origin`           | exact list from `CORS_ORIGIN` env  | Reflects the specific allowed origin(s) — required when `credentials: true` |
| `allowMethods`     | `GET, POST, PATCH, DELETE, OPTIONS`| Every method the API uses |
| `allowHeaders`     | `Content-Type, x-owner-token, Authorization` | The three headers any client might send |
| `credentials`      | `true`                             | Browser sends the owner cookie cross-origin |
| `maxAge`           | `86400` (24h)                      | Caches preflight responses — avoids an OPTIONS round-trip on every request |

**Critical:** when `credentials: true`, the `Access-Control-Allow-Origin`
response header **must** be the specific origin (not `*`). Hono's `cors()`
middleware handles this automatically when `origin` is an array.

**Allowed origins** are configured via `CORS_ORIGIN` (comma-separated for
multiple). For the hackathon: `https://veto.vercel.app` (production) and
`http://localhost:3000` (local dev). Production must not include
`localhost`.

---

## 6. Rate Limiting

Only the LLM-bearing endpoints are rate-limited — the rest are cheap and
frequently polled by the UI.

| Route prefix       | Limit           | Window | Storage          | Key                          |
|--------------------|-----------------|--------|------------------|------------------------------|
| `/api/agent/*`     | 10 requests     | 60s    | Upstash Redis    | `ratelimit:agent:<client-ip>` |
| Everything else    | unlimited      | —      | —                | —                            |

**Implementation:**

```ts
// backend/src/middleware/rate-limit.ts
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

**Why Upstash Redis (not in-memory):** Render's web service can have
multiple instances (and the free tier spins down/up, losing in-memory state).
Redis gives us a shared counter across instances and survives restarts. The
Upstash REST API works from serverless environments that don't allow raw TCP.

**Why 10/min:** the LLM parse is the most expensive operation (a network call
to the model). 10/min is enough for a human-paced demo (one message every 6
seconds) but caps a malicious script's blast radius. The rate limit is
per-IP, not per-user, so all clients behind a NAT share a budget — fine for
demo, would want per-API-key for production.

**`Retry-After` header:** the 429 response includes a `Retry-After: <seconds>`
header so well-behaved clients can back off precisely. The body also includes
the same number for human reading.

---

## 7. Idempotency (T5)

The idempotency check prevents network retries and double-clicks from
double-spending.

**Mechanism:**

1. On `/api/agent/confirm` with `decision: "confirm"`, before any other
   check, compute
   `key = SHA-256(rawMessage + "|" + amountSui + "|" + recipient)`.
2. Query the `AgentRequest` table for any row with:
   - `status = "EXECUTED"` (only successful executions count — FAILED
     requests don't block retries)
   - `amountSui = staged.amountSui`
   - `recipient = staged.recipient`
   - `rawMessage = staged.rawMessage`
   - `confirmedAt >= (now - 60s)`
   - `id != staged.id` (exclude the current request)
3. If a match exists → BLOCKED with `failedRule: "idempotency_check"`.

**Why 60 seconds:** long enough to absorb network retries (which usually
retry within seconds) but short enough that the user can legitimately repeat
the same transfer (e.g. "send 5 SUI to alice" twice in a row, deliberately)
without being blocked.

**Why hash on `rawMessage + amount + recipient`** and not just `rawMessage`:
two different LLM parsings of the same message (rare but possible) shouldn't
be treated as the same request. If the LLM hallucinated `amountSui: 5` on
the first try and `amountSui: 50` on the second, those are different intents
and the second shouldn't be blocked by the first.

**Why exclude the current `id`:** the staged request row was created in
step 1 of the flow. If we didn't exclude it, every confirm would match its
own staged row and always be blocked.

**Index:** the composite index
`@@index([status, amountSui, recipient, rawMessage, confirmedAt])` on
`AgentRequest` makes this query fast — it's a single index range scan
covering all four equality predicates plus the time window.

**Demo:**

```bash
# First transfer — succeeds
curl -X POST $API/api/agent/message -d '{"message":"send 0.5 SUI to self"}' | jq .id
#   → "cm2abc..."
curl -X POST $API/api/agent/confirm -d '{"id":"cm2abc...","decision":"confirm"}'
#   → {"status":"EXECUTED","txDigest":"..."}

# Immediate retry — blocked
curl -X POST $API/api/agent/message -d '{"message":"send 0.5 SUI to self"}' | jq .id
#   → "cm2def..."
curl -X POST $API/api/agent/confirm -d '{"id":"cm2def...","decision":"confirm"}'
#   → {"status":"BLOCKED","failedRule":"idempotency_check","failReason":"Blocked as a duplicate within the 60-second idempotency window (T5 replay protection)."}

# After 60s — succeeds again
```

---

## 8. Tamper Detection (T4)

The tamper-detection system catches direct database edits to the `Rule`
table — i.e. someone bypassing the `/api/rules` API (which always
re-commits the hash).

**Mechanism:**

1. Every successful rule edit (POST/PATCH/DELETE on `/api/rules`) computes
   the canonical hash of the current rule set and writes a new
   `RuleBookCommit` row with that hash.
2. `GET /api/rules` returns a `tamper` object that:
   - Recomputes the canonical hash of the current `Rule` rows.
   - Loads the latest `RuleBookCommit.commitHash`.
   - Compares the two.
   - Returns `{ tampered, currentHash, committedHash, lastCommittedAt }`.
3. The UI polls `/api/rules` every 15 seconds and renders a red banner if
   `tampered === true`.

**Canonical hash recipe** (`computeRulesHash`):

```ts
const sorted = [...rules].sort(/* by createdAt then id */);
const enabled = sorted.filter(r => r.enabled);
const canonical = enabled.map(r => ({ name: r.name, type: r.type, config: r.config }));
return "0x" + sha256(JSON.stringify(canonical)).toString("hex");
```

**What it catches:**

- Direct `UPDATE "Rule" SET config = '{"maxAmountSui": 99999}'` via psql.
- An attacker with read-write DB access editing the cap up.
- A Prisma migration that accidentally drops a rule.

**What it doesn't catch:**

- An attacker who edits the rule **and** writes a new `RuleBookCommit` row
  with the matching hash. To stop this, you'd need the on-chain hash — see
  below.

**Production hardening (when Move is deployed):** the on-chain `Vault`
object's `rules_commit_hash` field is the authoritative hash. The tamper
check then compares the local recomputed hash to **both** the local
`RuleBookCommit.commitHash` AND the on-chain `vault.rules_commit_hash`. A
mismatch on either is a tamper event. The on-chain comparison is what makes
the check unforgeable — an attacker with DB access can rewrite local rows,
but cannot rewrite the Sui object.

**Demo:**

```bash
# From a psql prompt, mutate a rule directly:
psql $DATABASE_URL -c "UPDATE \"Rule\" SET config = '{\"maxAmountSui\":99999}' WHERE name = 'Per-transaction cap';"

# Within 15s, the UI shows a red banner:
#   ⚠ RULE BOOK TAMPERING DETECTED
#     current:  0x9f3a...c2d9
#     committed:0x7b1e...9a3f
#     Last commit was at 2026-03-14 10:00:00 UTC
```

Reverting the edit clears the banner on the next poll.

---

## 9. Fail-Closed Behavior

The policy engine's most important property: **if there are zero enabled
rules, BLOCK everything.**

```ts
// backend/src/lib/policy-engine.ts
export function runPolicyEngine(
  intent: ParsedIntent,
  rules: Rule[],
  context: PolicyContext
): PolicyDecision {
  const enabledRules = rules.filter(r => r.enabled).sort(/* by createdAt */);

  if (enabledRules.length === 0) {
    return {
      decision: "BLOCKED",
      failedRule: "fail_closed_no_rules",
      reason: "No enabled rules found. The policy engine fails closed when the rule book is empty — add at least one rule (e.g. a per-tx cap) to allow any transfer.",
    };
  }

  for (const rule of enabledRules) {
    const result = evaluateRule(rule, intent, context);
    if (!result.pass) {
      return { decision: "BLOCKED", failedRule: rule.name, reason: result.reason };
    }
  }
  return { decision: "APPROVED" };
}
```

**Why fail-closed:** an empty rule book is almost certainly a misconfiguration
(disabled by accident, migration wiped the table, etc.). The "safe" thing to
do is refuse to act. If the owner genuinely wants to allow everything, they
add an explicit `MAX_AMOUNT_PER_TX` rule with a very high cap — making the
intent visible in the audit trail.

**The alternative (fail-open) would be catastrophic:** "owner accidentally
disabled all rules → agent immediately transfers 100 SUI → owner loses
funds." Fail-closed turns this into "owner accidentally disabled all rules
→ agent's transfer is BLOCKED → owner notices and re-enables."

**Demo:**

```bash
# Disable all rules (requires owner auth)
curl -X PATCH $API/api/rules/cm1aaa -H "x-owner-token: $TOKEN" -d '{"enabled":false}'
curl -X PATCH $API/api/rules/cm1bbb -H "x-owner-token: $TOKEN" -d '{"enabled":false}'
curl -X PATCH $API/api/rules/cm1ccc -H "x-owner-token: $TOKEN" -d '{"enabled":false}'

# Try a transfer
curl -X POST $API/api/agent/message -d '{"message":"send 0.5 SUI to self"}' | jq .id
curl -X POST $API/api/agent/confirm -d '{"id":"...","decision":"confirm"}'
# → {"status":"BLOCKED","failedRule":"fail_closed_no_rules","reason":"No enabled rules found..."}
```

This is the answer to the security-review question "what happens when the
rule book is empty?" — it's not "everything is allowed," it's "everything is
blocked."

---

## 10. Input Validation (Zod)

Every API body is validated by a zod schema before any business logic runs.
No exceptions. This is the first line of defense against malformed input,
injection attacks, and unexpected type drift.

| Route                       | Schema                                          |
|-----------------------------|-------------------------------------------------|
| `POST /api/agent/message`   | `z.object({ message: z.string().min(1).max(500) })` |
| `POST /api/agent/confirm`   | `z.object({ id: z.string().min(1), decision: z.enum(["confirm","reject"]) })` |
| `POST /api/rules`           | `z.object({ name: z.string().min(1).max(80), type: RuleTypeSchema, config: z.record(z.string(), z.unknown()) })` |
| `PATCH /api/rules/:id`      | `z.object({ enabled: z.boolean().optional(), name: z.string().min(1).max(80).optional(), config: z.record(z.string(), z.unknown()).optional() })` |
| `POST /api/owner/login`     | `z.object({ password: z.string().min(1) })`     |

```ts
const validation = MessageSchema.safeParse(body);
if (!validation.success) {
  return NextResponse.json(
    { error: "Must include { message: string }" },
    { status: 400 }
  );
}
// validation.data is now fully typed — TS narrows it automatically
```

**Why zod:** schemas are TypeScript types *and* runtime validators, so we
get type narrowing for free. The `safeParse` API returns a discriminated
union (`{ success: true, data } | { success: false, error }`) that the type
checker enforces.

**Boundaries:**

- String fields always have `min(1)` (no empty strings) and `max(N)` (no
  pathologically long inputs that could DoS the DB or LLM).
- Enum fields use `z.enum([...])` — anything not in the list is rejected.
- Config objects use `z.record(z.string(), z.unknown())` — accept any JSON
  shape (the route handler then validates per-rule-type).

---

## 11. LLM Output Validation

The LLM's output is treated as **completely untrusted**. It goes through
three layers of validation before it can influence any downstream behavior:

### Layer 1: Markdown fence stripping

LLMs sometimes wrap JSON in ` ```json … ``` ` despite being told not to. The
`stripFences` function removes them:

```ts
function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  return t.trim();
}
```

### Layer 2: JSON extraction

The model sometimes adds prose around the JSON ("Here is your intent: {…}").
The `extractJson` function pulls out just the `{…}` substring:

```ts
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}
```

### Layer 3: Zod schema validation

The extracted JSON is parsed and validated against a strict schema:

```ts
const IntentSchema = z.object({
  action: z.enum(["transfer", "unknown"]),
  amountSui: z.number().positive().optional(),
  recipient: z.string().optional(),
  reason: z.string().optional(),
});
```

If validation fails, the function returns
`{ action: "unknown", reason: "LLM output failed schema validation" }` —
the caller treats this as a parse failure (status=FAILED). The model's raw
output never reaches the policy engine or the chain.

**Critical property:** the LLM is **only** called inside
`parseIntent()`, which is **only** called inside `/api/agent/message` (step
2 of the request flow). The policy engine and the SUI executor never see
LLM output directly — they only see the zod-validated `ParsedIntent`.

---

## 12. Private Key Handling

The agent's Sui keypair is loaded from `SUI_AGENT_SECRET_KEY` once at
process start, kept in a module-level `_keypair` variable, and **never**
leaves the backend process.

```ts
// backend/src/lib/sui.ts
let _keypair: Ed25519Keypair | null = null;

export function getAgentKeypair(): Ed25519Keypair {
  if (!_keypair) {
    const secret = process.env.SUI_AGENT_SECRET_KEY;
    if (!secret) throw new Error("SUI_AGENT_SECRET_KEY env var is not set");
    _keypair = Ed25519Keypair.fromSecretKey(secret);
  }
  return _keypair;
}
```

**Properties:**

| Property | How enforced |
|----------|--------------|
| Never sent to the client | `getAgentKeypair()` is only called inside `/api/agent/confirm` and `/api/wallet` (which only returns the **address**, not the key) |
| Never logged | No `console.log(_keypair)` anywhere in the codebase; ESLint rule could enforce this |
| Never serialized | The `Ed25519Keypair` class doesn't expose a `toJSON` method; accidental `JSON.stringify` would throw |
| Loaded once, kept in memory | `_keypair` is a module-level singleton; the env var is read only on first access |
| Rotateable | Set a new `SUI_AGENT_SECRET_KEY`, restart the backend. Old address becomes read-only. |

**Signing is gated behind the policy engine:** the only function that signs
anything is `executeTransfer()`, which is only called at the end of
`/api/agent/confirm` — after the idempotency check, the vault pre-flight,
and the policy engine have all approved. There is no other code path to the
keypair.

**Production hardening:**

- For mainnet: use a HSM-backed signer (AWS KMS, GCP KMS) instead of a raw
  env var. The `@mysten/sui` signer interface accepts a custom signer.
- For multi-sig: wrap the agent's key in a Sui multisig committee so a
  single key compromise can't move funds.
- For zkLogin: replace the env-var key with a JWT-issued zkLogin session,
  so the actual signing key never lives on the server at all.

---

## 13. Production Hardening Checklist

Before going to mainnet (or before judging if the demo is being graded on
security posture):

### Secrets

- [ ] `OWNER_PASSWORD` is at least 32 random characters, generated via `openssl rand -base64 32`.
- [ ] `OWNER_COOKIE_SECRET` is **different** from `OWNER_PASSWORD`, also 32+ random chars.
- [ ] `OWNER_TOKEN` (for curl/CI) is 32+ random chars and rotated quarterly.
- [ ] `SUI_AGENT_SECRET_KEY` is stored in Render's secret store (not plaintext env).
- [ ] None of the above are committed to git (`.gitignore` includes `.env*`).
- [ ] Render's "Secret Files" feature is used for the keypair (not env var) if you want extra isolation.

### Network

- [ ] `CORS_ORIGIN` is set to the exact production frontend URL (no `localhost`, no `*`).
- [ ] Rate limit on `/api/agent/*` is enforced (verify with `ab -n 20 -c 1 $API/api/agent/message` → some return 429).
- [ ] HTTPS is enforced on both Vercel (automatic) and Render (automatic on `*.onrender.com`).
- [ ] The `Secure` flag is set on the owner cookie (verify in browser DevTools → Application → Cookies).

### Database

- [ ] `prisma/schema.prisma` is `provider = "postgresql"` (run `bash scripts/pre-deploy-check.sh`).
- [ ] `DATABASE_URL` uses the Neon **pooled** connection string (`-pooler` in hostname).
- [ ] Neon's "branch protection" is on — production branch can't be deleted from the UI.
- [ ] Neon's IP allowlist (if configured) includes Render's egress IPs.
- [ ] Daily backups are enabled (Neon free tier: 7 days of PITR).

### Smart contracts

- [ ] `sui move build --path contracts` succeeds with no warnings.
- [ ] `sui client verify-bytecode` matches the published digest (verifies source-on-chain).
- [ ] `OWNER_CAP_ID` is owned by the owner's address (not the agent's) — verify with `sui client object <OWNER_CAP_ID>`.
- [ ] `VAULT_OBJECT_ID` is shared (verify owner is `Shared` in `sui client object`).
- [ ] A Sui Explorer link to the publish transaction is in the README.

### Application

- [ ] `bash scripts/pre-deploy-check.sh` passes.
- [ ] `bun run lint` passes in both `frontend/` and `backend/`.
- [ ] `bun test` passes (19 unit tests for policy engine).
- [ ] `bash backend/tests/api-test.sh` passes 10/10 against production backend.
- [ ] All 8 smoke-test scenarios from Deployment.md §8.3 pass.
- [ ] The tamper-detection banner fires on direct DB edit (T4 demo).
- [ ] The fail-closed behavior fires when all rules are disabled (T2 demo).
- [ ] The idempotency check fires on a retry within 60s (T5 demo).
- [ ] `/api/rules` POST returns 401 without auth (T6 demo).

### Monitoring (for mainnet, optional for hackathon)

- [ ] Render's "Health Check" is set to `/api/owner/status` with a 60s grace period.
- [ ] Render's "Deploy Hooks" trigger on push to `main`.
- [ ] Uptime monitor (UptimeRobot, BetterStack) pings `/api/owner/status` every 5 min.
- [ ] Sentry or equivalent is wired up for unhandled exceptions.
- [ ] Log aggregation (Logtail, Datadog) is capturing backend logs — particularly the `failedRule` field on every BLOCKED request, which is the audit signal.

If every box is checked, the system is ready for mainnet. If any box is
unchecked, the system is a hackathon demo — not production.
