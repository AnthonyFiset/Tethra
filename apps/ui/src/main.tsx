import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/jetbrains-mono/wght.css";
import App from "./App";
import { applyPlatformAccent } from "./lib/accent";
import { ChromeProvider } from "./lib/ChromeContext";
import { applyChromeDataset } from "./lib/chrome";
import { activateWindowChrome } from "./lib/ipc";
import { applyWindowMaterial } from "./lib/materials";
import "./styles.css";
import { startDevBridge } from "./dev/bridge";

// Set before first paint so CSS clearance/fonts apply immediately.
applyChromeDataset();
// Dev-only: automation bridge for scripts/app-drive.mjs (real-app QA).
startDevBridge();

const root = document.getElementById("root");

if (!root) {
  throw new Error("root element is missing");
}

void (async () => {
  await activateWindowChrome();
  await applyPlatformAccent();
  // Opaque by default; vibrancy/Mica only if the user opted in.
  await applyWindowMaterial();
})();

createRoot(root).render(
  <StrictMode>
    <ChromeProvider>
      <App />
    </ChromeProvider>
  </StrictMode>,
);
