// window.TSTheme is installed by the ts-theme v1 head script (src/lib/theme-head-script.ts,
// a verbatim copy of the portal's). The portal declares this type in lib/theme/cookie.ts,
// which a class does not copy, so ThemeSync's copy finds it here.
interface Window {
  TSTheme?: { apply: () => void };
}
