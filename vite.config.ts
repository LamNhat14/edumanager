import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: loadEnv(mode, process.cwd(), "VITE_").VITE_BASE_PATH || "/",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@supabase/")) return "supabase";
          if (id.includes("/node_modules/zod/")) return "validation";
        },
      },
    },
  },
}));
