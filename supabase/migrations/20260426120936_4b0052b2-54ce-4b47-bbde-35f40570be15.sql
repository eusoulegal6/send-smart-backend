CREATE TABLE public.pageviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  app_key text NOT NULL,
  path text NOT NULL,
  referrer text,
  user_agent text,
  visitor_id text NOT NULL,
  session_id text NOT NULL,
  user_id uuid,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pageviews_app_created ON public.pageviews (app_key, created_at DESC);
CREATE INDEX idx_pageviews_visitor ON public.pageviews (app_key, visitor_id, created_at DESC);
CREATE INDEX idx_pageviews_session ON public.pageviews (app_key, session_id, created_at DESC);

ALTER TABLE public.pageviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read aggregate-style data only via the dashboard (signed-in users).
CREATE POLICY "Authenticated users can read pageviews"
ON public.pageviews
FOR SELECT
TO authenticated
USING (true);

-- Inserts happen only via the edge function using the service role; block direct client inserts.
-- (No INSERT policy → RLS denies direct inserts from clients.)