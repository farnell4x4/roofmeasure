DROP TABLE IF EXISTS stripe_webhook_events;
DROP TABLE IF EXISTS billing_subscriptions;
DROP TABLE IF EXISTS billing_account_sessions;
DROP TABLE IF EXISTS billing_accounts;

CREATE TABLE IF NOT EXISTS billing_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  current_period_end TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_magic_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES billing_users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_users_customer_id_idx
  ON billing_users(stripe_customer_id);

CREATE INDEX IF NOT EXISTS billing_magic_links_user_id_idx
  ON billing_magic_links(user_id);

CREATE INDEX IF NOT EXISTS billing_magic_links_expires_at_idx
  ON billing_magic_links(expires_at);
