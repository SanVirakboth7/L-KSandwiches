# New order push notifications

The website code is ready for Web Push. These one-time Supabase steps connect
new `orders` rows to the admin devices that have enabled notifications.

For the current `lksandwiches` project, the subscription table, encrypted
secrets, `send-order-push` Edge Function, and `orders` INSERT trigger are all
deployed. The steps below are retained for rebuilding or setting up another
project.

## 1. Add the subscription table

Open **Supabase → SQL Editor**, paste the current `supabase/schema.sql`, and run
it. The file is safe to run again: existing products use `on conflict do
nothing`. This creates `push_subscriptions` with Row Level Security so an admin
can manage only their own devices.

## 2. Deploy the Edge Function

Install and sign in to the Supabase CLI, then first inspect the available
commands for the installed version:

```powershell
supabase --help
supabase functions --help
supabase secrets --help
```

From this folder, link the existing project, upload the ignored local secrets,
and deploy the function:

```powershell
supabase link --project-ref chaxkujdkybcgekryudr
supabase secrets set --env-file .push-secrets.local
supabase functions deploy send-order-push --no-verify-jwt
```

`.push-secrets.local` contains the VAPID private key and webhook secret. It is
excluded from both Git and the Cloudflare static asset upload. Never paste its
private values into `public/assets/js/admin-dashboard.js`,
`public/assets/js/supabase-client.js`, or any public file.

## 3. Add the secure database trigger

The production project uses a Vault-backed Postgres trigger instead of storing
the webhook secret directly in a visible trigger definition.

1. In **Supabase → Integrations → Vault**, create a secret named
   `order_push_webhook_secret` with the `PUSH_WEBHOOK_SECRET` value from
   `.push-secrets.local`.
2. Apply
   `supabase/migrations/20260902183843_create_new_order_push_webhook.sql`.

The migration enables `pg_net` and creates `send_new_order_push`, an `AFTER
INSERT` trigger on `public.orders`. It reads the encrypted value from Vault and
adds it as the `x-webhook-secret` header. The Edge Function independently
checks this secret before reading subscriptions or sending notifications.

Because this is a custom Vault-backed trigger, Supabase Studio may not show it
in the Database Webhooks list. Verify it under the table's triggers or with
`pg_trigger`; request history is recorded in `net._http_response`.

## 4. Deploy and enable on iPhone

Deploy the updated site so `public/assets/manifest/admin-app.webmanifest` and
`public/admin-service-worker.js` are available over HTTPS. On the admin iPhone:

1. Open `https://lnksandwiches.emenu.workers.dev/admin.html` in Safari.
2. Tap **Share → Add to Home Screen**, turn on **Open as Web App**, then Add.
3. Open **L&K Admin** from the Home Screen and sign in.
4. Go to **Settings → Order Alerts → Enable**, then tap **Allow**.

Create a test order from the customer menu, close/lock the iPhone, and confirm
that the notification appears. Edge Function requests are visible in the
function logs, and database HTTP responses are available in
`net._http_response`.
