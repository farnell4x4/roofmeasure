"use client";

import { useEffect, useRef, useState } from "react";

type StatusTone = "idle" | "loading" | "success" | "error";

type StatusItem = {
  id: string;
  label: string;
  tone: StatusTone;
  detail: string;
};

const INITIAL_STATUSES: StatusItem[] = [
  {
    id: "script",
    label: "Load mapkit.js",
    tone: "idle",
    detail: "Waiting to request Apple's script."
  },
  {
    id: "token",
    label: "Fetch /api/mapkit/token",
    tone: "idle",
    detail: "Waiting to request a token."
  },
  {
    id: "init",
    label: "Run mapkit.init(...)",
    tone: "idle",
    detail: "Waiting for token and script."
  },
  {
    id: "map",
    label: "Create new mapkit.Map(...)",
    tone: "idle",
    detail: "Waiting for MapKit initialization."
  }
];

type TokenResponse = {
  ok?: boolean;
  token?: string;
  expiresAt?: number;
  message?: string;
  diagnostics?: unknown;
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

function stringifyJson(value: unknown) {
  if (typeof value === "undefined") return "undefined";

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return stringifyError(value);
  }
}

export default function MapKitTestPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const [statuses, setStatuses] = useState(INITIAL_STATUSES);
  const [events, setEvents] = useState<string[]>([]);
  const [tokenPreview, setTokenPreview] = useState<string>("");
  const [query, setQuery] = useState("1600 Amphitheatre Parkway, Mountain View, CA");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [searchMessage, setSearchMessage] = useState("Type an address and press Enter.");
  const [firstResult, setFirstResult] = useState<string>("");
  const [searchErrorLog, setSearchErrorLog] = useState("No search callback yet.");
  const [searchDataLog, setSearchDataLog] = useState("No search callback yet.");
  const [searchPlacesLog, setSearchPlacesLog] = useState("No search callback yet.");
  const [searchTraceLog, setSearchTraceLog] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };

    const setStatus = (id: string, tone: StatusTone, detail: string) => {
      setStatuses((current) =>
        current.map((item) => (item.id === id ? { ...item, tone, detail } : item))
      );
    };

    const appendEvent = (message: string) => {
      setEvents((current) => [`${new Date().toLocaleTimeString()}: ${message}`, ...current].slice(0, 20));
    };

    const handleWindowError = (event: ErrorEvent) => {
      appendEvent(`window.onerror: ${event.message || "Unknown browser error"}`);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      appendEvent(`unhandledrejection: ${stringifyError(event.reason)}`);
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    async function run() {
      try {
        setStatus("script", "loading", "Requesting https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js");
        appendEvent("Loading Apple's full mapkit.js script.");

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
        setStatus("script", "success", "Script loaded and window.mapkit is available.");
        appendEvent("mapkit.js loaded.");

        setStatus("token", "loading", "Fetching /api/mapkit/token");
        appendEvent("Requesting /api/mapkit/token.");
        const tokenResponse = await fetch("/api/mapkit/token", { cache: "no-store" });
        const tokenJson = (await tokenResponse.json()) as TokenResponse;

        if (cancelled) return;
        if (!tokenResponse.ok || !tokenJson.ok || !tokenJson.token) {
          const detail = tokenJson.message ?? `Token request failed with status ${tokenResponse.status}.`;
          setStatus("token", "error", detail);
          appendEvent(`Token request failed: ${detail}`);
          return;
        }

        setTokenPreview(`${tokenJson.token.slice(0, 32)}...`);
        setStatus(
          "token",
          "success",
          `Token received.${tokenJson.expiresAt ? ` Expires at ${new Date(tokenJson.expiresAt * 1000).toLocaleString()}.` : ""}`
        );
        appendEvent("Token received from /api/mapkit/token.");

        if (!mapkitWindow.mapkit) {
          throw new Error("window.mapkit was not defined after script load.");
        }

        setStatus("init", "loading", "Calling mapkit.init(...)");
        appendEvent("Calling mapkit.init(...).");
        mapkitWindow.mapkit.init({
          authorizationCallback: (done) => done(tokenJson.token as string),
          language: "en"
        });

        if (cancelled) return;
        setStatus("init", "success", "mapkit.init(...) returned without throwing.");
        appendEvent("mapkit.init(...) completed.");

        if (!mapRef.current) {
          throw new Error("Map container element was unavailable.");
        }

        setStatus("map", "loading", "Creating new mapkit.Map(...)");
        appendEvent("Creating new mapkit.Map(...).");

        const center = new mapkitWindow.mapkit.Coordinate(39.5501, -105.7821);
        const span = new mapkitWindow.mapkit.CoordinateSpan(0.04, 0.04);
        const region = new mapkitWindow.mapkit.CoordinateRegion(center, span);

        mapInstanceRef.current = new mapkitWindow.mapkit.Map(mapRef.current, {
          region,
          showsCompass: "visible",
          showsMapTypeControl: true,
          mapType: mapkitWindow.mapkit.MapType?.Standard
        });

        if (cancelled) return;
        setStatus("map", "success", "Map created successfully.");
        appendEvent("new mapkit.Map(...) completed.");
      } catch (error) {
        if (cancelled) return;
        const message = stringifyError(error);
        appendEvent(`Fatal setup error: ${message}`);

        setStatuses((current) => {
          const firstPending = current.find((item) => item.tone === "idle" || item.tone === "loading");
          if (!firstPending) return current;
          return current.map((item) =>
            item.id === firstPending.id ? { ...item, tone: "error", detail: message } : item
          );
        });
      }
    }

    void run();

    return () => {
      cancelled = true;
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);

      const mapInstance = mapInstanceRef.current as { destroy?: () => void } | null;
      mapInstance?.destroy?.();
      mapInstanceRef.current = null;
    };
  }, []);

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;

    const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };
    const appendSearchTrace = (message: string) => {
      const line = `${new Date().toLocaleTimeString()}: ${message}`;
      console.log(line);
      setSearchTraceLog((current) => [line, ...current].slice(0, 12));
    };

    appendSearchTrace("Submit handler started.");

    if (!mapkitWindow.mapkit?.Search) {
      appendSearchTrace("window.mapkit.Search was unavailable.");
      setSearchState("error");
      setSearchMessage("MapKit Search is unavailable on window.mapkit.");
      setFirstResult("");
      setSearchErrorLog("MapKit Search is unavailable on window.mapkit.");
      setSearchDataLog("undefined");
      setSearchPlacesLog("undefined");
      return;
    }

    setSearchState("loading");
    setSearchMessage(`Searching for "${normalizedQuery}"...`);
    setFirstResult("");
    setSearchErrorLog("Waiting for callback...");
    setSearchDataLog("Waiting for callback...");
    setSearchPlacesLog("Waiting for callback...");
    setSearchTraceLog([]);
    appendSearchTrace(`Prepared callback test for "${normalizedQuery}".`);

    const search = new mapkitWindow.mapkit.Search({ language: "en" }) as {
      search: (
        query: string,
        callback: (error: unknown, data: { places?: Array<Record<string, unknown>> } | null) => void,
        options?: Record<string, unknown>
      ) => Promise<unknown>;
    };

    try {
      appendSearchTrace("About to call search.search().");
      void search.search(
        normalizedQuery,
        (error, data) => {
          appendSearchTrace("Search callback executed.");
          console.log("error:", error);
          console.log("data:", data);
          console.log("places:", data?.places);

          setSearchErrorLog(stringifyJson(error));
          setSearchDataLog(stringifyJson(data));
          setSearchPlacesLog(stringifyJson(data?.places));

          if (error) {
            setSearchState("error");
            setSearchMessage(`Search callback returned an error for "${normalizedQuery}".`);
            setFirstResult("");
            return;
          }

          const place = data?.places?.[0];
          if (!place) {
            setSearchState("success");
            setSearchMessage("Search callback completed, but data.places was empty.");
            setFirstResult("");
            return;
          }

          const placeRecord = place as Record<string, unknown>;
          const displayLines = Array.isArray(placeRecord.displayLines) ? placeRecord.displayLines : [];
          const title = String(placeRecord.name ?? placeRecord.title ?? displayLines[0] ?? normalizedQuery);
          const subtitle = String(placeRecord.formattedAddress ?? placeRecord.subtitle ?? displayLines[1] ?? "");

          setSearchState("success");
          setSearchMessage("Search callback completed. Raw callback payload is shown below.");
          setFirstResult(subtitle ? `${title} — ${subtitle}` : title);
        },
        {
        includeAddresses: true,
        includePointsOfInterest: false,
        includePhysicalFeatures: false
        }
      );
      appendSearchTrace("search.search() returned.");
    } catch (error) {
      appendSearchTrace(`search.search() threw synchronously: ${stringifyError(error)}`);
      console.error("MapKit callback search failed before callback", error);
      setSearchState("error");
      setSearchMessage(stringifyError(error));
      setFirstResult("");
      setSearchErrorLog(stringifyJson(error));
      setSearchDataLog("undefined");
      setSearchPlacesLog("undefined");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        gap: 16,
        padding: "24px 20px 40px",
        background: "#f4efe8",
        color: "#1f2522"
      }}
    >
      <section
        style={{
          display: "grid",
          gap: 12,
          maxWidth: 960,
          margin: "0 auto",
          width: "100%"
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 32 }}>MapKit Test</h1>
          <p style={{ margin: "8px 0 0", color: "#5f685f" }}>
            Minimal MapKit JS repro page for Safari and Web Inspector. This page only tests script load,
            token fetch, MapKit initialization, and map creation.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gap: 10,
            padding: 16,
            borderRadius: 18,
            border: "1px solid rgba(31, 37, 34, 0.12)",
            background: "rgba(255, 255, 255, 0.86)"
          }}
        >
          {statuses.map((item) => (
            <div
              key={item.id}
              style={{
                padding: 12,
                borderRadius: 14,
                border: "1px solid rgba(31, 37, 34, 0.12)",
                background:
                  item.tone === "success"
                    ? "rgba(53, 122, 70, 0.12)"
                    : item.tone === "error"
                      ? "rgba(180, 63, 45, 0.12)"
                      : item.tone === "loading"
                        ? "rgba(201, 111, 48, 0.12)"
                        : "rgba(31, 37, 34, 0.04)"
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {item.label}: {item.tone}
              </div>
              <div style={{ marginTop: 4, color: "#5f685f", wordBreak: "break-word" }}>{item.detail}</div>
            </div>
          ))}
        </div>

        <div
          ref={mapRef}
          style={{
            width: "100%",
            minHeight: 480,
            borderRadius: 24,
            overflow: "hidden",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            background: "#d9ddd8"
          }}
        />

        <section
          style={{
            display: "grid",
            gap: 12,
            padding: 16,
            borderRadius: 18,
            border: "1px solid rgba(31, 37, 34, 0.12)",
            background: "rgba(255, 255, 255, 0.86)"
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>Direct Search Callback Test</h2>
          <form onSubmit={handleSearchSubmit}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter a full address and press Enter"
              style={{
                width: "100%",
                borderRadius: 14,
                border: "1px solid rgba(31, 37, 34, 0.16)",
                padding: "12px 14px",
                fontSize: 16,
                background: "#fff",
                color: "#1f2522"
              }}
            />
          </form>
          <p style={{ margin: 0, color: searchState === "error" ? "#b43f2d" : "#5f685f", wordBreak: "break-word" }}>
            {searchMessage}
          </p>
          <p style={{ margin: 0, color: "#1f2522", fontWeight: 600, wordBreak: "break-word" }}>
            {firstResult || "First result will appear here."}
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Search trace</div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 14,
                  background: "#f7f4ef",
                  border: "1px solid rgba(31, 37, 34, 0.12)",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word"
                }}
              >
                {searchTraceLog.length > 0 ? searchTraceLog.join("\n") : "No search trace yet."}
              </pre>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Callback `error`</div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 14,
                  background: "#f7f4ef",
                  border: "1px solid rgba(31, 37, 34, 0.12)",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word"
                }}
              >
                {searchErrorLog}
              </pre>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Callback `data`</div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 14,
                  background: "#f7f4ef",
                  border: "1px solid rgba(31, 37, 34, 0.12)",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word"
                }}
              >
                {searchDataLog}
              </pre>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Callback `data.places`</div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 14,
                  background: "#f7f4ef",
                  border: "1px solid rgba(31, 37, 34, 0.12)",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word"
                }}
              >
                {searchPlacesLog}
              </pre>
            </div>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))"
          }}
        >
          <div
            style={{
              padding: 16,
              borderRadius: 18,
              border: "1px solid rgba(31, 37, 34, 0.12)",
              background: "rgba(255, 255, 255, 0.86)"
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18 }}>Token Preview</h2>
            <p style={{ margin: "8px 0 0", color: "#5f685f", wordBreak: "break-all" }}>
              {tokenPreview || "No token received yet."}
            </p>
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 18,
              border: "1px solid rgba(31, 37, 34, 0.12)",
              background: "rgba(255, 255, 255, 0.86)"
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18 }}>Browser Errors</h2>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {events.length === 0 ? (
                <p style={{ margin: 0, color: "#5f685f" }}>No window errors or promise rejections captured yet.</p>
              ) : (
                events.map((event, index) => (
                  <p key={`${event}-${index}`} style={{ margin: 0, color: "#5f685f", wordBreak: "break-word" }}>
                    {event}
                  </p>
                ))
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
