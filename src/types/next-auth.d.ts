import type { DefaultSession, DefaultJWT } from "next-auth"
import type { Role } from "@prisma/client"

declare module "next-auth" {
  interface User {
    id: string
    role: Role
  }

  interface Session {
    user: {
      id: string
      role: Role
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role?: Role
    sub: string
  }
}
