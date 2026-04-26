import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const VISITOR_KEY = "__lov_visitor_id";
const SESSION_KEY = "__lov_session_id";

function getOrCreate(storage: Storage, key: string): string {
  let v = storage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    storage.setItem(key, v);
  }
  return v;
}

export function usePageviewTracking(appKey: string) {
  const location = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    (async () => {
      try {
        const visitor_id = getOrCreate(localStorage, VISITOR_KEY);
        const session_id = getOrCreate(sessionStorage, SESSION_KEY);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (cancelled) return;

        await fetch(`${SUPABASE_URL}/functions/v1/track-pageview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            app_key: appKey,
            path: location.pathname + location.search,
            referrer: document.referrer || null,
            visitor_id,
            session_id,
          }),
          keepalive: true,
        });
      } catch {
        // Silently ignore — tracking must never break the app.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appKey, location.pathname, location.search]);
}
