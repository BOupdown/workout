import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * The app stores a fast offline copy in IndexedDB and talks only to its own
 * Supabase project for authentication and account-scoped synchronisation.
 *
 * The policy permits no third party except that configured project origin. The
 * rest closes the cheap doors — framing, MIME sniffing, referrer leakage, and
 * the device APIs the app never asks for.
 */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : null;

const csp = [
  "default-src 'self'",
  // Next inlines its bootstrap script, and a nonce would mean rendering every
  // page dynamically for a site that is entirely static. The trade is made
  // knowingly: there is no injection surface here — no `dangerouslySetInnerHTML`
  // anywhere in the app — and `connect-src` still blocks exfiltration.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // `blob:` is the export handing its file over as an object URL; `data:`
  // covers inlined icons.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  ["connect-src 'self'", supabaseOrigin].filter(Boolean).join(' '),
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  experimental: {
    // `@phosphor-icons/react` re-exports some nine thousand icons from one
    // entry file. Production tree-shakes them away, but every module still has
    // to be walked first: the barrel is what the dev server compiles on boot
    // and re-walks on each HMR round. Naming it here has the compiler rewrite
    // `import { Barbell }` into the one file it actually needs — the import
    // sites stay as they are, types and all.
    optimizePackageImports: ['@phosphor-icons/react'],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Development runs on `eval` for hot reloading, which no honest CSP
          // can allow. Sending it in production only keeps the header truthful,
          // rather than loosening it everywhere to suit the dev server.
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Content-Security-Policy", value: csp }]
            : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          // For browsers that ignore `frame-ancestors`.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          // Everything the app never uses, refused explicitly. Stated rather
          // than left to chance: taking nothing is the point of the project.
          {
            key: "Permissions-Policy",
            value: [
              "accelerometer=()",
              "camera=()",
              "geolocation=()",
              "gyroscope=()",
              "magnetometer=()",
              "microphone=()",
              "payment=()",
              "usb=()",
            ].join(", "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
