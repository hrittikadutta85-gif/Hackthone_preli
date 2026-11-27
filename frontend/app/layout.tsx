import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter, Noto_Sans_Bengali, Poppins } from "next/font/google";
import "./globals.css";
import { Backdrop } from "@/components/Backdrop";
import { LanguageProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth";
import { AppFrame } from "@/components/auth/AppFrame";
import { ToastProvider } from "@/components/auth/Providers";
import { LANG_BOOT_SCRIPT } from "@/lib/i18n/boot";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// headings: a friendly geometric sans that matches Inter's proportions
const poppins = Poppins({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-poppins" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex" });
// used for any Bengali character the three fonts above do not have; not preloaded for English readers
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], variable: "--font-bengali", preload: false });

export const metadata: Metadata = {
  title: { default: "Dengue Watch", template: "%s · Dengue Watch" },
  description: "See which city wards are heading toward a dengue outbreak, 1 to 4 weeks before it happens.",
};

export const viewport: Viewport = { themeColor: "#f5f8f7", colorScheme: "light", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // the boot script below may change `lang` before React starts, which is why hydration warnings are off on <html>
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable} ${plex.variable} ${bengali.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
        <Backdrop />
        <LanguageProvider>
          <AuthProvider>
            <ToastProvider>
              <AppFrame>{children}</AppFrame>
            </ToastProvider>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
