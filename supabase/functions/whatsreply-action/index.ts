import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { jwtVerify, createRemoteJWKSet } from "https://esm.sh/jose@5.9.6";

// TODO: extract bridged-auth helpers to _shared/auth.ts (shared with
// review-list, review-resolve, usage-get).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const APP_KEY = "whatsreply";

// Per-product quotas for WhatsReply. Mirror Send Smart's monthly shape.
const QUOTA = {
  emails: 500,
  inputTokens: 2_000_000,
  outputTokens: 500_000,
};

const PARTNER_PROJECTS: Array<{ ref: string; url: string }> = [
  { ref: "uxhtrpwgfqknxqzhssoe", url: "https://uxhtrpwgfqknxqzhssoe.supabase.co" },
];

const partnerJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getPartnerJwks(url: string) {
  let jwks = partnerJwks.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
    partnerJwks.set(url, jwks);
  }
  return jwks;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// deno-lint-ignore no-explicit-any
type AdminClient = any;

async function tryPartnerVerify(token: string): Promise<
  { partnerRef: string; sub: string } | null
> {
  for (const partner of PARTNER_PROJECTS) {
    try {
      const { payload } = await jwtVerify(token, getPartnerJwks(partner.url), {
        issuer: `${partner.url}/auth/v1`,
      });
      const sub = typeof payload.sub === "string" ? payload.sub : null;
      if (!sub) continue;
      return { partnerRef: partner.ref, sub };
    } catch (_) {
      // try next
    }
  }
  return null;
}

async function resolvePartnerUserId(
  admin: AdminClient,
  partnerRef: string,
  sub: string,
): Promise<string | null> {
  const bridgeEmail = `partner+${partnerRef}+${sub}@bridge.sendsmart.local`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: bridgeEmail,
    email_confirm: true,
    user_metadata: { partner_ref: partnerRef, partner_sub: sub, bridge: true },
  });
  if (created?.user?.id) return created.user.id;

  const msg = String(createErr?.message ?? "").toLowerCase();
  if (createErr && !msg.includes("already") && !msg.includes("registered") && !msg.includes("exists")) {
    console.error("whatsreply-action partner createUser error:", createErr.message);
    return null;
  }

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    console.error("whatsreply-action partner listUsers error:", listErr.message);
    return null;
  }
  const found = list?.users?.find((u: { email?: string | null }) => u.email === bridgeEmail);
  return found?.id ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }
  const token = authHeader.replace("Bearer ", "");

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Local Apps Backend auth
  let userId: string | null = null;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser(token);
  if (userData?.user?.id) {
    userId = userData.user.id;
  }

  // 2) Trusted partner JWT bridge
  if (!userId) {
    const partner = await tryPartnerVerify(token);
    if (partner) {
      userId = await resolvePartnerUserId(admin, partner.partnerRef, partner.sub);
      if (!userId) {
        return jsonResponse({ error: "Failed to resolve partner user." }, 500);
      }
    }
  }

  if (!userId) {
    return jsonResponse({ error: "Invalid session." }, 401);
  }

  // Look up app_settings for this user + product. Missing row => empty settings.
  const { data: settingsRow, error: settingsErr } = await admin
    .from("app_settings")
    .select("settings")
    .eq("user_id", userId)
    .eq("app_key", APP_KEY)
    .maybeSingle();

  if (settingsErr) {
    console.error("whatsreply-action settings error:", settingsErr.message);
    return jsonResponse({ error: "Failed to read settings." }, 500);
  }
  const _settings = (settingsRow?.settings ?? {}) as Record<string, unknown>;

  // Quota check: WhatsReply usage_counters row scoped by app_key.
  const period = currentPeriod();
  const { data: counterRow, error: counterErr } = await admin
    .from("usage_counters")
    .select("id,emails_used,input_tokens_used,output_tokens_used")
    .eq("user_id", userId)
    .eq("app_key", APP_KEY)
    .eq("period", period)
    .maybeSingle();

  if (counterErr) {
    console.error("whatsreply-action counter read error:", counterErr.message);
    return jsonResponse({ error: "Failed to read usage." }, 500);
  }

  const used = counterRow ?? {
    id: null,
    emails_used: 0,
    input_tokens_used: 0,
    output_tokens_used: 0,
  };

  if (
    Number(used.emails_used ?? 0) >= QUOTA.emails ||
    Number(used.input_tokens_used ?? 0) >= QUOTA.inputTokens ||
    Number(used.output_tokens_used ?? 0) >= QUOTA.outputTokens
  ) {
    return jsonResponse({ error: "quota_exceeded" }, 429);
  }

  // Increment emails_used by 1 (no token usage on this echo endpoint yet).
  if (counterRow?.id) {
    const { error: updErr } = await admin
      .from("usage_counters")
      .update({
        emails_used: Number(used.emails_used ?? 0) + 1,
      })
      .eq("id", counterRow.id);
    if (updErr) {
      console.error("whatsreply-action counter update error:", updErr.message);
    }
  } else {
    const { error: insErr } = await admin
      .from("usage_counters")
      .insert({
        user_id: userId,
        app_key: APP_KEY,
        period,
        emails_used: 1,
        input_tokens_used: 0,
        output_tokens_used: 0,
      });
    if (insErr) {
      console.error("whatsreply-action counter insert error:", insErr.message);
    }
  }

  return jsonResponse({ ok: true, echo: body });
});
