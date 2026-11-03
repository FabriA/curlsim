import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
