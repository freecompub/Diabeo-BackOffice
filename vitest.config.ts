import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/helpers/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "html"],
      include: [
        "src/lib/services/**",
        "src/lib/crypto/**",
        "src/lib/auth/**",
        "src/lib/statistics.ts",
        "src/lib/validators/**",
        "src/lib/proposal-algorithm.ts",
        "src/lib/conversions.ts",
        "src/lib/gdpr.ts",
      ],
      exclude: [
        "node_modules",
        "tests",
        "src/app",
        "src/components",
        "src/lib/services/mydiabby-client.service.ts",
        "src/lib/services/mydiabby-sync.service.ts",
        "src/lib/services/bdpm.service.ts",
        "src/lib/services/antivirus.service.ts",
        "src/lib/services/atc.service.ts",
        "src/lib/cron/**",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
