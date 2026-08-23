import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const useMock = process.env.VITE_TETHRA_MOCK === "1";
const mockIpc = path.resolve(root, "src/lib/ipc.mock.ts");

/** Swap `lib/ipc` → mock when `VITE_TETHRA_MOCK=1` (browser harness). */
function mockIpcPlugin(): Plugin {
  return {
    name: "tethra-mock-ipc",
    enforce: "pre",
    resolveId(source) {
      if (!useMock) return null;
      // Match relative imports like ../lib/ipc, ./lib/ipc, ../../lib/ipc
      if (/(?:^|\/)lib\/ipc(?:\.(?:ts|js|tsx|jsx|mjs))?$/.test(source)) {
        return mockIpc;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [mockIpcPlugin(), tailwindcss(), react()],
  clearScreen: false,
  server: {
    port: useMock ? 5173 : 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_DEBUG),
  },
});
