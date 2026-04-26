import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  app_key: string;
  path: string;
  referrer: string | null;
  visitor_id: string;
  session_id: string;
  created_at: string;
};

type Stats = {
  views: number;
  visitors: number;
  sessions: number;
  topPaths: { path: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  perDay: { day: string; count: number }[];
};

const APPS = [
  { key: "send-smart", label: "Send Smart" },
  { key: "whatsreply", label: "WhatsReply" },
  { key: "apps-backend", label: "Apps Backend (this site)" },
];

function summarize(rows: Row[]): Stats {
  const visitors = new Set<string>();
  const sessions = new Set<string>();
  const pathCounts = new Map<string, number>();
  const refCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();

  for (const r of rows) {
    visitors.add(r.visitor_id);
    sessions.add(r.session_id);
    pathCounts.set(r.path, (pathCounts.get(r.path) ?? 0) + 1);
    const ref = r.referrer && r.referrer.trim() ? new URL(r.referrer, "https://x").hostname : "(direct)";
    refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
    const day = r.created_at.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const sortDesc = <T,>(m: Map<T, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]);

  return {
    views: rows.length,
    visitors: visitors.size,
    sessions: sessions.size,
    topPaths: sortDesc(pathCounts).slice(0, 5).map(([path, count]) => ({ path, count })),
    topReferrers: sortDesc(refCounts).slice(0, 5).map(([referrer, count]) => ({ referrer, count })),
    perDay: [...dayCounts.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, count]) => ({ day, count })),
  };
}

export default function TrafficAnalytics() {
  const [appKey, setAppKey] = useState("send-smart");
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("pageviews")
        .select("app_key,path,referrer,visitor_id,session_id,created_at")
        .eq("app_key", appKey)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (cancelled) return;
      if (error) {
        setError(error.message);
        setStats(null);
      } else {
        setStats(summarize((data ?? []) as Row[]));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [appKey, days]);

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-card-foreground">Traffic</h3>
        <div className="flex gap-2 text-sm">
          <select
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
          >
            {APPS.map((a) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
          >
            <option value={1}>Last 24h</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {stats && !loading && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Pageviews" value={stats.views} />
            <Stat label="Visitors" value={stats.visitors} />
            <Stat label="Sessions" value={stats.sessions} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <List title="Top pages" rows={stats.topPaths.map((r) => [r.path, r.count])} />
            <List title="Top referrers" rows={stats.topReferrers.map((r) => [r.referrer, r.count])} />
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">By day</p>
            <div className="flex items-end gap-1 h-24">
              {stats.perDay.length === 0 && (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              )}
              {stats.perDay.map(({ day, count }) => {
                const max = Math.max(...stats.perDay.map((d) => d.count), 1);
                const h = Math.max(4, Math.round((count / max) * 96));
                return (
                  <div key={day} className="flex flex-col items-center gap-1 flex-1">
                    <div className="w-full rounded-t bg-primary" style={{ height: h }} title={`${day}: ${count}`} />
                    <span className="text-[10px] text-muted-foreground">{day.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold text-foreground">{value.toLocaleString()}</p>
    </div>
  );
}

function List({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-3">
              <span className="text-foreground truncate">{k}</span>
              <span className="text-muted-foreground tabular-nums">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
