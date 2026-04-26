import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const ALLOWED_APPS = new Set(["send-smart", "whatsreply"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clamp(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const app_key = clamp(body.app_key, 64);
  const path = clamp(body.path, 512);
  const visitor_id = clamp(body.visitor_id, 64);
  const session_id = clamp(body.session_id, 64);
  const referrer = clamp(body.referrer, 512);
  const user_agent = clamp(req.headers.get("user-agent"), 512);
  const country =
    clamp(req.headers.get("x-country"), 8) ??
    clamp(req.headers.get("cf-ipcountry"), 8);

  if (!app_key || !ALLOWED_APPS.has(app_key)) {
    return jsonResponse({ error: "Invalid app_key" }, 400);
  }
  if (!path || !visitor_id || !session_id) {
    return jsonResponse({ error: "Missing required fields" }, 400);
  }

  // Optional: associate with logged-in user if a bearer token is present.
  let user_id: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data } = await userClient.auth.getUser(token);
      if (data?.user?.id) user_id = data.user.id;
    } catch {
      // ignore — anonymous tracking still allowed
    }
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await admin.from("pageviews").insert({
    app_key,
    path,
    referrer,
    user_agent,
    visitor_id,
    session_id,
    user_id,
    country,
  });

  if (error) {
    console.error("track-pageview insert error:", error.message);
    return jsonResponse({ error: "Failed to record pageview" }, 500);
  }

  return jsonResponse({ ok: true });
});
