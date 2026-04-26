import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const ALLOWED_APPS = new Set(["send-smart", "whatsreply", "apps-backend"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: { action?: string; app_key?: string; user_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { action, app_key, user_id } = body;
  if (!action || !app_key || !user_id) {
    return jsonResponse({ error: "Missing action, app_key, or user_id" }, 400);
  }
  if (!ALLOWED_APPS.has(app_key)) {
    return jsonResponse({ error: "Invalid app_key" }, 400);
  }

  // Verify the caller is actually that user.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await userClient.auth.getUser(token);
  if (!userData?.user?.id || userData.user.id !== user_id) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (action === "register") {
    const { error } = await admin
      .from("account_apps")
      .insert({ user_id, app_key })
      .select()
      .maybeSingle();
    // Ignore unique-violation: already a member.
    if (error && !String(error.message).toLowerCase().includes("duplicate")) {
      console.error("register error:", error.message);
      return jsonResponse({ error: "Failed to register app account" }, 500);
    }
    return jsonResponse({ ok: true, registered: true });
  }

  if (action === "check") {
    const { data, error } = await admin
      .from("account_apps")
      .select("id")
      .eq("user_id", user_id)
      .eq("app_key", app_key)
      .maybeSingle();
    if (error) {
      console.error("check error:", error.message);
      return jsonResponse({ error: "Failed to check membership" }, 500);
    }
    return jsonResponse({ ok: true, member: !!data });
  }

  return jsonResponse({ error: "Unknown action" }, 400);
});
