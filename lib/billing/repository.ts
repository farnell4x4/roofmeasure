import { getBillingDatabase } from "@/lib/billing/d1";
import type {
  BillingMagicLink,
  BillingUser,
  StripeSubscriptionStatus,
} from "@/types/billing";

type BillingUserRow = {
  user_id: string;
  email: string;
  stripe_customer_id: string | null;
  subscription_id: string | null;
  subscription_status: StripeSubscriptionStatus;
  current_period_end: string | null;
  updated_at: string;
};

type BillingMagicLinkRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

function nowIsoString() {
  return new Date().toISOString();
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function mapBillingUser(row: BillingUserRow): BillingUser {
  return {
    userId: row.user_id,
    email: row.email,
    stripeCustomerId: row.stripe_customer_id,
    subscriptionId: row.subscription_id,
    subscriptionStatus: row.subscription_status,
    currentPeriodEnd: row.current_period_end,
    subscriptionCancelAt: null,
    updatedAt: row.updated_at,
  };
}

function mapMagicLink(row: BillingMagicLinkRow): BillingMagicLink {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export async function createBillingRepository() {
  const database = await getBillingDatabase();

  return {
    async getUserByEmail(email: string) {
      const row = await database
        .prepare("SELECT * FROM billing_users WHERE email = ? LIMIT 1")
        .bind(normalizeEmail(email))
        .first<BillingUserRow>();
      return row ? mapBillingUser(row) : null;
    },
    async getUserById(userId: string) {
      const row = await database
        .prepare("SELECT * FROM billing_users WHERE user_id = ? LIMIT 1")
        .bind(userId)
        .first<BillingUserRow>();
      return row ? mapBillingUser(row) : null;
    },
    async getUserByStripeCustomerId(stripeCustomerId: string) {
      const row = await database
        .prepare("SELECT * FROM billing_users WHERE stripe_customer_id = ? LIMIT 1")
        .bind(stripeCustomerId)
        .first<BillingUserRow>();
      return row ? mapBillingUser(row) : null;
    },
    async createUser(email: string) {
      const userId = crypto.randomUUID();
      const now = nowIsoString();
      await database
        .prepare(
          `INSERT INTO billing_users (
            user_id, email, stripe_customer_id, subscription_id, subscription_status, current_period_end, updated_at
          ) VALUES (?, ?, NULL, NULL, 'inactive', NULL, ?)`,
        )
        .bind(userId, normalizeEmail(email), now)
        .run();
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error("Could not create billing user.");
      }
      return user;
    },
    async findOrCreateUserByEmail(email: string) {
      const existing = await this.getUserByEmail(email);
      return existing ?? this.createUser(email);
    },
    async updateStripeCustomerId(userId: string, stripeCustomerId: string) {
      await database
        .prepare(
          "UPDATE billing_users SET stripe_customer_id = ?, updated_at = ? WHERE user_id = ?",
        )
        .bind(stripeCustomerId, nowIsoString(), userId)
        .run();
    },
    async updateSubscriptionState(input: {
      userId: string;
      subscriptionId: string | null;
      subscriptionStatus: StripeSubscriptionStatus;
      currentPeriodEnd: string | null;
    }) {
      await database
        .prepare(
          `UPDATE billing_users
          SET subscription_id = ?, subscription_status = ?, current_period_end = ?, updated_at = ?
          WHERE user_id = ?`,
        )
        .bind(
          input.subscriptionId,
          input.subscriptionStatus,
          input.currentPeriodEnd,
          nowIsoString(),
          input.userId,
        )
        .run();
    },
    async createMagicLink(userId: string, tokenHash: string, expiresAt: string) {
      const id = crypto.randomUUID();
      await database
        .prepare(
          `INSERT INTO billing_magic_links (
            id, user_id, token_hash, expires_at, consumed_at, created_at
          ) VALUES (?, ?, ?, ?, NULL, ?)`,
        )
        .bind(id, userId, tokenHash, expiresAt, nowIsoString())
        .run();
      return id;
    },
    async getActiveMagicLinkByTokenHash(tokenHash: string) {
      const row = await database
        .prepare(
          `SELECT * FROM billing_magic_links
          WHERE token_hash = ? AND consumed_at IS NULL
          LIMIT 1`,
        )
        .bind(tokenHash)
        .first<BillingMagicLinkRow>();
      return row ? mapMagicLink(row) : null;
    },
    async consumeMagicLink(id: string) {
      await database
        .prepare("UPDATE billing_magic_links SET consumed_at = ? WHERE id = ?")
        .bind(nowIsoString(), id)
        .run();
    },
    async deleteExpiredMagicLinks() {
      await database
        .prepare("DELETE FROM billing_magic_links WHERE expires_at <= ?")
        .bind(nowIsoString())
        .run();
    },
  };
}
