/**
 * lint-design-system.mjs — Lint anti-dérive du design system Diabeo.
 *
 * Détecte les usages de Tailwind brut par numéro (hors palette Diabeo),
 * les CSS vars en arbitrary-value, et les hex hardcodés dans les fichiers TSX/TS.
 *
 * Usage :
 *   node scripts/lint-design-system.mjs
 *
 * Exit 0 : nombre de violations ≤ BASELINE_VIOLATIONS
 * Exit 1 : nombre de violations > BASELINE_VIOLATIONS (régression)
 *
 * La baseline est fixée au nombre de violations existantes au moment de
 * l'introduction du script — cela permet de ne pas bloquer les merges en cours
 * tout en empêchant toute régression future.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// ─── Baseline ────────────────────────────────────────────────────────────────
// Baseline établie au 2026-06-12 (premier run post-migration PR #536 = 296),
// ratchetée à 285 après migration des palettes feedback de /analytics vers
// les tokens sémantiques (success/warning/error), puis à 272 après nettoyage
// des classes brutes (amber/teal/gray) du dashboard patient.
// Le script ratchet : `process.exit(1)` aussi quand violations < baseline,
// avec un message demandant de mettre à jour la constante. Le diff PR
// verrouille le gain dans l'historique git.
const BASELINE_VIOLATIONS = 268

// ─── Configuration ───────────────────────────────────────────────────────────

// Résolution des chemins ancrée sur la POSITION DU SCRIPT (pas le cwd) — sans
// quoi un run depuis un sous-dossier (Husky monorepo, lint-staged custom)
// casse les exclusions. `import.meta.url` est l'URL du script .mjs.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..")
const SRC_ROOT = path.join(REPO_ROOT, "src")

/**
 * Dossiers et fichiers exclus du lint.
 * - components/ui/      : shadcn/ui auto-généré — non modifiable
 * - design-system/      : source de vérité des tokens (hex intentionnels)
 * - styles/             : CSS tokens source — hex intentionnels
 * - services/email.service.ts : HTML email inline — palette forcée
 * - *.css               : les arbitrary-value CSS vars sont légitimes dans les CSS
 */
const EXCLUDED_DIRS = new Set([
  path.join(SRC_ROOT, "components", "ui"),
  path.join(SRC_ROOT, "design-system"),
  path.join(SRC_ROOT, "styles"),
])

const EXCLUDED_FILES = new Set([
  path.join(SRC_ROOT, "lib", "services", "email.service.ts"),
])

// Extensions auditées
const AUDITED_EXTENSIONS = new Set([".tsx", ".ts"])

// ─── Patterns interdits ───────────────────────────────────────────────────────

/**
 * Pattern 1 : Tailwind brut par numéro hors palette Diabeo.
 * Palettes bloquées : tout sauf `teal`, `coral`, `ink`, `primary`, `secondary`,
 * `feedback-*`, `glycemia-*`, `tir-*`.
 *
 * On cible les prefixes utilitaires Tailwind : bg-, text-, border-, ring-,
 * divide-, outline-, from-, to-, via-.
 */
const TAILWIND_BLOCKED_PALETTES = [
  "red", "blue", "green", "yellow", "purple", "pink", "gray",
  "slate", "zinc", "neutral", "stone", "orange", "amber", "emerald",
  "lime", "sky", "cyan", "indigo", "violet", "fuchsia", "rose",
]

const TAILWIND_PREFIXES = [
  "bg", "text", "border", "ring", "divide", "outline", "from", "to", "via",
]

// Construit le regex : \b(bg|text|...)-(?:red|blue|...)-\d+\b
const tailwindPattern = new RegExp(
  `\\b(${TAILWIND_PREFIXES.join("|")})-(?:${TAILWIND_BLOCKED_PALETTES.join("|")})-\\d+\\b`,
  "g",
)

/**
 * Pattern 2 : CSS vars en arbitrary-value Tailwind dans les fichiers TSX/TS.
 * Ex : une classe "bg-" avec arbitrary-value "var(--color-NAME)" entre crochets
 * — à remplacer par une classe Tailwind sémantique.
 * NB : ne PAS écrire l'exemple sous forme de classe complète littérale ici —
 * Tailwind v4 scanne ce fichier et génèrerait du CSS invalide à partir d'un
 * placeholder comme "...".
 */
