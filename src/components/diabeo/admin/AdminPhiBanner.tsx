/**
 * AdminPhiBanner — bandeau persistant rappel données personnelles ADMIN.
 *
 * Fix M4 round 1 review PR #461 (HSA M3) — sur écrans ADMIN affichant
 * PHI/PII patient déchiffré (email, firstname, lastname, NIRPP via futur
 * iter), rappel visuel "ne pas screenshoter / screen-share". Conformité
 * DPIA US-2148 (mesure organisationnelle RGPD Art. 32).
 *
 * Léger, peu intrusif (border + bg jaune doux), accessible (role="note"
 * + aria-label explicite).
 */
import { ShieldAlert } from "lucide-react"

export function AdminPhiBanner({
  message = "Données personnelles utilisateur — usage strictement administratif. Ne pas capturer ni partager l'écran.",
}: {
  message?: string
}) {
  return (
    <div
      role="note"
      aria-label="Avertissement confidentialité"
      className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs flex items-start gap-2"
    >
      <ShieldAlert className="size-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-amber-900">{message}</p>
    </div>
  )
}
