/** Platform chrome style for layout (titlebar inset, Settings shell, shortcuts). */

export type ChromeStyle = "mac" | "win" | "linux";

type NavigatorUAData = {
  platform?: string;
};

export function detectChromeStyle(): ChromeStyle {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData })
    .userAgentData;
  const platform = (
    uaData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    ""
  ).toLowerCase();

  if (
    platform.includes("mac") ||
    platform.includes("iphone") ||
    platform.includes("ipad")
  ) {
    return "mac";
  }
  if (platform.includes("win")) {
    return "win";
  }
  return "linux";
}

/** Apply dataset attributes used by CSS (traffic lights, fonts, clearance). */
export function applyChromeDataset(style: ChromeStyle = detectChromeStyle()): ChromeStyle {
  const root = document.documentElement;
  root.dataset.chrome = style;
  // Alias for older selectors; prefer data-chrome going forward.
  root.dataset.platform = style === "mac" ? "macos" : style;
  return style;
}

export function modKeyLabel(style: ChromeStyle): string {
  return style === "mac" ? "⌘" : "Ctrl";
}

export function shiftModLabel(style: ChromeStyle): string {
  return style === "mac" ? "⇧⌘" : "Ctrl+Shift";
}
