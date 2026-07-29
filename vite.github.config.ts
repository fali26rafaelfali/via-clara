import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "github",
  base: "/via-clara/",
  plugins: [react()],
  build: {
    outDir: "../github-dist",
    emptyOutDir: true,
  },
});
