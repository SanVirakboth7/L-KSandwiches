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

-- 3. Seed data (your current 69 menu items) ---------------------------
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

-- 4. Storage bucket for admin-uploaded photos --------------------------
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
