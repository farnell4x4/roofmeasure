import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "RoofMeasure",
    short_name: "RoofMeasure",
    description: "Local-first roof measurement for field estimators.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f1ea",
    theme_color: "#c96f30",
    icons: [
      {
        src: "/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  });
}
