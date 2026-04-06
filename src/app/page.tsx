import { redirect } from "next/navigation"

/**
 * Root page — redirects to login.
 * Authenticated users will be redirected to /dashboard by the login page.
 */
export default function Home() {
  redirect("/login")
}
