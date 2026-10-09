// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeSync } from "@/components/theme-sync";
import { THEME_HEAD_SCRIPT } from "@/lib/theme-head-script";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.cookie = "ts_theme=; Max-Age=0; Path=/";
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {} }),
  });
  // The head script as the browser runs it: once, before React.
  new Function(THEME_HEAD_SCRIPT)();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.cookie = "ts_theme=; Max-Age=0; Path=/";
});

describe("ThemeSync", () => {
  it("restores the theme attributes React cleared, without a visibilitychange", async () => {
    document.cookie = "ts_theme=dark; Path=/";
    window.TSTheme!.apply();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-pref");
    await act(async () => root.render(createElement(ThemeSync)));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme-pref")).toBe("dark");
  });

  it("renders nothing", async () => {
    await act(async () => root.render(createElement(ThemeSync)));
    expect(container.innerHTML).toBe("");
  });
});

describe("ThemeSync when the head script never ran", () => {
  it("starts the theme runtime itself (Next's error shell after a failed first render), once", async () => {
    document.cookie = "ts_theme=dark; Path=/";
    delete (window as { TSTheme?: unknown }).TSTheme;
    const html = document.documentElement;
    html.removeAttribute("data-theme");
    html.removeAttribute("data-theme-pref");
    html.style.colorScheme = "";
    await act(async () => root.render(createElement(ThemeSync)));
    expect([html.getAttribute("data-theme"), html.getAttribute("data-theme-pref"), html.style.colorScheme]).toEqual(["dark", "dark", "dark"]);
    const runtime = window.TSTheme;
    expect(runtime).toBeDefined();
    await act(async () => root.render(createElement(ThemeSync, { key: "again" })));
    expect(window.TSTheme).toBe(runtime);
    document.cookie = "ts_theme=light; Path=/";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(html.getAttribute("data-theme")).toBe("light");
  });
});
