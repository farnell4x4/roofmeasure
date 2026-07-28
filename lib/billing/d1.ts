import { getCloudflareContext } from "@opennextjs/cloudflare";

type D1StatementResultMeta = {
  changes?: number;
};

export type D1StatementResult = {
  success: boolean;
  meta?: D1StatementResultMeta;
};

export type D1PreparedStatement = {
  bind: (...values: unknown[]) => {
    first: <T = Record<string, unknown>>() => Promise<T | null>;
    run: () => Promise<D1StatementResult>;
    all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  };
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatement;
};

export async function getBillingDatabase() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const database = (env as Record<string, unknown> | undefined)?.DB;
    if (database && typeof database === "object" && "prepare" in database) {
      return database as D1DatabaseLike;
    }
  } catch {
    // Ignore and fall through to the friendly error below.
  }

  throw new Error(
    "Billing storage is not configured. Add the Cloudflare D1 binding `DB` before using subscriptions.",
  );
}
