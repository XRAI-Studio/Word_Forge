import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../next.config";

describe("next.config headers (class standard rule 2.4)", () => {
  it("sets the four security headers on every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/(.*)");
    const got = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
    expect(got).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    expect(rules[0].headers).toBe(SECURITY_HEADERS);
  });
});
