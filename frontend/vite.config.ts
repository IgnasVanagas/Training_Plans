import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-leaflet") || id.includes("leaflet")) return "vendor-maps";
          if (id.includes("react-big-calendar") || id.includes("date-fns")) return "vendor-calendar";
          if (id.includes("@tanstack/react-query") || id.includes("axios")) return "vendor-data";
          if (id.includes("@dnd-kit")) return "vendor-dnd";
          if (id.includes("recharts")) return "vendor-charts";
          if (id.includes("@mantine") || id.includes("@tabler")) return "vendor-ui";
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("react-dom") || id.includes("scheduler") || /[\\/]react[\\/]/.test(id)) return "vendor-react";
          return "vendor-react";
        },
      },
    },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true
  }
});
