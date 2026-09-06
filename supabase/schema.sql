-- ============================================================
-- L&K Sandwich — Supabase database setup
-- Run this whole file once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- ============================================================

-- 1. Products table -------------------------------------------------
create table if not exists products (
  id            text primary key,             -- e.g. LK-S01
  category      text not null,                -- sandwich | rice | dessert | drink
  name          text not null default 'N/A',
  description   text not null default '',
  badge         text,                         -- e.g. Bestseller, Signature (nullable)
  image_url     text not null default '',     -- public URL or relative path to image
  is_bestseller boolean not null default false,
  sort_order    integer not null default 0,
  phone         text not null default '012 345 678',
  updated_at    timestamptz not null default now()
);

-- keep updated_at fresh on every edit
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
before update on products
for each row execute function set_updated_at();

-- 2. Row Level Security ----------------------------------------------
alter table products enable row level security;

-- Anyone (your public website) can READ products
drop policy if exists "Public can read products" on products;
create policy "Public can read products"
  on products for select
  using (true);

-- Only logged-in admins can INSERT / UPDATE / DELETE
drop policy if exists "Admins can modify products" on products;
create policy "Admins can modify products"
  on products for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- 3. Admin allowlist + order records ---------------------------------
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "Users can read their admin status" on public.admin_users;
create policy "Users can read their admin status"
  on public.admin_users for select
  to authenticated
  using (user_id = (select auth.uid()));

-- This project has one owner account. On first setup, allowlist the
-- earliest Auth user without hard-coding a generated user ID.
insert into public.admin_users (user_id)
select id from auth.users order by created_at asc limit 1
on conflict (user_id) do nothing;

revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;

-- One Web Push subscription per browser/device. Each allowlisted admin can
-- manage only subscriptions that belong to their own authenticated account.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique check (char_length(endpoint) between 20 and 2048),
  p256dh      text not null check (char_length(p256dh) between 20 and 200),
  auth        text not null check (char_length(auth) between 8 and 100),
  user_agent  text not null default '' check (char_length(user_agent) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_push_subscriptions_updated_at on public.push_subscriptions;
create trigger trg_push_subscriptions_updated_at
before update on public.push_subscriptions
for each row execute function set_updated_at();

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Allowlisted admins can read own push subscriptions" on public.push_subscriptions;
create policy "Allowlisted admins can read own push subscriptions"
  on public.push_subscriptions for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.admin_users
      where admin_users.user_id = (select auth.uid())
    )
  );

drop policy if exists "Allowlisted admins can insert own push subscriptions" on public.push_subscriptions;
create policy "Allowlisted admins can insert own push subscriptions"
  on public.push_subscriptions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.admin_users
      where admin_users.user_id = (select auth.uid())
    )
  );

drop policy if exists "Allowlisted admins can update own push subscriptions" on public.push_subscriptions;
create policy "Allowlisted admins can update own push subscriptions"
  on public.push_subscriptions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.admin_users
      where admin_users.user_id = (select auth.uid())
    )
  );

drop policy if exists "Allowlisted admins can delete own push subscriptions" on public.push_subscriptions;
create policy "Allowlisted admins can delete own push subscriptions"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Public site settings are readable by customers and editable only by an
-- allowlisted admin. They hold non-secret controls such as order availability.
create table if not exists public.site_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.site_settings
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_site_settings_updated_at on public.site_settings;
create trigger trg_site_settings_updated_at
before update on public.site_settings
for each row execute function set_updated_at();

alter table public.site_settings enable row level security;

drop policy if exists "Public can read site settings" on public.site_settings;
create policy "Public can read site settings"
  on public.site_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "Allowlisted admins can insert site settings" on public.site_settings;
