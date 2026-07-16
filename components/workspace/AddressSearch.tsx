"use client";

import { MapPinned, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchAddressSuggestions } from "@/lib/mapkit/client";
import { AddressSuggestion } from "@/types/mapkit";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export function AddressSearch({
  open,
  onSelect,
  onClose
}: {
  open: boolean;
  onSelect: (suggestion: AddressSuggestion) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const debounced = useDebouncedValue(query, 300);

  useEffect(() => {
    if (!open || !debounced.trim()) {
      setResults([]);
      return;
    }

    setState("loading");
    searchAddressSuggestions(debounced)
      .then((items) => {
        setResults(items);
        setState("idle");
      })
      .catch(() => {
        setResults([]);
        setState("error");
      });
  }, [debounced, open]);

  if (!open) return null;

  return (
    <Card style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <strong>Find property address</strong>
        <button type="button" onClick={onClose} style={{ background: "none", border: 0, color: "var(--muted)" }}>
          Close
        </button>
      </div>
      <Input
        id="address-search"
        label="Address Search"
        placeholder="Start typing an address"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div style={{ display: "grid", gap: 10 }}>
        {state === "loading" ? <p style={{ color: "var(--muted)", margin: 0 }}>Searching…</p> : null}
        {state === "error" ? (
          <p style={{ color: "var(--danger)", margin: 0 }}>MapKit search is unavailable until credentials are configured.</p>
        ) : null}
        {state !== "loading" && query && results.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No suggestions yet.</p>
        ) : null}
        {results.map((result) => (
          <button
            key={result.id}
            type="button"
            onClick={() => onSelect(result)}
            style={{
              display: "grid",
              gap: 4,
              textAlign: "left",
              borderRadius: 16,
              border: "1px solid var(--stroke)",
              background: "var(--surface-strong)",
              padding: 14
            }}
          >
            <span style={{ fontWeight: 600 }}><Search size={16} /> {result.title}</span>
            <span style={{ color: "var(--muted)" }}><MapPinned size={16} /> {result.subtitle}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
