import { NextResponse } from "next/server";
import { getMapKitEnvDiagnostics } from "@/lib/config/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    diagnostics: await getMapKitEnvDiagnostics()
  });
}
