import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
  // Allow _ prefix for intentionally unused params (e.g. TODO stubs)
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Prefer `??` over `||` on nullable values — would have caught the IOB
  // actionDurationHours `|| 4.0` bug at authoring time (a stored 0 silently
  // coerced to 4h default, disabling IOB subtraction → insulin stacking risk).
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Don't flag boolean `||` (short-circuit is correct for bool fallbacks)
      // and string `||` when the intent is empty-string → default (common in UI).
      // Focus the rule on numbers where 0 falsy-coercion has caused real bugs.
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { boolean: true, string: true } },
      ],
    },
  },
  // Allow `any` in test files — mocks require flexible typing
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
