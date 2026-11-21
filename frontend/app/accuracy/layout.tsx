import type { Metadata } from "next";

export const metadata: Metadata = { title: "Can I trust it?" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