create policy "Allowlisted admins can insert site settings"
  on public.site_settings for insert
  to authenticated
  with check (
    exists (
      select 1 from public.admin_users
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "Allowlisted admins can update site settings" on public.site_settings;
create policy "Allowlisted admins can update site settings"
  on public.site_settings for update
  to authenticated
  using (
    exists (
      select 1 from public.admin_users
      where user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.admin_users
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "Allowlisted admins can delete site settings" on public.site_settings;
create policy "Allowlisted admins can delete site settings"
  on public.site_settings for delete
  to authenticated
  using (
    exists (
      select 1 from public.admin_users
      where user_id = (select auth.uid())
    )
  );

revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

insert into public.site_settings (key, value)
values ('accepting_orders', 'true')
on conflict (key) do nothing;

create table if not exists public.orders (
  id                     uuid primary key default gen_random_uuid(),
  order_number           bigint generated by default as identity (start with 1) unique,
  client_order_id        uuid not null unique,
  customer_name          text not null check (char_length(customer_name) between 1 and 100),
  customer_phone         text not null check (char_length(customer_phone) between 3 and 30),
  delivery_address       text not null default '' check (char_length(delivery_address) <= 500),
  delivery_location_url  text not null default '',
  order_type             text not null check (order_type in ('delivery', 'pickup')),
  payment_method         text not null check (payment_method in ('aba', 'cash')),
  payment_status         text not null check (payment_status in ('paid', 'cash_due')),
  payment_transaction_id text unique,
  scheduled_date         date not null,
  scheduled_time         text not null default '' check (char_length(scheduled_time) <= 40),
  customer_notes         text not null default '',
  items                  jsonb not null check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 20
  ),
  item_count             integer not null check (item_count between 1 and 400),
  total                  numeric(10,2) not null check (total >= 0 and total <= 10000),
  currency               text not null default 'USD' check (currency = 'USD'),
  status                 text not null default 'new' check (
    status in ('new', 'preparing', 'ready', 'completed', 'cancelled')
  ),
  telegram_sent          boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (
    (payment_method = 'aba' and payment_status = 'paid' and payment_transaction_id is not null)
    or
    (payment_method = 'cash' and payment_status = 'cash_due' and payment_transaction_id is null)
  )
);

alter table public.orders
  add column if not exists customer_notes text not null default '';

alter table public.orders
  add column if not exists delivery_location_url text not null default '';

alter table public.orders drop constraint if exists orders_check;
alter table public.orders drop constraint if exists orders_delivery_destination_check;
alter table public.orders
  add constraint orders_delivery_destination_check
  check (
    order_type = 'pickup'
    or char_length(delivery_address) > 0
    or char_length(delivery_location_url) > 0
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_delivery_location_url_length'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_location_url_length
      check (char_length(delivery_location_url) <= 500);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_customer_notes_length'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_customer_notes_length
      check (char_length(customer_notes) <= 500);
  end if;
end $$;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function set_updated_at();

create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_orders_status_created_at on public.orders (status, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'site_settings'
  ) then
    alter publication supabase_realtime add table public.site_settings;
  end if;
end $$;

alter table public.orders enable row level security;

drop policy if exists "Customers can submit order records" on public.orders;
create policy "Customers can submit order records"
  on public.orders for insert
  to anon, authenticated
  with check (
    status = 'new'
    and created_at between (now() - interval '5 minutes') and (now() + interval '1 minute')
    and coalesce((
      select lower(value) = 'true'
      from public.site_settings
      where key = 'accepting_orders'
    ), true)
  );

drop policy if exists "Allowlisted admins can read orders" on public.orders;
create policy "Allowlisted admins can read orders"
  on public.orders for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_users
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "Allowlisted admins can update order status" on public.orders;
create policy "Allowlisted admins can update order status"
  on public.orders for update
  to authenticated
  using (
    exists (
      select 1 from public.admin_users
      where user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.admin_users
      where user_id = (select auth.uid())
    )
  );

revoke all on public.orders from anon, authenticated;
grant insert on public.orders to anon, authenticated;
grant select on public.orders to authenticated;
grant update (status) on public.orders to authenticated;
grant usage, select on sequence public.orders_order_number_seq to anon, authenticated;

-- 4. Seed data (your current 69 menu items) ---------------------------
insert into products
  (id, category, name, description, badge, image_url, is_bestseller, sort_order, phone)
values
  ('LK-S01', 'sandwich', 'N/A', 'N/A', 'Signature', 'menu/sandwiches/LK-S01.jpg', true, 1, '012 345 678'),
  ('LK-S02', 'sandwich', 'N/A', 'N/A', 'Bestseller', 'menu/sandwiches/LK-S02.jpg', true, 2, '012 345 678'),
  ('LK-S03', 'sandwich', 'N/A', 'N/A', 'Bestseller', 'menu/sandwiches/LK-S03.jpg', true, 3, '012 345 678'),
  ('LK-S04', 'sandwich', 'N/A', 'N/A', 'Bestseller', 'menu/sandwiches/LK-S04.jpg', true, 4, '012 345 678'),
  ('LK-S05', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S05.jpg', false, 5, '012 345 678'),
  ('LK-S06', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S06.jpg', false, 6, '012 345 678'),
  ('LK-S07', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S07.jpg', false, 7, '012 345 678'),
  ('LK-S08', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S08.jpg', false, 8, '012 345 678'),
  ('LK-S09', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S09.jpg', false, 9, '012 345 678'),
  ('LK-S10', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S10.jpg', false, 10, '012 345 678'),
  ('LK-S11', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S11.jpg', false, 11, '012 345 678'),
  ('LK-S12', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S12.jpg', false, 12, '012 345 678'),
  ('LK-S13', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S13.jpg', false, 13, '012 345 678'),
  ('LK-S14', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S14.jpg', false, 14, '012 345 678'),
  ('LK-S15', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S15.jpg', false, 15, '012 345 678'),
  ('LK-S16', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S16.jpg', false, 16, '012 345 678'),
  ('LK-S17', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S17.jpg', false, 17, '012 345 678'),
  ('LK-S18', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S18.jpg', false, 18, '012 345 678'),
  ('LK-S19', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S19.jpg', false, 19, '012 345 678'),
  ('LK-S20', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S20.jpg', false, 20, '012 345 678'),
  ('LK-S21', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S21.jpg', false, 21, '012 345 678'),
  ('LK-S22', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S22.jpg', false, 22, '012 345 678'),
  ('LK-S23', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S23.jpg', false, 23, '012 345 678'),
  ('LK-S24', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S24.jpg', false, 24, '012 345 678'),
  ('LK-S25', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S25.jpg', false, 25, '012 345 678'),
  ('LK-S26', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S26.jpg', false, 26, '012 345 678'),
  ('LK-S27', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S27.jpg', false, 27, '012 345 678'),
  ('LK-S28', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S28.jpg', false, 28, '012 345 678'),
  ('LK-S29', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S29.jpg', false, 29, '012 345 678'),
  ('LK-S30', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S30.jpg', false, 30, '012 345 678'),
  ('LK-S31', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S31.jpg', false, 31, '012 345 678'),
  ('LK-S32', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S32.jpg', false, 32, '012 345 678'),
  ('LK-S33', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S33.jpg', false, 33, '012 345 678'),
  ('LK-S34', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S34.jpg', false, 34, '012 345 678'),
  ('LK-S35', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S35.jpg', false, 35, '012 345 678'),
  ('LK-S36', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S36.jpg', false, 36, '012 345 678'),
  ('LK-S37', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S37.jpg', false, 37, '012 345 678'),
  ('LK-S38', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S38.jpg', false, 38, '012 345 678'),
  ('LK-S39', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S39.jpg', false, 39, '012 345 678'),
  ('LK-S40', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S40.jpg', false, 40, '012 345 678'),
  ('LK-S41', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S41.jpg', false, 41, '012 345 678'),
  ('LK-S42', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S42.jpg', false, 42, '012 345 678'),
  ('LK-S43', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S43.jpg', false, 43, '012 345 678'),
  ('LK-S44', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S44.jpg', false, 44, '012 345 678'),
  ('LK-S45', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S45.jpg', false, 45, '012 345 678'),
  ('LK-S46', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S46.jpg', false, 46, '012 345 678'),
  ('LK-S47', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S47.jpg', false, 47, '012 345 678'),
  ('LK-S48', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S48.jpg', false, 48, '012 345 678'),
  ('LK-S49', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S49.jpg', false, 49, '012 345 678'),
  ('LK-S50', 'sandwich', 'N/A', 'N/A', NULL, 'menu/sandwiches/LK-S50.jpg', false, 50, '012 345 678'),
  ('LK-R01', 'rice', 'បាយឆាម្រេះព្រៅ', 'N/A', 'Bestseller', 'menu/rice&noodle/LK-R01.jpg', true, 1, '012 345 678'),
  ('LK-R02', 'rice', 'បាយឡុកឡាក់', 'N/A', 'Noodle', 'menu/rice&noodle/LK-R02.jpg', false, 2, '012 345 678'),
  ('LK-R03', 'rice', 'បាយឆាបង្ការ', 'N/A', 'Bestseller', 'menu/rice&noodle/LK-R03.jpg', true, 3, '012 345 678'),
  ('LK-R04', 'rice', 'បាយឆាសាច់គោ', 'N/A', 'Noodle', 'menu/rice&noodle/LK-R04.jpg', false, 4, '012 345 678'),
  ('LK-R05', 'rice', 'បាយឆាយ៉ាងជូវ', 'N/A', 'Bestseller', 'menu/rice&noodle/LK-R05.jpg', true, 5, '012 345 678'),
  ('LK-R06', 'rice', 'បាយពងទាត្រីប្រម៉ា', 'N/A', 'Noodle', 'menu/rice&noodle/LK-R06.jpg', false, 6, '012 345 678'),
  ('LK-R07', 'rice', 'បាយឆាជើងផ្សិត', 'N/A', 'Bestseller', 'menu/rice&noodle/LK-R07.jpg', true, 7, '012 345 678'),
  ('LK-R08', 'rice', 'បាយ ផ្អកចៀន', 'N/A', 'Noodle', 'menu/rice&noodle/LK-R08.jpg', false, 8, '012 345 678'),
  ('LK-D01', 'dessert', 'N/A', 'N/A', 'Bestseller', 'menu/desserts/LK-D01.jpg', true, 1, '012 345 678'),
  ('LK-D02', 'dessert', 'N/A', 'N/A', 'Dessert', 'menu/desserts/LK-D02.jpg', false, 2, '012 345 678'),
  ('LK-D03', 'dessert', 'N/A', 'N/A', 'Bestseller', 'menu/desserts/LK-D03.jpg', true, 3, '012 345 678'),
  ('LK-D04', 'dessert', 'N/A', 'N/A', 'Dessert', 'menu/desserts/LK-D04.jpg', false, 4, '012 345 678'),
  ('LK-D05', 'dessert', 'N/A', 'N/A', 'Bestseller', 'menu/desserts/LK-D05.jpg', true, 5, '012 345 678'),
  ('LK-D06', 'dessert', 'N/A', 'N/A', 'Dessert', 'menu/desserts/LK-D06.jpg', false, 6, '012 345 678'),
  ('LK-D07', 'dessert', 'N/A', 'N/A', 'Bestseller', 'menu/desserts/LK-D07.jpg', true, 7, '012 345 678'),
  ('LK-DR01', 'drink', 'N/A', 'N/A', 'Bestseller', 'img/drinks/LK-DR01.jpg', true, 1, '012 345 678'),
  ('LK-DR02', 'drink', 'N/A', 'N/A', 'Drink', 'img/drinks/LK-DR02.jpg', false, 2, '012 345 678'),
  ('LK-DR03', 'drink', 'N/A', 'N/A', 'Drink', 'img/drinks/LK-DR03.jpg', false, 3, '012 345 678'),
  ('LK-DR04', 'drink', 'N/A', 'N/A', 'Drink', 'img/drinks/LK-DR04.jpg', false, 4, '012 345 678')
on conflict (id) do nothing;

-- 5. Storage bucket for admin-uploaded photos --------------------------
-- Run this too (or create it manually: Dashboard → Storage → New bucket
-- named product-images, toggle "Public bucket" ON).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Allow public read of images in that bucket
drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- Allow only logged-in admins to upload/replace/delete images
drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and auth.role() = 'authenticated');

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
  on storage.objects for update
  using (bucket_id = 'product-images' and auth.role() = 'authenticated');

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
  on storage.objects for delete
  using (bucket_id = 'product-images' and auth.role() = 'authenticated');

-- Done! Next: Authentication → Users → Add user, to create your admin login.
