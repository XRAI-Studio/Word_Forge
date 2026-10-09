import type { ReactNode } from "react";
import { ThemeSync } from "@/components/theme-sync";
import { THEME_HEAD_SCRIPT } from "@/lib/theme-head-script";

// The shell has no page of its own: "/" is rewritten to the static viewer in public/.
// This layout only exists because Next requires a root layout to build the app; it renders
// the not-found page, which follows the learner's theme like every class page
// (docs/class-standard.md §6 in the portal): the ts-theme head script sets data-theme on
// <html> before paint, and this minimal style keys off it.
export const metadata = { title: "Read Words — Latin Roots" };

const SHELL_STYLE = `body{margin:0;background:#FFFFFF;color:#17246E}
a{color:#1B2FA0}
:root[data-theme="dark"] body{background:#0B1233;color:#F1F4FF}
:root[data-theme="dark"] a{color:#FFC93C}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the head script sets data-theme, data-theme-pref and the
    // colour-scheme style on <html> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_HEAD_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: SHELL_STYLE }} />
      </head>
      <body>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
