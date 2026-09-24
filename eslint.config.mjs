import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The kata viewer: plain ES modules served as-is from public/, not part of the
    // TypeScript shell (the portal ignores its kit the same way).
    "public/**",
    // Node test and tooling scripts for the viewer (node --test, not the shell).
    "tests/**/*.mjs",
    "tools/**",
  ]),
]);

export default eslintConfig;
