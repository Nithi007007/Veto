# Veto — Manual / Browser Test Checklist

These need a human in the browser, or real chain state — they can't be scripted from
outside your environment, so run through this yourself.

## Auth (T6)

- [ ] LOGIN button visible while logged out
- [ ] Wrong password shows an error and does not log in
- [ ] Correct password logs in; header swaps to the OWNER badge
- [ ] Rule edit controls are disabled/hidden while logged out
- [ ] Rule edit controls work while logged in
- [ ] Logout returns to the logged-out state; edit controls disable again

## Tamper detection (T4) — your strongest demo beat, verify it for real

- [ ] Note the current "committed hash" shown on the rule book card
- [ ] In a separate terminal, edit a rule directly in the DB, bypassing the app entirely
      (adjust this to match your actual DB — example for the sqlite dev DB from your log):
      `sqlite3 db/custom.db "UPDATE Rule SET config='{\"maxAmountSui\":99999}' WHERE name='Per-transaction cap';"`
- [ ] Within your polling interval (the log mentioned ~15s), confirm the red
      "RULE BOOK TAMPERING DETECTED" banner appears
- [ ] Confirm it shows both the last committed hash and the current mismatching hash
- [ ] Revert the DB edit back to the original value
- [ ] Confirm the banner clears

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

## Deployment — confirm every box here BEFORE recording the final demo

- [ ] **Database engine check, do this first:** if your dev DB is SQLite (e.g.
      `db/custom.db` per your log), this breaks completely once deployed to Vercel.
      Vercel's serverless functions get a fresh, empty filesystem on every single
      request — a SQLite file written to disk does not persist between requests.
      Your rule book and history will silently reset or error in production even
      though everything works perfectly on localhost.
      Fix: set `provider = "postgresql"` in `schema.prisma`, point `DATABASE_URL`
      at a real Postgres instance (Neon free tier works), and re-run migrations
      against it.
- [ ] `npx prisma migrate deploy` run successfully against the real Postgres URL
- [ ] All env vars set in Vercel: `DATABASE_URL`, `SUI_AGENT_SECRET_KEY`,
      `ANTHROPIC_API_KEY`, `OWNER_PASSWORD`, `SUI_NETWORK=testnet`
- [ ] Re-run the entire "Core flow" section above against the LIVE Vercel URL,
      not localhost, before considering it submission-ready
- [ ] Re-run the "Tamper detection" section against the deployed Postgres DB too —
      the mutation command will need to target Postgres, not the old sqlite file
