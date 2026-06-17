# usage-get Edge Function — API Reference

## Overview

`usage-get` returns the current month's usage counters and recent reply activity for the authenticated user. Both the **Chrome extension** and the **webapp dashboard** call this endpoint to retrieve usage data.

---

## Endpoint

```
GET  /functions/v1/usage-get
POST /functions/v1/usage-get
```

> The function accepts both `GET` and `POST`. No request body is required or read.

---

## Authentication

Send a `Bearer` token in the `Authorization` header. The function supports two auth paths:

### 1. Direct Lovable Cloud (Send Smart) JWT
```
Authorization: Bearer <supabase-jwt>
```

### 2. Partner-project bridged JWT
If the user signed in through a partner app (e.g., Smart Reply Hub), send that project's JWT. The function verifies it against the partner's JWKS and resolves the user via a bridge account.

---

## CORS

Preflight `OPTIONS` is handled automatically. Allowed headers:
- `authorization`
- `x-client-info`
- `apikey`
- `content-type`

---

## Request Examples

### Chrome Extension
```js
const res = await fetch(
  "https://uexdjvbdqwrzlgfrpgbl.supabase.co/functions/v1/usage-get",
  {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": "<anon-key>",
    },
  }
);
const data = await res.json();
```

### Webapp (Supabase client)
```ts
const { data, error } = await supabase.functions.invoke("usage-get");
```

---

## Response

### Success — `200 OK`

```json
{
  "period": "2026-06",
  "quota": {
    "emails": 500,
    "inputTokens": 2000000,
    "outputTokens": 500000
  },
  "used": {
    "emails": 12,
    "inputTokens": 45000,
    "outputTokens": 8200
  },
  "recent": [
    {
      "createdAt": "2026-06-17T14:32:00Z",
      "subject": "Re: Project update",
      "senderEmail": "alice@example.com",
      "decision": "reply",
      "draft": "Hi Alice,\n\nThanks for the update — looks great. I'll review by Friday.\n\nBest,\nJohn",
      "inputTokens": 855,
      "outputTokens": 29
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `period` | `string` | Current UTC month (`YYYY-MM`) |
| `quota.emails` | `number` | Max emails per month |
| `quota.inputTokens` | `number` | Max input tokens per month |
| `quota.outputTokens` | `number` | Max output tokens per month |
| `used.emails` | `number` | Emails processed this period |
| `used.inputTokens` | `number` | Input tokens consumed |
| `used.outputTokens` | `number` | Output tokens consumed |
| `recent` | `array` | Last 20 reply logs, newest first. Each item includes `createdAt`, `subject`, `senderEmail`, `decision`, `draft` (the AI-generated reply text), `inputTokens`, `outputTokens` |

### Error Responses

| Status | Cause |
|--------|-------|
| `401` | Missing or invalid `Authorization` header |
| `405` | Method other than `GET`, `POST`, or `OPTIONS` |
| `500` | Database read failure |

---

## How Usage Is Recorded

`usage-get` only **reads** data. Counters are incremented by the **`draft-gmail-reply`** edge function each time it processes an email. There is no separate "send usage payload" step — the extension calls `draft-gmail-reply` with thread data, and the backend increments counters atomically.

---

## Notes

- Response includes `Cache-Control: no-store`.
- `recent` items are drawn from `reply_logs` filtered to the current period.
- Missing counters are returned as `0` (no error).
- `recent[].draft` may be `null` for log entries created before drafts were persisted (anything before 2026-06-17).

---

## Displaying Drafts in the Web App

Each `recent[]` item now carries the full AI-generated reply text under `draft`. Render it as a collapsible/expandable panel below the subject line. Preserve newlines (`white-space: pre-wrap`).

### React example

```tsx
type RecentReply = {
  createdAt: string;
  subject: string | null;
  senderEmail: string | null;
  decision: "reply" | "skip" | string;
  draft: string | null;
  inputTokens: number;
  outputTokens: number;
};

function RecentReplyCard({ item }: { item: RecentReply }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="rounded-lg border p-4">
      <header className="flex items-baseline justify-between">
        <h3 className="font-medium">{item.subject ?? "(no subject)"}</h3>
        <time className="text-xs text-muted-foreground">
          {new Date(item.createdAt).toLocaleString()}
        </time>
      </header>
      <p className="text-sm text-muted-foreground">
        {item.senderEmail} · {item.inputTokens} in / {item.outputTokens} out
      </p>

      {item.draft ? (
        <>
          <button
            onClick={() => setOpen(o => !o)}
            className="mt-2 text-sm underline"
          >
            {open ? "Hide draft" : "Show draft"}
          </button>
          {open && (
            <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-3 text-sm">
              {item.draft}
            </pre>
          )}
          <button
            onClick={() => navigator.clipboard.writeText(item.draft!)}
            className="ml-3 text-sm underline"
          >
            Copy
          </button>
        </>
      ) : (
        <p className="mt-2 text-xs italic text-muted-foreground">
          Draft not stored for this entry.
        </p>
      )}
    </article>
  );
}
```

### Field reference for `recent[]`

| Field | Type | Notes |
|-------|------|-------|
| `createdAt` | ISO string | Server-side timestamp |
| `subject` | string \| null | Truncated to 300 chars |
| `senderEmail` | string \| null | Truncated to 320 chars |
| `decision` | string | Usually `"reply"` |
| `draft` | string \| null | Full AI-generated reply. Preserve newlines. May be null for legacy rows. |
| `inputTokens` | number | Anthropic input token count |
| `outputTokens` | number | Anthropic output token count |

### Privacy reminder

Drafts are sensitive user content. The web app should:
- Only render them inside the authenticated dashboard (never on public pages).
- Avoid sending them to third-party analytics or error trackers.
- Respect the `Cache-Control: no-store` header — do not cache responses client-side beyond the active session.

