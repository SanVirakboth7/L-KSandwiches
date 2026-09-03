# ABA PayWay setup

The storefront is wired for ABA PayWay Ecommerce Checkout in sandbox mode. The API key is never stored in browser code or committed to Git.

## 1. Get sandbox credentials

Register at https://sandbox.payway.com.kh/ and obtain your sandbox Merchant ID and API Key.

Ask the PayWay Integration team to whitelist the domain where this Worker will run, including its callback URL:

`https://YOUR-DOMAIN/api/payway/callback`

## 2. Add the Cloudflare secrets

From this project folder, sign in to Wrangler and enter each value interactively:

```powershell
npx wrangler login
npx wrangler secret put PAYWAY_MERCHANT_ID
npx wrangler secret put PAYWAY_API_KEY
npx wrangler secret put SUPABASE_ANON_KEY
```

For local sandbox testing, create a `.dev.vars` file (it is ignored by Git):

```dotenv
PAYWAY_MERCHANT_ID="your-sandbox-merchant-id"
PAYWAY_API_KEY="your-sandbox-api-key"
SUPABASE_ANON_KEY="the-anon-key-from-public/assets/js/supabase-client.js"
```

## 3. Test and deploy

```powershell
npx wrangler dev
npx wrangler deploy --dry-run
npx wrangler deploy
```

The checkout remains in sandbox while `PAYWAY_ENV` is `sandbox` in `wrangler.jsonc`.

## 4. Switch to live payments

After PayWay approves the production integration and whitelists the live domain:

1. Replace the two Worker secrets with the production Merchant ID and API Key.
2. Change `PAYWAY_ENV` in `wrangler.jsonc` from `sandbox` to `production`.
3. Run a dry deployment, then deploy.

Cash on Delivery does not use PayWay and continues to send the order directly.
