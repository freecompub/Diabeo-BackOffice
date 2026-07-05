"use client"

/**
 * US-2648b — Bandeau d'état d'édition de l'insulinothérapie (onglet Traitements).
 *
 * Affiche le **mode de traitement** + les messages d'état issus du capability
 * descriptor serveur (US-2648a), en portant les AC UI de la revue clinique :
 *  - config incohérente → « à revoir » + indice « corriger » si écriture directe possible ;
 *  - doses fixes → message honnête (« titration via le soignant ») ;
 *  - non-insuliné → note explicite.
 *
 * Purement présentational (aucun fetch, aucune valeur de dose) ; la décision
 * d'affichage vit dans {@link deriveBannerContent} (testée sans i18n). Les CTA
 * d'édition/proposition arrivent au slice suivant (formulaires US-2648b).
 */
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import type { InsulinEditCapability } from "@/lib/insulin/edit-capability"
import { deriveBannerContent } from "@/components/diabeo/patient/insulin-edit-banner"

/**
 * @param props.capability Capability descriptor du patient pour le rôle courant.
 */
export function InsulinEditBanner({ capability }: { capability: InsulinEditCapability }) {
  const t = useTranslations("patientDetail")
  const { modeKey, note, showRepairHint } = deriveBannerContent(capability)

  return (
    // `role="status"` implique déjà `aria-live="polite"` (annonce unique à l'apparition
    // asynchrone). Le badge porte un `aria-label` complet (libellé + valeur) pour associer
    // programmatiquement le libellé au mode (WCAG 1.3.1) ; le libellé visuel est décoratif.
    // Le sens RTL est géré par `dir=rtl` au niveau `<html>` (layout) — pas de flex-reverse.
    <div className="flex flex-col gap-2" role="status">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          {t("insulinModeLabel")}
        </span>
        <Badge variant="outline" aria-label={`${t("insulinModeLabel")} : ${t(modeKey)}`}>
          {t(modeKey)}
        </Badge>
      </div>

      {note === "incoherentConfig" && (
        <p className="text-sm text-warning-fg">
          {t("insulinConfigIncoherent")}
          {showRepairHint && <> {t("insulinConfigRepairHint")}</>}
        </p>
      )}
      {note === "fixedDoseTitration" && (
        <p className="text-sm text-muted-foreground">{t("insulinFixedDoseTitration")}</p>
      )}
      {note === "nonInsulin" && (
        <p className="text-sm text-muted-foreground">{t("insulinNonInsulinNote")}</p>
      )}
    </div>
  )
}
