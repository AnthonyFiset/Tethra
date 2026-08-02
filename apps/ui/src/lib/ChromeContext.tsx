import { createContext, useContext, type ReactNode } from "react";
import {
  applyChromeDataset,
  detectChromeStyle,
  type ChromeStyle,
} from "./chrome";

const ChromeContext = createContext<ChromeStyle>(detectChromeStyle());

export function ChromeProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const style = applyChromeDataset();
  return (
    <ChromeContext.Provider value={style}>{children}</ChromeContext.Provider>
  );
}

export function useChrome(): ChromeStyle {
  return useContext(ChromeContext);
}
