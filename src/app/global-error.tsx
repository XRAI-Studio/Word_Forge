"use client";
import { ThemeSync } from "@/components/theme-sync";
import { THEME_HEAD_SCRIPT } from "@/lib/theme-head-script";

// global-error replaces the root layout, and Next's built-in one follows the OS colour
// scheme, not the learner's choice. This one carries the head script (a server-rendered
// error), ThemeSync (a client-rendered one) and its own styles keyed to data-theme, in the
// game's palette: royal blue page in light, deep navy in dark, brass button in both
// (portal docs/class-standard.md §6).
const STYLE = `
body { margin: 0; min-height: 100vh; font-family: system-ui, sans-serif; background: #2C4BE0; color: #FFFFFF; }
main { max-width: 32rem; margin: 0 auto; padding: 3rem 1rem; }
h1 { font-size: 1.5rem; }
p { font-size: 1rem; line-height: 1.5; }
button { font: 700 1rem system-ui, sans-serif; min-height: 44px; min-width: 44px; padding: 0.5rem 1.25rem; border-radius: 999px; border: none; background: #FFC93C; color: #17246E; cursor: pointer; }
button:focus-visible { outline: 3px solid #FFFFFF; outline-offset: 2px; }
:root[data-theme="dark"] body { background: #080D26; color: #F1F4FF; }
:root[data-theme="dark"] button:focus-visible { outline-color: #FFC93C; }
`;

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_HEAD_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
        <title>Something went wrong · Read Words</title>
      </head>
      <body>
        <ThemeSync />
        <main>
          <h1>Something went wrong</h1>
          <p>Try again, or come back in a minute.</p>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
