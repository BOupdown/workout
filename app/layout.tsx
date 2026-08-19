import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TabBar } from "@/components/nav/tab-bar";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { StorageGuard } from "@/components/storage/storage-guard";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Numbers are the content of this app: setting them in monospace aligns them
// vertically from one set to the next and makes them comparable at a glance.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Base for absolute metadata URLs. Vercel supplies
 * `VERCEL_PROJECT_PRODUCTION_URL`; locally we fall back to the dev server, which
 * avoids hard-coding a production URL that is not known yet.
 */
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Workout",
  description: "Training log: weights and reps, set by set.",
  applicationName: "Workout",
  // iOS ignores the manifest for full-screen mode: it needs its own meta tags,
  // which Next emits from this block.
  appleWebApp: {
    capable: true,
    title: "Workout",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Workout",
    title: "Workout",
    description: "Training log: weights and reps, set by set.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  // `viewportFit: cover` is what makes `env(safe-area-inset-*)` non-zero:
  // without it the primary button would slide under the iPhone home indicator.
  viewportFit: "cover",
  // Must follow `--surface` in globals.css and the manifest's `theme_color`:
  // this is the colour the system paints behind the status bar.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* The shell owns the height; each screen fills `main` with h-full and
            handles its own scrolling. */}
        <div className="flex h-[100dvh] flex-col">
          <main className="min-h-0 flex-1">
            <StorageGuard>{children}</StorageGuard>
          </main>
          <ServiceWorkerRegistrar />
          <TabBar />
        </div>
      </body>
    </html>
  );
}
