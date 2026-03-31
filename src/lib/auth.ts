import NextAuth from "next-auth"

/**
 * NextAuth v5 configuration placeholder.
 * TODO(Phase 1 — US-100): Add credentials provider, database adapter,
 * session strategy "database" (ADR #3), MFA support, and AUTH_SECRET.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [],
  session: {
    // TODO(Phase 1): Switch to "database" strategy with PostgreSQL adapter
    // as per ADR #3: "Sessions NextAuth en PostgreSQL — App stateless"
    strategy: "jwt",
  },
  callbacks: {
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      if (token.role) {
        session.user.role = token.role as typeof session.user.role
      }
      return session
    },
    jwt({ token, user }) {
      if (user) {
        token.role = user.role
      }
      return token
    },
  },
})
