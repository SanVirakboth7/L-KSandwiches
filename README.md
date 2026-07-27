# L&K Sandwich — Admin Panel Setup

Your site now pulls its menu from a live database instead of hardcoded data,
so an admin can edit names, descriptions, and photos from a password-protected
page (`admin.html`) and see the changes go live instantly on `index.html`.

This uses **Supabase** — a free hosted database + file storage + login system
that works directly from static HTML/JS (no server needed, so GitHub
Pages/Netlify still works fine).

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign up (free).
2. Click **New project**. Pick any name/region, set a database password (save it somewhere), click **Create new project**. Wait ~1 minute for it to spin up.

## 2. Set up the database

1. In your project, open the **SQL Editor** (left sidebar).
2. Click **New query**, then open `supabase-schema.sql` (in this folder), copy its entire contents, paste into the editor.
3. Click **Run**. This creates:
   - a `products` table with all 69 of your current menu items pre-loaded
   - security rules so anyone can *view* products, but only a logged-in admin can *edit* them
   - a `product-images` storage bucket for photo uploads

## 3. Create your admin login

1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter the email and password you (the admin) want to log in with. Confirm the email if prompted (or toggle "Auto confirm user" if available).
3. This is the login you'll use on `admin.html`.

## 4. Connect the site to your project

1. Left sidebar → **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `supabase-config.js` in this folder and paste them in:

   ```js
   export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```

That's the only file you need to edit. The anon key is meant to be public in
client-side code — it can't do anything the security rules in step 2 don't
allow.

## 5. Deploy

Upload/push the whole folder (including your existing `img/` and `menu/`
image folders) to GitHub Pages, Netlify, or wherever you host now. Two pages
now exist:

- `index.html` — your public menu (unchanged for visitors)
- `admin.html` — the admin login + editor (linked quietly at the bottom of the site footer; you can also just bookmark it directly)

## Using the admin panel

- Go to `admin.html`, sign in with the email/password from step 3.
- Search or filter by category to find a product.
- Edit name, description, badge, or phone — changes save automatically when you click away from the field (look for the small "Saved ✓").
- Click a product's photo to upload a replacement — it uploads to storage and updates instantly.
- Toggle "Show in Bestseller section" to feature/unfeature an item.
- **+ Add Product** creates a new item (give it a photo afterward by clicking its thumbnail).
- **Delete** permanently removes a product.

Anyone with the site open will see edits appear live within a second or two,
since the public page listens for database changes.

## Notes

- Your existing images in `menu/sandwiches/`, `menu/rice&noodle/`, `menu/desserts/`, and `img/drinks/` still work as-is — the database was seeded with those same file paths, so nothing breaks until you start replacing photos through the admin panel.
- If you ever want a second admin, just add another user in step 3 — no code changes needed.
- Everything runs on Supabase's free tier, which comfortably covers a small menu site (500MB database, 1GB file storage, 50k monthly active users).
