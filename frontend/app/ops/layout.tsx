import type { Metadata } from "next";
import { OpsFrame } from "@/components/ops/OpsFrame";

export const metadata: Metadata = { title: "Operations" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <OpsFrame>{children}</OpsFrame>;
}
