import path from "node:path"
import { defineConfig } from "prisma/config"

const dbUrl = process.env.DATABASE_URL
const shadowDbUrl = process.env.SHADOW_DATABASE_URL

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
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
})
