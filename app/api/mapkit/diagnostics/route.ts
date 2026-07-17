import { NextResponse } from "next/server";
import { getMapKitEnvDiagnostics } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    ok: true,
    diagnostics: getMapKitEnvDiagnostics()
  });
}
