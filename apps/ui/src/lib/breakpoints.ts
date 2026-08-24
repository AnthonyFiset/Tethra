import { useEffect, useState } from "react";

/** Keep in sync with `--breakpoint-surface-nav` in `styles.css`. */
export const SURFACE_NAV_EXPAND_MIN_PX = 1000;

/** Close surface nav overflow when the viewport expands to inline pills. */
export function useSurfaceNavExpanded(onExpand?: () => void): boolean {
  const [expanded, setExpanded] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(`(min-width: ${SURFACE_NAV_EXPAND_MIN_PX}px)`).matches
      : true,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SURFACE_NAV_EXPAND_MIN_PX}px)`);
    function onChange(event: MediaQueryListEvent): void {
      setExpanded(event.matches);
      if (event.matches) onExpand?.();
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [onExpand]);

  return expanded;
}
