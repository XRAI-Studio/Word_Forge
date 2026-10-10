"use client";
import { ThemeSync } from "@/components/theme-sync";
import { ERROR_PAGE_STYLE } from "@/lib/error-page-style";
import { THEME_HEAD_SCRIPT } from "@/lib/theme-head-script";

// global-error replaces the root layout, and Next's built-in one follows the OS colour
// scheme, not the learner's choice. This one carries the head script (a server-rendered
// error), ThemeSync (a client-rendered one) and its own styles keyed to data-theme, in the
// game's palette (portal docs/class-standard.md §6). The static production 500 page is
// src/pages/500.tsx, with the same styles.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_HEAD_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: ERROR_PAGE_STYLE }} />
        <title>Something went wrong · Read Words</title>
      </head>
      <body>
        <ThemeSync />
        <main>
          <h1>Something went wrong</h1>
          <p>Try again, or come back in a minute.</p>
          <button type="button" className="action" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
