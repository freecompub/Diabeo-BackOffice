/**
 * extractApiError — helper UI partagé pour mapper réponse HTTP error vers
 * message friendly + field-level details.
 *
 * Fix H1 round 1 review PR #459 — régression M3 PR #458. UI affichait
 * `HTTP ${status}` générique au lieu de lire `data.error` + `data.details`.
 *
 * Pattern : tous les services backend exposent erreurs typées via Zod safeParse
 * (404/409/422 avec `error: codeString` + optionnel `details: Record<field, errors[]>`).
 * Helper unifie le parsing + fallback générique.
 */

interface ApiErrorBody {
  error?: string
  field?: string
  details?: Record<string, string[] | undefined>
}

const ERROR_CODE_LABELS_FR: Record<string, string> = {
  // cabinet-settings.service
  notCabinetManager: "Accès refusé — vous n'êtes pas gestionnaire de ce cabinet.",
  cabinetNotFound: "Cabinet introuvable.",
  // sms.service
  cabinetNotFoundSms: "Cabinet SMS introuvable.",
  smsValidation: "Validation SMS échouée.",
  atLeastOneFieldRequired: "Au moins un champ requis.",
  // invoice.service (Fix PR #460 — codes US-2102/2108)
  invoiceNotFound: "Facture introuvable.",
  invoiceAccessDenied: "Accès facture refusé.",
  invoiceInvalidState: "État de la facture incompatible avec cette action.",
  invoiceConcurrency: "Conflit de modification — recharger la facture.",
  invoiceSequenceOverflow: "Séquence de facturation saturée — contacter l'équipe ops.",
  pdfNotGenerated: "PDF pas encore généré — émettre la facture d'abord.",
  pdfRenderFailed: "Erreur génération PDF — réessayer ou contacter l'équipe ops.",
  // génériques
  validationFailed: "Données invalides — vérifier les champs en rouge.",
  forbidden: "Accès refusé.",
  unauthorized: "Authentification requise.",
  notFound: "Ressource introuvable.",
  rateLimited: "Trop de requêtes — réessayer plus tard.",
  invalidJSON: "Requête malformée.",
  contentTypeRequired: "Content-Type application/json requis.",
  bodyTooLarge: "Charge utile trop volumineuse.",
}

const STATUS_FALLBACK_FR: Record<number, string> = {
  400: "Requête invalide.",
  401: "Authentification requise.",
  403: "Accès refusé.",
  404: "Ressource introuvable.",
  409: "Conflit — opération déjà en cours ou état incompatible.",
  422: "Données invalides — vérifier les champs.",
  429: "Trop de requêtes — réessayer plus tard.",
  500: "Erreur serveur — réessayer ou contacter l'équipe ops.",
  503: "Service temporairement indisponible.",
}

export interface ParsedApiError {
  /** Message principal lisible UI. */
  message: string
  /** Code erreur backend brut (debug / mapping i18n V2). */
  code?: string
  /** Champ ayant échoué la validation (422). Pour highlight UI aria-invalid. */
  field?: string
  /** Détails per-field si validationFailed Zod safeParse flatten. */
  details?: Record<string, string[] | undefined>
}

/**
 * Parse une réponse fetch !ok pour extraire un message UI lisible.
 *
 * @param res Response (!res.ok)
 * @returns ParsedApiError avec message friendly + code + détails
 */
export async function extractApiError(res: Response): Promise<ParsedApiError> {
  let body: ApiErrorBody | null = null
  try {
    body = (await res.json()) as ApiErrorBody
  } catch {
    body = null
  }
  const code = body?.error
  const codeMessage = code ? ERROR_CODE_LABELS_FR[code] : undefined
  const statusFallback = STATUS_FALLBACK_FR[res.status] ?? `Erreur (HTTP ${res.status})`
  return {
    message: codeMessage ?? statusFallback,
    code,
    field: body?.field,
    details: body?.details,
  }
}

/**
 * Helper sync — si on a déjà parsé le body. Utile pour tests.
 */
export function formatApiErrorCode(code: string | undefined, status: number): string {
  if (code && ERROR_CODE_LABELS_FR[code]) return ERROR_CODE_LABELS_FR[code]
  return STATUS_FALLBACK_FR[status] ?? `Erreur (HTTP ${status})`
}
