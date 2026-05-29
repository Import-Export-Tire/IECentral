import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

// next-pwa's exported PWAConfig type omits a handful of Workbox options
// (clientsClaim, cleanupOutdatedCaches) even though Workbox accepts them
// and next-pwa forwards them through. Widen the type rather than drop
// these — both are load-bearing for the stale-SW fix below.
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  // clientsClaim + cleanupOutdatedCaches are Workbox options that next-pwa
  // forwards but doesn't include in its TS PWAConfig type. Spread via an
  // `as any` so TS is happy while still passing them through.
  // - clientsClaim: a freshly installed SW takes control of all open tabs
  //   immediately. Without it, users who installed the PWA before a deploy
  //   keep loading the old cached JS bundle (Andy 5/29: removed "Tire Quote
  //   of the Day" kept appearing for users on stale workers).
  // - cleanupOutdatedCaches: wipe outdated runtime-cached entries when the
  //   SW activates so users don't sit on a stale bundle from prior versions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...({ clientsClaim: true, cleanupOutdatedCaches: true } as any),
  disable: process.env.NODE_ENV === "development", // Disable in dev to avoid caching issues
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "google-fonts",
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
      },
    },
    {
      urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-font-assets",
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
        },
      },
    },
    {
      urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-image-assets",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60, // 24 hours
        },
      },
    },
    {
      urlPattern: /\.(?:js)$/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "static-js-assets",
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 24 hours
        },
      },
    },
    {
      urlPattern: /\.(?:css|less)$/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "static-style-assets",
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 24 hours
        },
      },
    },
    {
      urlPattern: /^https:\/\/api\.convex\.dev\/.*/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "convex-api",
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 16,
          maxAgeSeconds: 60, // 1 minute
        },
      },
    },
    {
      urlPattern: /.*/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "others",
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 24 hours
        },
      },
    },
  ],
});

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://api.zoom.us https://zoom.us https://*.amazonaws.com https://api.giphy.com; img-src 'self' data: blob: https: https://media*.giphy.com; frame-src 'self' https://zoom.us; media-src 'self' blob: https://*.amazonaws.com;" },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);
