CREATE TABLE IF NOT EXISTS billing_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  active_subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  subscription_price_id TEXT,
  subscription_current_period_start TEXT,
  subscription_current_period_end TEXT,
  subscription_cancel_at TEXT,
  subscription_canceled_at TEXT,
  subscription_trial_start TEXT,
  subscription_trial_end TEXT,
  billing_last_paid_at TEXT,
  billing_last_payment_failed_at TEXT,
  checkout_completed_at TEXT,
  access_granted_at TEXT,
  access_revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES billing_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  price_id TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at TEXT,
  trial_start TEXT,
  trial_end TEXT,
  last_invoice_id TEXT,
  last_invoice_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES billing_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_account_id_idx ON billing_subscriptions(account_id);
CREATE INDEX IF NOT EXISTS billing_subscriptions_customer_id_idx ON billing_subscriptions(stripe_customer_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL,
  error_message TEXT
);
