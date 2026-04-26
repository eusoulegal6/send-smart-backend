-- Per-app membership
CREATE TABLE public.account_apps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  app_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, app_key)
);

CREATE INDEX idx_account_apps_user ON public.account_apps (user_id);
CREATE INDEX idx_account_apps_app ON public.account_apps (app_key);

ALTER TABLE public.account_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own app memberships"
ON public.account_apps
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies → only service role (edge functions) can write.

-- Helper for edge functions
CREATE OR REPLACE FUNCTION public.user_has_app(_user_id uuid, _app_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_apps
    WHERE user_id = _user_id AND app_key = _app_key
  )
$$;

-- Hub admins (can see across all apps in the dashboard)
CREATE TABLE public.app_admins (
  user_id uuid NOT NULL PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can see the admins table"
ON public.app_admins
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.is_app_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = _user_id)
$$;

-- Let admins read pageviews/account_apps across all apps
DROP POLICY IF EXISTS "Authenticated users can read pageviews" ON public.pageviews;
CREATE POLICY "Admins can read all pageviews"
ON public.pageviews
FOR SELECT
TO authenticated
USING (public.is_app_admin(auth.uid()));

CREATE POLICY "Admins can read all app memberships"
ON public.account_apps
FOR SELECT
TO authenticated
USING (public.is_app_admin(auth.uid()));

-- Backfill: every existing auth user becomes a Send Smart member.
INSERT INTO public.account_apps (user_id, app_key)
SELECT id, 'send-smart' FROM auth.users
ON CONFLICT (user_id, app_key) DO NOTHING;