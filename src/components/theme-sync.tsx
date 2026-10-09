"use client";
import { useLayoutEffect } from "react";
import { THEME_HEAD_SCRIPT } from "@/lib/theme-head-script";

// The head script sets the theme while the HTML is parsed. When React replaces the <html>
// element on the client (a client-rendered global-error, a dev remount) it clears those
// attributes and does not run scripts it inserts, so this re-applies the theme before
// paint. TSTheme.apply() only sets attributes: calling it again adds no listeners. If the
// head script never ran at all (Next client-renders its own error shell, with an empty
// head, after a failed first server render), this starts it here; it defines TSTheme, so
// that happens once.
export function ThemeSync() {
  useLayoutEffect(() => {
    if (window.TSTheme) window.TSTheme.apply();
    else new Function(THEME_HEAD_SCRIPT)();
  });
  return null;
}
