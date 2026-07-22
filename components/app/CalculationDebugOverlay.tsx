"use client";

import { useEffect, useMemo, useState } from "react";
import {
  clearCalculationDebugEntries,
  getCalculationDebugEntries,
  subscribeToCalculationDebugNotes,
} from "@/lib/debug/calculation-debug";

export function CalculationDebugOverlay() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ReturnType<typeof getCalculationDebugEntries>>([]);

  useEffect(() => {
    const refresh = () => setEntries(getCalculationDebugEntries());
    refresh();
    return subscribeToCalculationDebugNotes(refresh);
  }, []);

  const text = useMemo(
    () => entries.map((entry) => `${entry.timestamp}  ${entry.message}`).join("\n\n"),
    [entries],
  );

  async function copyAll() {
    if (!text) return;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text).catch(() => undefined);
      return;
    }

    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
  }

  return (
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 10000 }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          border: "1px solid rgba(31, 37, 34, 0.2)",
          borderRadius: 999,
          background: "rgba(31, 37, 34, 0.92)",
          color: "#fff",
          padding: "9px 12px",
          fontSize: 12,
          fontWeight: 700,
          boxShadow: "0 10px 24px rgba(20, 24, 22, 0.2)",
        }}
      >
        Data Debug{entries.length ? ` (${entries.length})` : ""}
      </button>
      {open ? (
        <section
          aria-label="Calculation debug notes"
          style={{
            position: "absolute",
            top: 46,
            right: 0,
            width: "min(560px, calc(100vw - 24px))",
            display: "grid",
            gap: 10,
            padding: 12,
            borderRadius: 16,
            background: "rgba(255, 255, 255, 0.97)",
            border: "1px solid rgba(31, 37, 34, 0.16)",
            boxShadow: "0 20px 50px rgba(20, 24, 22, 0.24)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <strong style={{ color: "#1f2522", fontSize: 14 }}>Calculator inputs</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={clearCalculationDebugEntries}
                disabled={!text}
                style={{
                  border: "1px solid rgba(31, 37, 34, 0.16)",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "#fff",
                  color: "#1f2522",
                  fontSize: 12,
                  fontWeight: 700,
                  opacity: text ? 1 : 0.5,
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void copyAll()}
                disabled={!text}
                style={{
                  border: 0,
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "#1f2522",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  opacity: text ? 1 : 0.5,
                }}
              >
                Copy All
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={text || "Change a roof pitch to record the calculator inputs for every plane."}
            aria-label="Calculation debug text"
            style={{
              width: "100%",
              minHeight: 280,
              resize: "vertical",
              borderRadius: 10,
              border: "1px solid rgba(31, 37, 34, 0.16)",
              padding: 10,
              color: "#1f2522",
              background: "#f7f6f1",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              lineHeight: 1.45,
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
