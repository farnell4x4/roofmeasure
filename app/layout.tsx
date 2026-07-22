import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/app/AppProviders";
import { PageZoomGuard } from "@/components/app/PageZoomGuard";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Roof Tape Measure",
  description: "Premium local-first roof measurement for contractors and estimators.",
  applicationName: "Roof Tape Measure",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Roof Tape Measure"
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.svg"
  }
};

export const viewport: Viewport = {
  themeColor: "#c96f30",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <PageZoomGuard />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
