"use client";
import { useLayoutEffect } from "react";

// The head script sets the theme while the HTML is parsed. When React replaces the <html>
// element on the client (a client-rendered global-error, a dev remount) it clears those
// attributes and does not run scripts it inserts, so this re-applies the theme before
// paint. TSTheme.apply() only sets attributes: calling it again adds no listeners.
export function ThemeSync() {
  useLayoutEffect(() => {
    window.TSTheme?.apply();
  });
  return null;
}
