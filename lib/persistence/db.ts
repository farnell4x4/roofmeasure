import { openDB } from "idb"
import { AppPreferences, Project, SCHEMA_VERSION } from "@/types/models"

const DB_NAME = "roofmeasure-db"
const DB_VERSION = 1
const PROJECTS_STORE = "projects"
const PREFERENCES_STORE = "preferences"
const RECOVERY_STORE = "recovery"

type RecoveryEntry = {
  id: string
  projectId: string
  project: Project
  savedAt: string
}

async function getDatabase() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const projectStore = database.createObjectStore(PROJECTS_STORE, {
          keyPath: "id",
        })
        projectStore.createIndex("updatedAt", "updatedAt")
        database.createObjectStore(PREFERENCES_STORE, { keyPath: "id" })
        database.createObjectStore(RECOVERY_STORE, { keyPath: "id" })
      }
    },
  })
}

export const db = {
  async listProjects() {
    const database = await getDatabase()
    const projects = (await database.getAll(PROJECTS_STORE)) as Project[]
    return projects.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
  },
  async getProject(id: string) {
    const database = await getDatabase()
    return (await database.get(PROJECTS_STORE, id)) as Project | undefined
  },
  async getProjectForHydration(id: string) {
    const project = await this.getProject(id)
    if (project) return { project, source: "projects" as const }

    const recovery = await this.getRecovery(id)
    if (!recovery?.project) return null

    // The recovery copy is committed in the same transaction as the project.
    // Restore it if a browser has left the primary store unexpectedly absent.
    await this.saveProject(recovery.project)
    return { project: recovery.project, source: "recovery" as const }
  },
  async getMostRecentProject() {
    const projects = await this.listProjects()
    return projects[0]
  },
  async saveProject(project: Project) {
    const database = await getDatabase()
    const payload = {
      ...project,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    }
    const transaction = database.transaction(
      [PROJECTS_STORE, RECOVERY_STORE],
      "readwrite",
    )
    await transaction.objectStore(PROJECTS_STORE).put(payload)
    await transaction.objectStore(RECOVERY_STORE).put({
      id: project.id,
      projectId: project.id,
      project: payload,
      savedAt: payload.updatedAt,
    } satisfies RecoveryEntry)
    await transaction.done
    return payload
  },
  async deleteProject(id: string) {
    const database = await getDatabase()
    const transaction = database.transaction(
      [PROJECTS_STORE, RECOVERY_STORE],
      "readwrite",
    )
    await transaction.objectStore(PROJECTS_STORE).delete(id)
    await transaction.objectStore(RECOVERY_STORE).delete(id)
    await transaction.done
  },
  async duplicateProject(project: Project) {
    const clone: Project = {
      ...project,
      id: crypto.randomUUID(),
      name: `${project.name} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return this.saveProject(clone)
  },
  async exportProject(id: string) {
    const project = await this.getProject(id)
    if (!project) return null
    return JSON.stringify(project, null, 2)
  },
  async importProject(source: string) {
    const project = JSON.parse(source) as Project
    return this.saveProject({
      ...project,
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    })
  },
  async getPreferences() {
    const database = await getDatabase()
    return (await database.get(PREFERENCES_STORE, "app")) as
      AppPreferences | undefined
  },
  async savePreferences(preferences: AppPreferences) {
    const database = await getDatabase()
    await database.put(PREFERENCES_STORE, { ...preferences, id: "app" })
  },
  async getRecovery(projectId: string) {
    const database = await getDatabase()
    return (await database.get(RECOVERY_STORE, projectId)) as
      RecoveryEntry | undefined
  },
}
