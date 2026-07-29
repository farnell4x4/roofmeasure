# Stripe Billing Setup

This app uses:

- Stripe Checkout for recurring subscriptions
- Stripe Customer Portal for self-service billing management
- Stripe webhooks as the source of truth for access
- Cloudflare D1 only for a tiny billing identity record and short-lived magic-link records
- A signed 30-day entitlement token stored locally in IndexedDB for offline-friendly paid-feature unlocks

## Cloudflare setup
  
1. Create the D1 database.
2. Replace `REPLACE_WITH_REAL_D1_DATABASE_ID` in `wrangler.jsonc`.
3. Apply the migration:

```bash
npx wrangler d1 migrations apply roofmeasure --local
npx wrangler d1 migrations apply roofmeasure --remote
```

## Required secrets

Add these as Cloudflare secrets for the deployed Worker:

```bash
npx wrangler secret put BILLING_ENTITLEMENT_PRIVATE_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAGIC_LINK_FROM_EMAIL
npx wrangler secret put MAGIC_LINK_FROM_NAME
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_BILLING_PLANS_TEST_JSON
npx wrangler secret put STRIPE_BILLING_PLANS_JSON
```

Expose this public key to the client:

```bash
# add in your env file or worker vars
NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

For local development, place the same values in your local env file if needed.

`STRIPE_BILLING_PLANS_JSON` example:

```json
[
  {
    "id": "pro-monthly",
    "name": "Pro Monthly",
    "description": "Unlimited roof measurements billed monthly.",
    "priceId": "price_123",
    "interval": "month"
  }
]
```

## Sandbox testing

1. Create your Product and recurring Price in Stripe test mode.
2. Put the Stripe test restricted key or secret key into `STRIPE_SECRET_KEY`.
3. Start the app locally.
4. Forward webhooks:

```bash
stripe listen --forward-to http://127.0.0.1:3000/api/stripe/webhook
```

5. Copy the printed signing secret into `STRIPE_WEBHOOK_SECRET`.
6. Request a magic link on `/billing`, open it, subscribe with a Stripe test card, and confirm that access changes only after the webhook arrives and a refreshed entitlement is issued.

Recommended test cases:

- Successful first subscription checkout
- Checkout canceled before payment
- Renewal success
- Renewal failure
- Subscription cancellation from the customer portal
- Duplicate webhook delivery

## Notes

- D1 stores only `user_id`, `email`, `stripe_customer_id`, `subscription_id`, `subscription_status`, `current_period_end`, and `updated_at`, plus short-lived magic-link records.
- Local IndexedDB project storage remains unchanged.
- The entitlement token contains only `user_id`, `email`, `subscription_active`, `subscription_cancel_at`, `plan`, `issued_at`, and `expires_at`.
- Subscription access is granted only for `active` and `trialing` server-recorded Stripe states.
- The app refreshes the locally stored entitlement periodically when online instead of querying D1 or Stripe on every unlock check.
