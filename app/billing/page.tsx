import { BillingScreen } from "@/components/screens/BillingScreen";
import { getStripeBillingPlans } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

export default async function BillingRoute() {
  const plansResult = await Promise.allSettled([getStripeBillingPlans()]);
  const planLoad = plansResult[0];

  return (
    <BillingScreen
      plans={planLoad.status === "fulfilled" ? planLoad.value : []}
      planLoadError={
        planLoad.status === "rejected"
          ? planLoad.reason instanceof Error
            ? planLoad.reason.message
            : "Billing plans are unavailable."
          : null
      }
    />
  );
}
