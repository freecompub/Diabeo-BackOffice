import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

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
  // US-2269 — Gate anti-drift design system : interdit les couleurs hex en dur.
  // En `warn` pour le MVP (migration incrémentale des ~call-sites existants ;
  // `pnpm lint` n'a pas `--max-warnings`, la CI ne casse donc pas). Les charts
  // doivent importer `tokens` de `@/design-system/tokens` ; les composants
  // doivent utiliser des classes Tailwind sémantiques (var(--color-*)).
  // Exclu : `components/ui/` (shadcn auto-généré), `email.service` (HTML d'email
  // — les clients mail n'ont pas accès aux variables CSS), `design-system/` et
  // `styles/` (la SOURCE des tokens).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/components/ui/**",
      "src/design-system/**",
      "src/styles/**",
      "src/lib/services/email.service.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message:
            "Couleur hex en dur interdite (US-2269 anti-drift). Importez `tokens` depuis @/design-system/tokens (charts/SVG) ou utilisez une classe Tailwind sémantique (var(--color-*)).",
        },
      ],
    },
  },
  // PROTOTYPE (US-2117 suite) — interdit le texte JSX brut hors i18n.
  // `mode: jsx-text-only` = uniquement le contenu textuel des balises (faible
  // bruit) ; en `warn` pour mesurer l'ampleur avant d'éventuellement gater la CI.
  // Exclut `components/ui` (shadcn) et `app/(patient)/loading|error` si besoin.
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/**"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "warn",
        {
          mode: "jsx-text-only",
          // Contenus non traduisibles : chemins/identifiants dans <code>/<pre>,
          // initiales d'avatar, etc.
          "jsx-components": { exclude: ["Trans", "code", "pre"] },
          words: {
            // Ignore les segments sans lettre (chiffres/ponctuation/séparateurs)
            // et les caractères uniques (initiales d'avatar « D », « M »…).
            // Notation statistique de percentiles AGP (P10/P25/P50/P75/P90) :
            // exception documentée CLAUDE.md (laissée telle quelle, identique 3 langues).
            exclude: ["^[\\s\\d!-/:-@[-`{-~]+$", "^.$", "^P(10|25|50|75|90)$"],
          },
        },
      ],
    },
  },
]);

export default eslintConfig;
