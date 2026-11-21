import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { ControlsProvider } from "@/lib/controls";
import { Shell } from "@/components/Shell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });

export const metadata: Metadata = {
  title: { default: "Dengue Watch", template: "%s · Dengue Watch" },
  description: "See which city wards are heading toward a dengue outbreak, 1 to 4 weeks before it happens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <ControlsProvider>
          <Shell>{children}</Shell>
        </ControlsProvider>
      </body>
    </html>
  );
}
