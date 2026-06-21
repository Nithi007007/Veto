# Veto — Hackathon Demo

Veto is a safety-first demo that lets AI agents propose transfers while guaranteeing the funds can't be moved unless strict policies are satisfied.

This repo is tailored for a hackathon demo: short setup, clear demos, and visuals judges can interact with.

## Why Veto (1-line)
Prevent agent mistakes: parse intent, require user confirmation, validate against rules, then execute.

## Quick Demo Script (60s)
1. Run the app locally: `npm run dev`
2. Open `http://localhost:3000`
3. In the chat box, type: `send 2 sui to alice`
4. Confirm the parsed intent in the dialog → watch the activity feed

## Hackathon Highlights
- Deterministic parsing, no LLM dependence for safety demos
- Two-step approval prevents hallucination-based transfers
- On-chain vault design (simulated locally) demonstrates real-world enforceability
- Compact codebase: easy to explain in 3–5 minutes

## Quick Setup
```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

## What to show judges
- Dashboard showing current `per-tx` cap and `daily` cap
- Parsed intent preview and confirmation dialog
- Activity feed with AWAITING_CONFIRMATION → EXECUTED entries
- Rule-book commit hash display (tamper detection)

## Contact
For demo help, message the repo owner or open an issue.
