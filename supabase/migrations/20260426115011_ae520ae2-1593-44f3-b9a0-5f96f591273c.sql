-- Per-product settings table
create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  app_key text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, app_key)
);

alter table public.app_settings enable row level security;

create policy "Users can view their own app_settings"
  on public.app_settings for select using (auth.uid() = user_id);
create policy "Users can insert their own app_settings"
  on public.app_settings for insert with check (auth.uid() = user_id);
create policy "Users can update their own app_settings"
  on public.app_settings for update using (auth.uid() = user_id);
create policy "Users can delete their own app_settings"
  on public.app_settings for delete using (auth.uid() = user_id);

create trigger update_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.update_updated_at_column();

-- Per-product usage counters
alter table public.usage_counters
  add column if not exists app_key text not null default 'send-smart';

alter table public.usage_counters
  drop constraint if exists usage_counters_user_id_period_key;

create unique index if not exists usage_counters_user_app_period_idx
  on public.usage_counters (user_id, app_key, period);