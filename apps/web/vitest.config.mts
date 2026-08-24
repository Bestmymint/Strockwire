import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  root: webRoot,
  test: {
    exclude: ["**/node_modules/**", "**/.next/**"],
    fileParallelism: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
