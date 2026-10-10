import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "@/app/global-error";
import RootLayout from "@/app/layout";
import { THEME_HEAD_SCRIPT } from "@/lib/theme-head-script";

// global-error replaces the root layout, so it must carry the theme on its own (portal
// docs/class-standard.md §6); not-found renders inside the shell's root layout.
describe("error pages follow the learner's theme", () => {
  const html = renderToString(createElement(GlobalError, { error: new Error("x"), retry: () => {} }));

  it("global-error runs the head script verbatim", () => {
    expect(html).toContain(THEME_HEAD_SCRIPT);
  });

  it("global-error styles both themes from data-theme, never the OS media query", () => {
    expect(html).toContain(':root[data-theme="dark"] body');
    expect(html).not.toMatch(/@media[^{]*prefers-color-scheme/);
  });

  it("global-error's Try again button is a 44 px target", () => {
    expect(html).toMatch(/\.action \{[^}]*min-height: 44px/);
    expect(html).toMatch(/<button[^>]*class="action"[^>]*>Try again<\/button>/);
  });

  it("global-error re-applies the theme after a client-side remount (ThemeSync)", () => {
    expect(readFileSync("src/app/global-error.tsx", "utf8")).toMatch(/<ThemeSync \/>/);
  });

  it("the shell layout (which renders not-found) runs the head script and styles both themes", () => {
    const layout = renderToString(createElement(RootLayout, null, createElement("main", null, "x")));
    expect(layout).toContain(THEME_HEAD_SCRIPT);
    expect(layout).toContain(':root[data-theme="dark"] body');
    expect(layout).not.toMatch(/@media[^{]*prefers-color-scheme/);
    expect(readFileSync("src/app/layout.tsx", "utf8")).toMatch(/<ThemeSync \/>/);
    expect(readFileSync("src/app/not-found.tsx", "utf8")).not.toContain("prefers-color-scheme");
  });
});

describe("static production 500 page (same gap as Codex PORTAL-APPEARANCE-012)", () => {
  it("exists as a Pages Router 500 page, so Next keeps it instead of its OS-themed built-in", () => {
    const src = readFileSync("src/pages/500.tsx", "utf8");
    expect(src).toContain("THEME_HEAD_SCRIPT");
    expect(src).toContain("ERROR_PAGE_STYLE");
    expect(src).toMatch(/<a className="action" href="">/);
  });

  it("shares the error-page styles: data-theme keyed, 16px text, 44px action, no OS media rule", async () => {
    const { ERROR_PAGE_STYLE } = await import("@/lib/error-page-style");
    expect(ERROR_PAGE_STYLE).toContain(':root[data-theme="dark"] body');
    expect(ERROR_PAGE_STYLE).toMatch(/\.action \{[^}]*min-height: 44px/);
    expect(ERROR_PAGE_STYLE).toMatch(/p \{ font-size: 1rem; \}/);
    expect(ERROR_PAGE_STYLE).not.toMatch(/@media[^{]*prefers-color-scheme/);
    expect(readFileSync("src/app/global-error.tsx", "utf8")).toContain("ERROR_PAGE_STYLE");
  });
});
