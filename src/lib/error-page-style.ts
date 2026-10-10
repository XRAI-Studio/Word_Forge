/**
 * Self-contained styles for the pages that render outside the game and the shell layout:
 * src/app/global-error.tsx and the static production 500 page (src/pages/500.tsx). Both
 * themes key off data-theme from the ts-theme head script (portal docs/class-standard.md
 * §6), in the game's palette: royal blue page in light, deep navy in dark, a brass action
 * in both. 16px text, 44px action, no OS media query.
 */
export const ERROR_PAGE_STYLE = `
body { margin: 0; min-height: 100vh; font: 16px/1.5 system-ui, sans-serif; background: #2C4BE0; color: #FFFFFF; overflow-wrap: anywhere; }
main { max-width: 32rem; margin: 0 auto; padding: 3rem 1rem; }
h1 { font-size: 1.5rem; }
p { font-size: 1rem; }
.action { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: 44px; min-width: 44px; font: 700 1rem system-ui, sans-serif; padding: 0.5rem 1.25rem; border-radius: 999px; border: none; background: #FFC93C; color: #17246E; cursor: pointer; text-decoration: none; }
.action:focus-visible { outline: 3px solid #FFFFFF; outline-offset: 2px; }
:root[data-theme="dark"] body { background: #080D26; color: #F1F4FF; }
:root[data-theme="dark"] .action:focus-visible { outline-color: #FFC93C; }
`;
