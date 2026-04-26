import { supabase } from "@/integrations/supabase/client";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/account-app`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function call(action: "register" | "check", app_key: string, user_id: string, token: string) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, app_key, user_id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as { ok: boolean; member?: boolean; registered?: boolean };
}

export async function registerForApp(app_key: string) {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("Not signed in");
  await call("register", app_key, session.user.id, session.access_token);
}

export async function isMemberOfApp(app_key: string): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return false;
  const res = await call("check", app_key, session.user.id, session.access_token);
  return !!res.member;
}