const cssVarArbitraryPattern = /\[var\(--color-/g

/**
 * Pattern 3 : Hex 6 chars hardcodés dans les fichiers TSX/TS.
 * Ex: "#0D9488", "#FEE2E2"
 * Exceptions :
 * - Lignes contenant `// pas d'équivalent token` (commentaire d'exclusion explicite)
 * - Lignes contenant `withAlpha(` (usage intentionnel via helper token-safe)
 */
const hexPattern = /#[0-9a-fA-F]{6}\b/g

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Retourne true si le chemin absolu est exclu du lint.
 */
function isExcluded(filePath) {
  // Vérifier exclusions par dossier
  for (const dir of EXCLUDED_DIRS) {
    if (filePath.startsWith(dir + path.sep) || filePath.startsWith(dir + "/")) {
      return true
    }
  }
  // Vérifier exclusions par fichier exact
  if (EXCLUDED_FILES.has(filePath)) return true
  // Exclure les fichiers .css (pattern 2 légal)
  if (filePath.endsWith(".css")) return true
  return false
}

/**
 * Liste récursivement tous les fichiers d'un dossier.
 * Skip les dossiers exclus AVANT de descendre — sans quoi on parse les ~500
 * fichiers shadcn `components/ui/` pour les jeter après (perte ~2×).
 */
function walkDir(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Ignorer node_modules, .next, graphify-out
      if (["node_modules", ".next", ".git", "graphify-out"].includes(entry.name)) continue
      // Skip directly les dossiers exclus
      if (EXCLUDED_DIRS.has(fullPath)) continue
      walkDir(fullPath, files)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (AUDITED_EXTENSIONS.has(ext)) {
        files.push(fullPath)
      }
    }
  }
  return files
}

/**
 * Analyse un fichier et retourne ses violations.
 */
function lintFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8")
  const lines = content.split("\n")
  const violations = []
  const rel = path.relative(process.cwd(), filePath)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Pattern 1 : Tailwind brut par numéro
    tailwindPattern.lastIndex = 0
    let m
    while ((m = tailwindPattern.exec(line)) !== null) {
      violations.push({
        file: rel,
        line: lineNum,
        col: m.index + 1,
        rule: "tailwind-raw-palette",
        match: m[0],
        context: line.trim(),
      })
    }

    // Pattern 2 : CSS vars en arbitrary-value
    cssVarArbitraryPattern.lastIndex = 0
    while ((m = cssVarArbitraryPattern.exec(line)) !== null) {
      violations.push({
        file: rel,
        line: lineNum,
        col: m.index + 1,
        rule: "css-var-arbitrary",
        match: line.slice(m.index, m.index + 20) + "…",
        context: line.trim(),
      })
    }

    // Pattern 3 : Hex hardcodé — sauf exceptions
    // Skip si la ligne contient un commentaire d'exclusion explicite
    if (
      line.includes("// pas d'équivalent token") ||
      line.includes("withAlpha(") ||
      line.trimStart().startsWith("//") ||
      line.trimStart().startsWith("*")
    ) {
      continue
    }
    hexPattern.lastIndex = 0
    while ((m = hexPattern.exec(line)) !== null) {
      violations.push({
        file: rel,
        line: lineNum,
        col: m.index + 1,
        rule: "hex-hardcoded",
        match: m[0],
        context: line.trim(),
      })
    }
  }

  return violations
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const allFiles = walkDir(SRC_ROOT).filter((f) => !isExcluded(f))

const allViolations = []
for (const file of allFiles) {
  const v = lintFile(file)
  allViolations.push(...v)
}

if (allViolations.length > BASELINE_VIOLATIONS) {
  console.error(
    `\x1b[31m❌ Design system : ${allViolations.length} violation(s) (baseline = ${BASELINE_VIOLATIONS})\x1b[0m`,
  )
  allViolations.forEach((v) => {
    console.error(`  \x1b[33m${v.file}:${v.line}:${v.col}\x1b[0m  [${v.rule}]  ${v.match}`)
    console.error(`    → ${v.context}`)
  })
  process.exit(1)
} else if (allViolations.length < BASELINE_VIOLATIONS) {
  // Ratchet — quand on supprime des violations, on FORCE la baseline à
  // descendre via un échec explicite. Sans ça, la baseline reste figée
  // indéfiniment et un futur dev peut réintroduire des violations
  // supprimées sans alarme (cf. code review pass 3, finding #2).
  //
  // Le contributeur doit éditer ce fichier pour amener BASELINE_VIOLATIONS
  // à la nouvelle valeur basse — le diff est visible en PR, donc le gain
  // est consigné dans l'historique git.
  console.error(
    `\x1b[33m⚠️  Design system : ${allViolations.length} violation(s) < baseline ${BASELINE_VIOLATIONS}.\x1b[0m`,
  )
  console.error(
    `\x1b[33m   Le nombre de violations a diminué — c'est bien ! Mais la baseline\x1b[0m`,
  )
  console.error(
    `\x1b[33m   doit être mise à jour pour verrouiller ce gain. Édite :\x1b[0m`,
  )
  console.error(
    `\x1b[33m     scripts/lint-design-system.mjs → BASELINE_VIOLATIONS = ${allViolations.length}\x1b[0m`,
  )
  process.exit(1)
} else {
  console.log(
    `\x1b[32m✅ Design system OK : ${allViolations.length} violation(s) (= baseline ${BASELINE_VIOLATIONS})\x1b[0m`,
  )
  process.exit(0)
}
