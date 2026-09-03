# L&K Sandwiches website

This project contains the customer ordering site, admin dashboard, Supabase
database setup, and Cloudflare payment API.

## Start here

- `public/index.html` — customer menu and checkout page.
- `public/admin.html` — admin dashboard, menu editor, orders, and settings.
- `public/assets/css/` — page styling.
- `public/assets/js/` — browser JavaScript and public Supabase connection.
- `public/img/` — logos, navigation icons, payment images, and menu-image paths.
- `docs/` — one-time setup instructions.
- `supabase/` — database schema, migrations, and Edge Functions.
- `cloudflare-payments-worker.js` — server-only payment API code.

## Project map

```text
lnksandwiches/
├── public/                            Everything published to the website
│   ├── index.html                     Customer page
│   ├── admin.html                     Admin page
│   ├── admin-service-worker.js        Background admin notifications
│   ├── assets/
│   │   ├── css/
│   │   │   ├── customer-menu.css      Customer styling
│   │   │   └── admin-dashboard.css    Admin styling
│   │   ├── js/
│   │   │   ├── customer-menu.js       Customer behavior and checkout
│   │   │   ├── admin-dashboard.js     Admin behavior
│   │   │   └── supabase-client.js     Public Supabase connection values
│   │   └── manifest/
│   │       └── admin-app.webmanifest  Admin Home Screen app settings
│   └── img/                           Images and icons
├── cloudflare-payments-worker.js      Secure ABA PayWay API routes
├── supabase/
│   ├── schema.sql                     Main database schema
│   ├── migrations/                    Later database changes
│   └── functions/send-order-push/     New-order push sender
├── docs/
│   ├── payway-setup.md                ABA PayWay setup
│   └── push-notifications-setup.md     iPhone/Web Push setup
├── tools/                              Development-only helper scripts
├── wrangler.jsonc                      Cloudflare deployment configuration
└── package.json                        Development commands
```

## Where to make common changes

- Customer layout: `public/index.html`
- Customer colors and spacing: `public/assets/css/customer-menu.css`
- Customer checkout behavior: `public/assets/js/customer-menu.js`
- Admin layout: `public/admin.html`
- Admin colors and spacing: `public/assets/css/admin-dashboard.css`
- Admin behavior: `public/assets/js/admin-dashboard.js`
- Database tables and policies: `supabase/schema.sql`
- New-order notifications: `supabase/functions/send-order-push/index.ts`
- Payment server: `cloudflare-payments-worker.js`

Product names, prices, categories, stock status, and uploaded photos should
normally be changed from the live `admin.html` page, not by editing source files.

## Development commands

```powershell
npm run check
npm run deploy
```

`npm run check` performs a Cloudflare dry run. `npm run deploy` publishes the
website and payment Worker while preserving configured server secrets.

## Important security notes

- `.push-secrets.local` is private and must never be uploaded or committed.
- `public/assets/js/supabase-client.js` contains only the browser-safe publishable
  connection values; database Row Level Security controls access.
- PayWay keys and other private server values belong in Cloudflare or Supabase
  secrets, never in HTML or browser JavaScript.

See [PayWay setup](docs/payway-setup.md) and
[push notification setup](docs/push-notifications-setup.md) for the one-time
server configuration.
