import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * This app has no account, no cookie and no server state, so the classic
 * consequences of XSS — stolen sessions, forged requests — do not apply here.
 * What it does hold is somebody's training history, sitting in IndexedDB on
 * their phone, under a promise that nothing leaves the device.
 *
 * That promise is what these headers actually protect. `default-src 'self'`
 * and `connect-src 'self'` mean code that somehow ran here would have nowhere
 * to send anything: no third-party origin is reachable, at all. The rest
 * closes the cheap doors — framing, MIME sniffing, referrer leakage, and the
 * device APIs the app never asks for.
 */
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
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
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
