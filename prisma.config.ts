import path from "node:path"
import { defineConfig } from "prisma/config"
import { config as loadDotenv } from "dotenv"

// Prisma 7 — quand `prisma.config.ts` est présent, le CLI ne charge plus `.env`
// automatiquement. On le fait explicitement ici pour que `prisma migrate deploy`,
// `prisma db seed`, etc. trouvent `DATABASE_URL` & co en local et CI.
//
// En prod / VPS, les env vars sont injectées par le shell qui invoque le CLI
// donc le fichier `.env` peut être absent — `loadDotenv` no-op dans ce cas.
//
// M5 — `process.cwd()` au lieu de `__dirname` : ESM-safe. `__dirname` est
// injecté par jiti en mode CJS aujourd'hui mais throw `ReferenceError` si le
// repo passe à `"type": "module"` plus tard. Prisma invoque toujours le CLI
// depuis la racine projet, donc cwd === dirname de prisma.config.ts.
loadDotenv({ path: path.join(process.cwd(), ".env") })

const dbUrl = process.env.DATABASE_URL
const shadowDbUrl = process.env.SHADOW_DATABASE_URL

export default defineConfig({
  schema: path.join(process.cwd(), "prisma", "schema.prisma"),
  // US-2267 — Shadow DB requise par `prisma migrate diff --from-migrations`
  // (utilisée par le check de drift en CI). Optionnelle en dev où `migrate dev`
  // crée et nettoie sa propre shadow DB.
  ...(dbUrl
    ? {
        datasource: {
          url: dbUrl,
          ...(shadowDbUrl && { shadowDatabaseUrl: shadowDbUrl }),
        },
      }
    : {}),
  // Prisma 7 — la config `package.json#prisma.seed` (legacy) est ignorée.
  // Le seed doit être déclaré ici via `migrations.seed`.
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
})
