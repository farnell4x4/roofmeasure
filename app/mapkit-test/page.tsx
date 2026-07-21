"use client";

import { Search } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { lookupStreetAddress, loadMapKit } from "@/lib/mapkit/client";

export default function MapKitTestPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<InstanceType<NonNullable<NonNullable<Window["mapkit"]>["Map"]>> | null>(null);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error">("idle");
  const [searchMessage, setSearchMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };

    async function run() {
      try {
        await loadMapKit();

        if (cancelled || !mapkitWindow.mapkit) {
          throw new Error("window.mapkit was not defined after script load.");
        }

        if (cancelled || !mapRef.current) return;

        const center = new mapkitWindow.mapkit.Coordinate(39.5501, -105.7821);
        const span = new mapkitWindow.mapkit.CoordinateSpan(0.04, 0.04);
        const region = new mapkitWindow.mapkit.CoordinateRegion(center, span);

        mapInstanceRef.current = new mapkitWindow.mapkit.Map(mapRef.current, {
          region,
          showsCompass: "visible",
          showsMapTypeControl: true,
          mapType: mapkitWindow.mapkit.MapType?.Standard
        });
      } catch (error) {
        console.error("MapKit test page failed to initialize.", error);
        setSearchState("error");
        setSearchMessage(error instanceof Error ? error.message : "Map initialization failed.");
      }
    }

    void run();

    return () => {
      cancelled = true;
      mapInstanceRef.current?.destroy?.();
      mapInstanceRef.current = null;
    };
  }, []);

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSearchState("error");
      setSearchMessage("Address is required.");
      return;
    }

    setSearchState("loading");
    setSearchMessage("");

    try {
      const [bestMatch] = await lookupStreetAddress(normalizedQuery);
      if (!bestMatch || typeof bestMatch.latitude !== "number" || typeof bestMatch.longitude !== "number") {
        setSearchState("error");
        setSearchMessage("No address found.");
        return;
      }

      const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };
      const map = mapInstanceRef.current;
      if (!mapkitWindow.mapkit || !map) {
        throw new Error("Map is not ready yet.");
      }

      const span = map.region?.span;
      const region = new mapkitWindow.mapkit.CoordinateRegion(
        new mapkitWindow.mapkit.Coordinate(bestMatch.latitude, bestMatch.longitude),
        new mapkitWindow.mapkit.CoordinateSpan(span?.latitudeDelta ?? 0.01, span?.longitudeDelta ?? 0.01)
      );

      map.region = region;
      setSearchState("idle");
      setSearchMessage(bestMatch.formattedAddress || "Address found.");
    } catch (error) {
      console.error("Address lookup failed:", error);
      setSearchState("error");
      setSearchMessage(error instanceof Error ? error.message : "Address lookup failed.");
    }
  }

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        background: "#d9ddd8"
      }}
    >
      <form
        onSubmit={handleSearchSubmit}
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 2,
          width: "min(420px, calc(100vw - 32px))",
          display: "grid",
          gap: 8
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 18,
            background: "rgba(255, 255, 255, 0.92)",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            boxShadow: "0 14px 30px rgba(20, 24, 22, 0.16)"
          }}
        >
          <Search size={18} color="#5f685f" />
          <input
            aria-label="Search address"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search street address"
            style={{
              flex: 1,
              border: 0,
              outline: "none",
              background: "transparent",
              color: "#1f2522",
              fontSize: 16
            }}
          />
        </div>
        {searchMessage ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: searchState === "error" ? "#b43f2d" : "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)"
            }}
          >
            {searchState === "loading" ? "Searching..." : searchMessage}
          </div>
        ) : searchState === "loading" ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)"
            }}
          >
            Searching...
          </div>
        ) : null}
      </form>
      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: "100%"
        }}
      />
    </main>
  );
}
