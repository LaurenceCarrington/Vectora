import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { legalNoticesPlugin } from "./scripts/legal-notices-plugin.mjs";

export default defineConfig({
  // Keep scripts, fonts, lazy chunks, and workers portable to any Pages repository URL.
  base: "./",
  plugins: [react(), tailwindcss(), legalNoticesPlugin()],
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Vite 8 supports the function form; match package boundaries and subpaths.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](three|three-stdlib)[\\/]/.test(id)) return "vendor-three";
          if (/[\\/]node_modules[\\/]opentype\.js[\\/]/.test(id)) return "vendor-opentype";
          if (/[\\/]node_modules[\\/](polygon-clipping|clipper2-ts)[\\/]/.test(id)) return "vendor-clipping";
          if (/[\\/]node_modules[\\/](react|react-dom|framer-motion|lucide-react)[\\/]/.test(id)) return "vendor-react";
        },
      },
    },
  },
});
