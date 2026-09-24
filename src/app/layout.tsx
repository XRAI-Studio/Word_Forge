import type { ReactNode } from "react";

// The shell has no page of its own: "/" is rewritten to the static viewer in public/.
// This layout only exists because Next requires a root layout to build the app.
export const metadata = { title: "Word Forge — Latin Roots" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
