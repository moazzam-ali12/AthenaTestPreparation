import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Release = git SHA (Vercel provides it; locally fall back to `git rev-parse`).
function gitSha(): string | undefined {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return undefined;
  }
}

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  // Sentry environment / sample rates, readable by the browser bundle too.
  env: {
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT ?? "",
    NEXT_PUBLIC_SENTRY_SAMPLE_RATE: process.env.SENTRY_SAMPLE_RATE ?? "",
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE ?? "",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
  headers: async () => [
    {
      source: "/videos/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    },
  ],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Source maps upload only when SENTRY_AUTH_TOKEN is set (Vercel); maps are deleted after upload.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  release: { name: gitSha() },
  widenClientFileUpload: true,
  silent: !process.env.CI,
  telemetry: false,
});
