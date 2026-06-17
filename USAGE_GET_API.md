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
