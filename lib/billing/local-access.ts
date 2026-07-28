import { getStoredBillingEntitlement } from "@/lib/billing/entitlement-client"
import { db } from "@/lib/persistence/db"

export const LOCAL_PROJECT_LIMIT_MESSAGE = "Your free project is already used. Subscribe to create more projects."

export async function canCreateLocalProject() {
  const entitlement = await getStoredBillingEntitlement()
  if (entitlement?.payload.subscription_active) return true

  const trial = await db.getLocalTrial()
  if (trial?.freeProjectUsed) return false

  const [projects, imageProjects] = await Promise.all([
    db.listProjects(),
    db.listImageProjects(),
  ])
  return projects.length + imageProjects.length === 0
}

export async function recordLocalProjectCreated() {
  const entitlement = await getStoredBillingEntitlement()
  if (!entitlement?.payload.subscription_active) {
    await db.markFreeProjectUsed()
  }
}
