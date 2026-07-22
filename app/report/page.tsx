import { Suspense } from "react"
import { ReportScreen } from "@/components/screens/ReportScreen"

export default function ReportRoute() {
  return (
    <Suspense fallback={<main className="report-page"><p>Loading report…</p></main>}>
      <ReportScreen />
    </Suspense>
  )
}
