"use client";

import { useEffect, useRef } from "react";

type TokenResponse = {
  ok?: boolean;
  token?: string;
};

function stringifyError(value: unknown) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function MapKitTestPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<{ destroy?: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };

    async function run() {
      try {
        await new Promise<void>((resolve, reject) => {
          if (mapkitWindow.mapkit) {
            resolve();
            return;
          }

          const existing = document.querySelector<HTMLScriptElement>('script[data-mapkit-test="true"]');
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Existing MapKit script failed to load.")), {
              once: true
            });
            return;
          }

          const script = document.createElement("script");
          script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
          script.async = true;
          script.dataset.mapkitTest = "true";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("MapKit script failed to load from Apple CDN."));
          document.head.appendChild(script);
        });

        if (cancelled) return;

        const tokenResponse = await fetch("/api/mapkit/token", { cache: "no-store" });
        const tokenJson = (await tokenResponse.json()) as TokenResponse;
        if (!tokenResponse.ok || !tokenJson.ok || !tokenJson.token) {
          throw new Error("MapKit token request failed.");
        }

        if (!mapkitWindow.mapkit) {
          throw new Error("window.mapkit was not defined after script load.");
        }

        mapkitWindow.mapkit.init({
          authorizationCallback: (done) => done(tokenJson.token as string),
          language: "en"
        });

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
        console.error("MapKit test page failed to initialize.", stringifyError(error));
      }
    }

    void run();

    return () => {
      cancelled = true;
      mapInstanceRef.current?.destroy?.();
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        background: "#d9ddd8"
      }}
    >
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
