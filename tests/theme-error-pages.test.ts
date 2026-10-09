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
    expect(html).toMatch(/button \{[^}]*min-height: 44px/);
    expect(html).toContain(">Try again</button>");
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
