/**
 * The ts-theme v1 head script: the canonical copy for every class (docs/class-standard.md
 * §6). It runs inline in <head> before first paint, reads the `ts_theme` cookie the
 * Profile page writes on .travelschooling.com, and sets on <html> `data-theme`
 * (light|dark, Auto resolved through the OS setting), `data-theme-pref`
 * (light|dark|auto) and `style.colorScheme`. Copy the string verbatim; each class has a
 * test pinning its SHA-256 to the hash in the standard. ES5 on purpose: it runs before any
 * bundle.
 */
export const THEME_COOKIE = "ts_theme";

export const THEME_HEAD_SCRIPT = `/* ts-theme v1. Canonical: travelschooling-portal/lib/theme/head-script.ts. Copy verbatim. */
(function () {
  try {
  var d = document, r = d.documentElement;
  var m = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function pref() {
    var c = /(?:^|;\\s*)ts_theme=(light|dark|auto)(?:;|$)/.exec(d.cookie || "");
    return c ? c[1] : "auto";
  }
  function apply() {
    var p = pref(), t = p === "auto" ? (m && m.matches ? "dark" : "light") : p;
    r.setAttribute("data-theme", t);
    r.setAttribute("data-theme-pref", p);
    r.style.colorScheme = t;
  }
  apply();
  if (m) { if (m.addEventListener) m.addEventListener("change", apply); else if (m.addListener) m.addListener(apply); }
  d.addEventListener("visibilitychange", function () { if (!d.hidden) apply(); });
  window.addEventListener("pageshow", apply);
  window.TSTheme = { apply: apply };
  } catch (e) {}
})();`;
