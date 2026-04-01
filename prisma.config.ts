import path from "node:path"
import { defineConfig } from "prisma/config"

const dbUrl = process.env.DATABASE_URL

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  ...(dbUrl ? { datasource: { url: dbUrl } } : {}),
})
