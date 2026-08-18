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

// Les chiffres sont le contenu de cette app : ils sont composés en monospace,
// ce qui les aligne verticalement d'une série à l'autre et les rend comparables
// d'un coup d'œil.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Base des URL absolues des metadonnees. Vercel renseigne
 * `VERCEL_PROJECT_PRODUCTION_URL` ; en local on retombe sur le serveur de dev,
 * ce qui evite de coder en dur une URL de production pas encore connue.
 */
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Workout",
  description: "Suivi de séances : poids et répétitions, série par série.",
  applicationName: "Workout",
  // iOS ignore le manifeste pour le mode plein ecran : il lui faut ses propres
  // meta, que Next emet a partir de ce bloc.
  appleWebApp: {
    capable: true,
    title: "Workout",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Workout",
    title: "Workout",
    description: "Suivi de séances : poids et répétitions, série par série.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  // `viewportFit: cover` est ce qui rend `env(safe-area-inset-*)` non nul :
  // sans lui, le bouton principal passerait sous l'indicateur d'accueil iPhone.
  viewportFit: "cover",
  // Doivent suivre `--surface` dans globals.css et `theme_color` du manifeste :
  // c'est la couleur que le systeme peint derriere la barre d'etat.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* La coquille tient la hauteur ; chaque ecran remplit `main` en h-full
            et gere son propre defilement. */}
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
