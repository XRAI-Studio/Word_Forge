import type { NextConfig } from "next";

/** Class standard rule 2.4. HSTS is Vercel's default on the custom domain and is not redeclared. */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    // The viewer is a static site in public/; the shell has no page of its own. Rewrites
    // in this form apply after the filesystem check, so "/" (no page) becomes the file.
    return [{ source: "/", destination: "/index.html" }];
  },
};

export default nextConfig;
