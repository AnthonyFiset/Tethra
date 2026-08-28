import type { ITheme } from "@xterm/xterm";

/** Read a CSS custom property from `:root`, with fallback. */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/**
 * Terminal ANSI theme derived from the app token set (M12.3).
 * Keeps chrome and PTY colors on one ramp.
 */
export function themeFromAppTokens(): ITheme {
  const base = cssVar("--color-base", "#0d0d0d");
  const elevated = cssVar("--color-elevated", "#1b1b1b");
  const fg = cssVar("--color-fg", "#e8e8e8");
  const muted = cssVar("--color-fg-muted", "#a1a1a1");
  const accent = cssVar("--color-accent", "#4c8df6");
  const danger = cssVar("--color-danger", "#e5544b");
  const success = cssVar("--color-success", "#3fb950");
  const warning = cssVar("--color-warning", "#d29922");

  return {
    background: cssVar("--terminal-bg", base),
    foreground: fg,
    cursor: accent,
    cursorAccent: base,
    selectionBackground: "#2c4a75",
    selectionInactiveBackground: "#1e2f4a",
    // xterm 6 overlay scrollbar — same thumb ramp as ::-webkit-scrollbar.
    scrollbarSliderBackground: cssVar("--color-line-strong", "#3f4046"),
    scrollbarSliderHoverBackground: "#4a4a4a",
    scrollbarSliderActiveBackground: "#5a5a5a",
    black: elevated,
    red: danger,
    green: success,
    yellow: warning,
    blue: accent,
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: muted,
    brightBlack: cssVar("--color-fg-subtle", "#6b6b6b"),
    brightRed: "#ff7b72",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: cssVar("--color-accent-hover", "#6ba0f8"),
    brightMagenta: "#d2a8ff",
    brightCyan: "#76e3ea",
    brightWhite: fg,
  };
}
