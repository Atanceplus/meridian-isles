import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The one-year calibration simulations replay ~1,800 events.
    testTimeout: 30_000,
  },
});
