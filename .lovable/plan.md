
The user wants to replace email/password auth in the extension with a code-based pairing flow: user logs into the web app, gets a code, pastes it into the extension, and the extension is then authorized to call the backend.

This is a classic "device pairing" / "linked device token" pattern (like how TVs, CLIs, or Spotify Connect pair). The web app already has Supabase email/password auth working — we keep that for the web. The extension never sees the user's password and never holds a Supabase session directly. Instead it holds a long-lived **extension token** that the backend validates.

## Approach: Pairing codes that mint extension tokens

```text
[Web app, logged in]            [Backend]                    [Extension]
        |                           |                              |
        |--- POST /pair/create ---->|                              |
        |   (with user JWT)         | generate 8-char code         |
        |<-- { code, expires_at } --|                              |
        |                           |                              |
   user copies code "K7P2-9XQM" ---------------> pastes into popup |
        |                           |                              |
        |                           |<--- POST /pair/redeem -------|
        |                           |     { code }                 |
        |                           | look up code, mint token,    |
        |                           | mark code consumed           |
        |                           |--- { extension_token } ----->|
        |                           |                              |
        |                           |<--- POST /draft-gmail-reply -|
        |                           |     Authorization: Bearer    |
        |                           |       <extension_token>      |
        |                           | validate token -> user_id    |
```

## Why this is good
- No password ever leaves the web app.
- Extension stores one opaque token, not a Supabase session.
- Tokens are revocable per-device from the dashboard.
- Quotas already keyed on `user_id` keep working unchanged.
- Pairing codes are short-lived (10 min) and single-use.

## What needs to be built

### 1. Database (new migration)
- `extension_pair_codes` — `code` (text, unique), `user_id`, `expires_at`, `consumed_at`. RLS: owner can read own.
- `extension_tokens` — `id`, `user_id`, `token_hash` (sha256, never store raw), `label` (e.g. "Chrome on Laptop"), `created_at`, `last_used_at`, `revoked_at`. RLS: owner can read/revoke own.

### 2. New Edge Functions
- `pair-create` — requires Supabase user JWT. Generates a human-friendly code like `K7P2-9XQM`, stores it, returns `{ code, expiresAt }`.
- `pair-redeem` — public (no JWT). Body `{ code }`. Validates code (exists, not expired, not consumed), mints a random 32-byte token, stores its sha256 hash in `extension_tokens`, marks code consumed, returns `{ extensionToken, userEmail }`. The raw token is shown to the extension exactly once.

### 3. Update `draft-gmail-reply`
Accept either:
- `Authorization: Bearer <supabase_jwt>` (existing), or
- `Authorization: Bearer ext_<extension_token>` (new)

When the prefix is `ext_`, hash the rest, look it up in `extension_tokens`, resolve `user_id`, update `last_used_at`. Reject if revoked or unknown. Quota logic stays identical.

### 4. Web app changes
- New dashboard section **"Connect Extension"**: button "Generate pairing code" → calls `pair-create` → shows the code in big monospace text with copy button and a 10-minute countdown.
- New dashboard section **"Connected devices"**: lists rows from `extension_tokens` (label, created, last used) with a Revoke button.

### 5. Extension changes (separate Codex prompt later)
Replace the email/password login screen with a single "Paste pairing code" input. On submit, call `pair-redeem`, store the returned `extension_token` in `chrome.storage.local`, and send it as `Authorization: Bearer ext_<token>` on every `draft-gmail-reply` call. No Supabase session, no refresh tokens, no GoTrue.

## Security notes
- Codes: 8 chars from an unambiguous alphabet (no `O/0/I/1`), 10-min TTL, single use, rate-limited per user (e.g. max 5 active).
- Tokens: 32 random bytes, base64url. Only the sha256 is stored. Raw token returned exactly once to the extension.
- Revocation is instant — `draft-gmail-reply` checks `revoked_at IS NULL` on every call.
- `pair-redeem` must be unauthenticated (the extension has no session yet) but is safe because the code is short-lived, single-use, and high-entropy enough for a 10-min window.

## Deliverables in implementation phase
1. Migration for `extension_pair_codes` + `extension_tokens` with RLS.
2. New edge functions `pair-create` and `pair-redeem`.
3. Updated `draft-gmail-reply` accepting both JWT and `ext_` tokens.
4. Dashboard UI: "Connect Extension" (generate code) + "Connected devices" (list/revoke).
5. A ready-to-paste Codex prompt for the extension to swap email/password for pairing-code redemption.

## One open question
Should the extension token be **long-lived until revoked** (simplest, matches "pair once and forget"), or **expire after e.g. 90 days** and require re-pairing? Long-lived is the standard choice for this UX and is what I'd recommend unless you want forced rotation.
