import NextAuth from "next-auth"

/**
 * NextAuth v5 configuration placeholder.
 * To be completed in Phase 1 (US-100) with credentials provider, JWT, RBAC.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [],
  callbacks: {
    session({ session, token }) {
      if (token?.sub) {
        (session.user as { id?: string }).id = token.sub
      }
      if (token?.role) {
        (session.user as { role?: string }).role = token.role as string
      }
      return session
    },
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role
      }
      return token
    },
  },
})
