# Veto — Manual / Browser Test Checklist

These need a human in the browser, or real chain state — they can't be scripted from
outside your environment, so run through this yourself.

## 🚨 FIRST: Database provider check (do this before anything else)

**If your dev DB is SQLite (`db/custom.db` per the dev log), this breaks completely
once deployed to Vercel.** Vercel's serverless functions get a fresh, empty filesystem
on every single request — a SQLite file written to disk does not persist between
requests. Your rule book and history will silently reset or error in production even
though everything works perfectly on localhost.

**The fix (mandatory before deploying):**

```bash
# Switch to Postgres schema
./scripts/switch-db.sh postgres

# Create a free Neon Postgres project at https://neon.tech
# Copy the pooled connection string, then:
echo 'DATABASE_URL=postgresql://user:pass@host/db?sslmode=require' >> .env

# Push the schema to your new Postgres instance
bun run db:push

# Verify everything still works locally against Postgres
curl http://localhost:3000/api/wallet
curl http://localhost:3000/api/rules

# Run the pre-deploy check (catches SQLite + missing env vars)
./scripts/pre-deploy-check.sh
```

If you absolutely need offline local dev, switch back to SQLite temporarily:
`./scripts/switch-db.sh sqlite` — but **never commit the SQLite schema** as the
active `prisma/schema.prisma` when you push to GitHub for Vercel deployment.

## Auth (T6)

- [ ] LOGIN button visible while logged out
- [ ] Wrong password shows an error and does not log in
- [ ] Correct password (`dev-owner-password` in dev) logs in; header swaps to the OWNER badge
- [ ] Rule edit controls are disabled/hidden while logged out (clicking them prompts login)
- [ ] Rule edit controls work while logged in
- [ ] Logout returns to the logged-out state; edit controls disable again

## Tamper detection (T4) — your strongest demo beat, verify it for real

- [ ] Note the current "committed hash" shown on the rule book card
- [ ] In a separate terminal, edit a rule directly in the DB, bypassing the app entirely.
      The mutation command depends on your DB provider:

  **SQLite (local dev):**
  ```bash
  sqlite3 db/custom.db "UPDATE Rule SET config='{\"maxAmountSui\":99999}' WHERE name='Per-transaction cap';"
  ```

  **Postgres (production / Neon):**
  ```bash
  psql "$DATABASE_URL" -c "UPDATE \"Rule\" SET config='{\"maxAmountSui\":99999}' WHERE name='Per-transaction cap';"
  ```

- [ ] Within your polling interval (15s), confirm the red
      "RULE BOOK TAMPERING DETECTED" banner appears at the top of the page
- [ ] Confirm it shows both the last committed hash and the current mismatching hash
- [ ] Revert the DB edit back to the original value (`maxAmountSui: 5`)
- [ ] Confirm the banner clears within 15s

## OwnerCap enforcement on-chain — the actual "why Sui" proof

- [ ] Using the Sui CLI, attempt to call the rule-commit function on the deployed
      package WITHOUT passing the `OwnerCap` object as an argument
- [ ] Confirm the chain itself rejects the transaction (not just your app) — capture
      the error text
- [ ] Record this once; it only needs to be a 10-second clip in the demo video, it
      doesn't need to happen live

## Core flow

- [ ] A message that should be BLOCKED: confirm no chain call happened, the specific
      rule + reason is shown, and there is no tx digest anywhere on that record
- [ ] A message that should be APPROVED: confirm a real tx digest appears and resolves
      on Sui Explorer (testnet)
- [ ] Confirm the wallet balance shown on the dashboard actually decreases after a
      real executed transfer — not just that the UI says "executed"

## Idempotency (T5)

- [ ] Submit the exact same instruction twice within a few seconds
- [ ] Confirm only one results in an actual on-chain execution — the second is
      rejected or ignored as a duplicate, not double-spent
- [ ] Note from your own dev log: this only triggers against requests that reached
      `EXECUTED` — two requests that both failed for an unrelated reason (e.g. an
      empty wallet) are NOT a valid test of this; re-run with a funded wallet to
      actually exercise it

## Fail-closed edge case (the thing the test suite flagged)

- [ ] Disable every rule in the rule book (toggle each one off)
- [ ] Submit any transfer instruction
- [ ] Confirm the request is BLOCKED with `failedRule: fail_closed_no_rules`
- [ ] Confirm the reason text says "No enabled rules found... policy engine fails
      closed when the rule book is empty"
- [ ] Re-enable at least one rule and confirm transfers work again

This is the answer to the original test probe: "approves with zero enabled rules —
confirm this is the behavior you actually want." It is NOT. Fail-closed is.

## Deployment — confirm every box here BEFORE recording the final demo

- [ ] **Database engine check (see top of this file) — DONE**
- [ ] `bun run db:push` run successfully against the real Postgres URL
- [ ] `./scripts/pre-deploy-check.sh` passes (catches SQLite + missing env vars)
- [ ] All env vars set in Vercel: `DATABASE_URL` (Postgres), `SUI_AGENT_SECRET_KEY`,
      `OWNER_PASSWORD`, `SUI_NETWORK=testnet`
- [ ] Vercel build settings: framework=Next.js, build command=`bun run build`,
      install command=`bun install`
- [ ] Re-run the entire "Core flow" section above against the LIVE Vercel URL,
      not localhost, before considering it submission-ready
- [ ] Re-run `bun run test:api` with `BASE_URL=https://your-app.vercel.app` against
      the deployed URL — should be 10/10 PASS
- [ ] Re-run the "Tamper detection" section against the deployed Postgres DB too —
      the mutation command will need to target Postgres, not the old sqlite file

## Pre-submission smoke test (run this last)

```bash
# Localhost
BASE_URL=http://localhost:3000 OWNER_PASSWORD=dev-owner-password bun run test:api

# Vercel (after deploy)
BASE_URL=https://your-app.vercel.app OWNER_PASSWORD=yourrealpassword bun run test:api
```

Both should report `10 passed, 0 failed`.
