# Apps Backend

A shared backend that powers multiple products from a single account, dashboard,
and set of edge functions.

## Products

- **Send Smart** — AI-powered Gmail reply drafting (Chrome extension + dashboard).
- _More products coming — they will reuse the same auth, usage, and settings infrastructure._

## What's in here

- React + Vite frontend (landing, auth, dashboard)
- Supabase-backed auth, database, and edge functions
- Per-product edge functions under `supabase/functions/`
