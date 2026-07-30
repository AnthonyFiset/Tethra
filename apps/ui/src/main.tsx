import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Drives the traffic-light inset: only macOS overlays window controls on the
// left edge of our own titlebar.
document.documentElement.dataset.platform = /Mac|iPhone|iPad/.test(
  navigator.platform || navigator.userAgent,
)
  ? "macos"
  : "other";

const root = document.getElementById("root");

if (!root) {
  throw new Error("root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
