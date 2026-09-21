import { getStoredBillingEntitlement } from "@/lib/billing/entitlement-client"
import { db } from "@/lib/persistence/db"

export const FREE_LOCAL_PROJECT_LIMIT = 3
export const LOCAL_PROJECT_LIMIT_MESSAGE = "Your free limit is 3 projects. Subscribe to create more projects."

export async function canCreateLocalProject() {
  const entitlement = await getStoredBillingEntitlement()
  if (entitlement?.payload.subscription_active) return true

  const [projects, imageProjects] = await Promise.all([
    db.listProjects(),
    db.listImageProjects(),
  ])
  return projects.length + imageProjects.length < FREE_LOCAL_PROJECT_LIMIT
}
