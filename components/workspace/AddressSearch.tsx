"use client";

import { MapPinned, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  getMapKitConfigurationErrorMessage,
  searchAddressSuggestions,
  searchBestAddressMatch
} from "@/lib/mapkit/client";
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
  const [errorMessage, setErrorMessage] = useState("MapKit search is unavailable.");
  const debounced = useDebouncedValue(query, 300);

  useEffect(() => {
    if (!open || !debounced.trim()) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    setState("loading");
    searchAddressSuggestions(debounced, controller.signal)
      .then((items) => {
        setResults(items);
        setState("idle");
        setErrorMessage("MapKit search is unavailable.");
      })
      .catch(async (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
        setErrorMessage(await getMapKitConfigurationErrorMessage());
        setState("error");
      });

    return () => controller.abort();
  }, [debounced, open]);

  async function handleSubmit() {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;

    setState("loading");
    try {
      const bestMatch = await searchBestAddressMatch(normalizedQuery);
      if (!bestMatch) {
        setResults([]);
        setState("idle");
        return;
      }
      onSelect(bestMatch);
      setErrorMessage("MapKit search is unavailable.");
      setState("idle");
    } catch {
      setErrorMessage(await getMapKitConfigurationErrorMessage());
      setState("error");
    }
  }

  async function handleSuggestionSelect(result: AddressSuggestion) {
    setState("loading");
    try {
      const bestMatch = await searchBestAddressMatch(result);
      onSelect(bestMatch ?? result);
      setErrorMessage("MapKit search is unavailable.");
      setState("idle");
    } catch {
      setErrorMessage(await getMapKitConfigurationErrorMessage());
      onSelect(result);
      setState("idle");
    }
  }

  if (!open) return null;

  return (
    <Card style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <strong>Find property address</strong>
        <button type="button" onClick={onClose} style={{ background: "none", border: 0, color: "var(--muted)" }}>
          Close
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <Input
          id="address-search"
          label="Address Search"
          placeholder="Start typing an address"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <div style={{ display: "grid", gap: 10 }}>
        {state === "loading" ? <p style={{ color: "var(--muted)", margin: 0 }}>Searching…</p> : null}
        {state === "error" ? (
          <p style={{ color: "var(--danger)", margin: 0 }}>{errorMessage}</p>
        ) : null}
        {state !== "loading" && state !== "error" && query && results.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No suggestions yet.</p>
        ) : null}
        {results.map((result) => (
          <button
            key={result.id}
            type="button"
            onClick={() => void handleSuggestionSelect(result)}
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
