/**
 * `/users` — alias legacy de `/admin/users` (anomalie A5).
 *
 * Cette route hébergeait un stub « Bientôt disponible » (US-2148) du temps où
 * l'UI d'administration des utilisateurs n'existait pas. La vraie UI est
 * désormais livrée à `/admin/users` (`UsersListClient` + `/admin/users/[id]`).
 *
 * La nav (`NavigationShell`) pointe maintenant directement vers `/admin/users` ;
 * cette page ne sert plus que de redirection pour les anciens liens / favoris.
 * Le contrôle d'accès (ADMIN-only) est assuré par `/admin/users`.
 */

import { redirect } from "next/navigation"

export default function UsersLegacyRedirect() {
  redirect("/admin/users")
}
