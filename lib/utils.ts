export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function generateId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function normalizeProjectName(name: string) {
  return name.trim().replace(/\s+/g, " ")
}
