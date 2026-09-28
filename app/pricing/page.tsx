import type { Metadata } from "next";
import { PricingView } from "@/components/billing/pricing-view";

export const metadata: Metadata = {
  title: "Pricing",
  description: "AlgoVerse Free and Pro plans.",
};

export default function PricingPage() {
  return <PricingView />;
}
