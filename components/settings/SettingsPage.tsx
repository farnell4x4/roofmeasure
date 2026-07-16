"use client";

import { MoonStar, Ruler, SunMedium } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useAppPreferences } from "@/hooks/useAppPreferences";

export function SettingsPage() {
  const { preferences, setPreferences } = useAppPreferences();

  return (
    <main className="app-shell page-grid">
      <div>
        <p className="chip">Settings</p>
        <h1>Preferences</h1>
        <p style={{ color: "var(--muted)" }}>Units, display style, and app defaults are stored locally on this device.</p>
      </div>

      <Card style={{ display: "grid", gap: 18 }}>
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontWeight: 600 }}><Ruler size={16} /> Measurement Units</span>
          <select
            value={preferences.unitSystem}
            onChange={(event) =>
              setPreferences((current) => ({ ...current, unitSystem: event.target.value as typeof current.unitSystem }))
            }
            style={{ borderRadius: 16, minHeight: 52, padding: "0 14px", border: "1px solid var(--stroke)", background: "var(--surface-strong)" }}
          >
            <option value="imperial">Imperial</option>
            <option value="metric">Metric</option>
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ display: "grid", gap: 4 }}>
            <strong>Show decimal feet</strong>
            <span style={{ color: "var(--muted)" }}>Use decimal feet alongside feet and inches in the workspace.</span>
          </span>
          <input
            type="checkbox"
            checked={preferences.displayDecimalFeet}
            onChange={(event) =>
              setPreferences((current) => ({ ...current, displayDecimalFeet: event.target.checked }))
            }
          />
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontWeight: 600 }}><SunMedium size={16} /> Theme Preference <MoonStar size={16} /></span>
          <select
            value={preferences.darkMode}
            onChange={(event) =>
              setPreferences((current) => ({ ...current, darkMode: event.target.value as typeof current.darkMode }))
            }
            style={{ borderRadius: 16, minHeight: 52, padding: "0 14px", border: "1px solid var(--stroke)", background: "var(--surface-strong)" }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </Card>
    </main>
  );
}
