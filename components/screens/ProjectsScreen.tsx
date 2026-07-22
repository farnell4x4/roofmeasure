"use client"

import { Copy, Download, FolderOpen, Plus, Trash2, Upload } from "lucide-react"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { Card } from "@/components/ui/Card"
import { EmptyState } from "@/components/ui/EmptyState"
import { Input } from "@/components/ui/Input"
import { useToast } from "@/components/ui/ToastProvider"
import { db } from "@/lib/persistence/db"
import { formatArea } from "@/lib/measurement/units"
import { calculateProjectTotals } from "@/lib/measurement/calculations"
import { useProjects } from "@/hooks/useProjects"
import { appendPersistenceDebugNote } from "@/lib/debug/persistence-debug"

export function ProjectsScreen() {
  const router = useRouter()
  const { push } = useToast()
  const { projects, isLoading, refresh } = useProjects()
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<"recent" | "name" | "address">("recent")

  const filtered = useMemo(() => {
    const normalizedQuery = query.toLowerCase()
    const items = projects.filter((project) => {
      const address = project.location?.formattedAddress ?? ""
      return (
        project.name.toLowerCase().includes(normalizedQuery) ||
        address.toLowerCase().includes(normalizedQuery)
      )
    })
    if (sort === "name") {
      return items.sort((left, right) => left.name.localeCompare(right.name))
    }
    if (sort === "address") {
      return items.sort((left, right) =>
        (left.location?.formattedAddress ?? "").localeCompare(
          right.location?.formattedAddress ?? "",
        ),
      )
    }
    return items
  }, [projects, query, sort])

  async function handleDeleteProject(id: string) {
    if (!window.confirm("Delete this project from local storage?")) return
    await db.deleteProject(id)
    push({ title: "Project deleted.", tone: "success" })
    await refresh()
  }

  async function handleDuplicateProject(id: string) {
    const project = await db.getProject(id)
    if (!project) return
    await db.duplicateProject(project)
    push({ title: "Project duplicated.", tone: "success" })
    await refresh()
  }

  async function handleExportProject(id: string) {
    const payload = await db.exportProject(id)
    if (!payload) return
    const blob = new Blob([payload], { type: "application/json" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = `roofmeasure-${id}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function handleImportProject(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    await db.importProject(text)
    push({ title: "Project imported.", tone: "success" })
    await refresh()
  }

  function handleOpenProject(project: (typeof projects)[number]) {
    const totals = calculateProjectTotals(project)
    appendPersistenceDebugNote(
      `SAVED PROJECT OPEN REQUESTED • ${project.name} (${project.id.slice(-8)}) • ${totals.segmentCount} segment(s)`,
    )
    router.push(`/?projectId=${project.id}`)
  }

  return (
    <main className="app-shell page-grid">
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <p className="chip">Saved Projects</p>
          <h1 style={{ marginBottom: 8 }}>Local projects and reports</h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Search, sort, duplicate, export, or reopen any locally stored roof
            measurement project.
          </p>
        </div>
        <Button onClick={() => router.push("/?new=1")}>
          <Plus size={18} /> New Project
        </Button>
      </section>

      <Card style={{ display: "grid", gap: 12 }}>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "1fr auto",
            alignItems: "end",
          }}
        >
          <Input
            id="project-search"
            label="Search projects"
            placeholder="Search by project name or address"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              style={{
                borderRadius: 16,
                minHeight: 52,
                padding: "0 14px",
                border: "1px solid var(--stroke)",
                background: "var(--surface-strong)",
              }}
            >
              <option value="recent">Recently Modified</option>
              <option value="name">Name</option>
              <option value="address">Address</option>
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label>
            <input
              className="sr-only"
              type="file"
              accept="application/json"
              onChange={handleImportProject}
            />
            <Button variant="secondary" type="button">
              <Upload size={18} /> Import Project
            </Button>
          </label>
        </div>
      </Card>

      {isLoading ? <Card>Loading projects…</Card> : null}
      {!isLoading && filtered.length === 0 ? (
        <EmptyState
          title="No saved projects yet"
          description="Search an address from the measuring screen to create a saved local project. Imported projects also appear here."
          actionLabel="Start New Project"
          onAction={() => router.push("/?new=1")}
        />
      ) : null}

      <section style={{ display: "grid", gap: 14 }}>
        {filtered.map((project) => {
          const totals = calculateProjectTotals(project)
          return (
            <Card key={project.id} style={{ display: "grid", gap: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2 style={{ margin: "0 0 4px" }}>{project.name}</h2>
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    {project.location?.formattedAddress ??
                      "Address not selected yet"}
                  </p>
                </div>
                <span className="chip">
                  {totals.segmentCount} segments •{" "}
                  {formatArea(
                    totals.totalSlopeAreaSqFt,
                    project.preferences.unitSystem,
                  )}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  color: "var(--muted)",
                  fontSize: 14,
                }}
              >
                <span>
                  Modified {new Date(project.updatedAt).toLocaleString()}
                </span>
                <span>{totals.planeCount} roof planes</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button onClick={() => handleOpenProject(project)}>
                  <FolderOpen size={18} /> Open
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleDuplicateProject(project.id)}
                >
                  <Copy size={18} /> Duplicate
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleExportProject(project.id)}
                >
                  <Download size={18} /> Export
                </Button>
                <Button
                  variant="danger"
                  onClick={() => handleDeleteProject(project.id)}
                >
                  <Trash2 size={18} /> Delete
                </Button>
              </div>
            </Card>
          )
        })}
      </section>
    </main>
  )
}
