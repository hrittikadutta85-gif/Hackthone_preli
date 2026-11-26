import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter, Noto_Sans_Bengali, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ControlsProvider } from "@/lib/controls";
import { Shell } from "@/components/Shell";
import { Backdrop } from "@/components/Backdrop";
import { LanguageProvider } from "@/lib/i18n";
import { LANG_BOOT_SCRIPT } from "@/lib/i18n/boot";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex" });
// used for any Bengali character the three fonts above do not have; not preloaded for English readers
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], variable: "--font-bengali", preload: false });

export const metadata: Metadata = {
  title: { default: "Dengue Watch", template: "%s · Dengue Watch" },
  description: "See which city wards are heading toward a dengue outbreak, 1 to 4 weeks before it happens.",
};

export const viewport: Viewport = { themeColor: "#070d17", colorScheme: "dark", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // the boot script below may change `lang` before React starts, which is why hydration warnings are off on <html>
  return (
    <html lang="en" className={`${inter.variable} ${space.variable} ${plex.variable} ${bengali.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
        <Backdrop />
        <LanguageProvider>
          <ControlsProvider>
            <Shell>{children}</Shell>
          </ControlsProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
