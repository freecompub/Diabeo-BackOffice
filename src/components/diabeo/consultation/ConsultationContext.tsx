"use client"

/**
 * US-2018b — Contexte de consultation patient éphémère.
 *
 * Tient l'état « un patient est ouvert dans le workspace » et la **référence
 * éphémère** (`cTok`) émise par le serveur. Aucune donnée n'est persistée :
 * `cTok` ne vit qu'en mémoire (pas de localStorage / cookie non-httpOnly,
 * interdits CLAUDE.md). Au close / refresh / unload, le jeton est détruit côté
 * serveur (`/api/consultation/close`, best-effort `sendBeacon`) et perdu côté
 * client — non rejouable, non partageable (aucun id dans l'URL).
 *
 * Le `ConsultationProvider` rend l'app dans un wrapper `inert` quand une
 * consultation est ouverte (sidebar + header neutralisés) et monte le drawer
 * par-dessus.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { PatientConsultationDrawer } from "./PatientConsultationDrawer"

/** Données d'identification déjà visibles dans la liste — passées à l'ouverture
 * pour afficher l'en-tête du drawer sans aller-retour serveur. */
export interface ConsultationPatient {
  publicRef: string
  name: string
  pathology: "DT1" | "DT2" | "GD"
  age: number | null
}

interface ConsultationState {
  /** Patient courant (identité d'affichage), ou null si fermé. */
  patient: ConsultationPatient | null
  /** Jeton éphémère pour les appels de données (en-tête `x-consultation-token`). */
  cTok: string | null
  /** Drawer en plein écran (bouton « Agrandir »). */
  expanded: boolean
  /** Erreur d'ouverture (patient inaccessible, réseau…). */
  error: string | null
  opening: boolean
  open: (patient: ConsultationPatient) => Promise<void>
  close: () => void
  toggleExpanded: () => void
}

const ConsultationContext = createContext<ConsultationState | null>(null)

/** Hook d'accès au contexte. Lève si utilisé hors `ConsultationProvider`. */
export function useConsultation(): ConsultationState {
  const ctx = useContext(ConsultationContext)
  if (!ctx) throw new Error("useConsultation must be used within ConsultationProvider")
  return ctx
}

export function ConsultationProvider({ children }: { children: React.ReactNode }) {
  const [patient, setPatient] = useState<ConsultationPatient | null>(null)
  const [cTok, setCTok] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  // Conserve le dernier jeton dans une ref pour le beacon de fermeture au unload
  // (handler stable, lit la valeur courante sans recréer l'effet).
  const cTokRef = useRef<string | null>(null)
  cTokRef.current = cTok

  const close = useCallback(() => {
    const tok = cTokRef.current
    if (tok) {
      // Best-effort : invalide le jeton côté serveur. keepalive pour survivre
      // à une navigation immédiate.
      void fetch("/api/consultation/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ cTok: tok }),
      }).catch(() => {})
    }
    setPatient(null)
    setCTok(null)
    setExpanded(false)
    setError(null)
  }, [])

  const open = useCallback(
    async (next: ConsultationPatient) => {
      setError(null)
      setOpening(true)
      // Ferme proprement une éventuelle consultation précédente (single-active
      // est aussi garanti côté serveur).
      const prev = cTokRef.current
      if (prev) {
        void fetch("/api/consultation/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          keepalive: true,
          body: JSON.stringify({ cTok: prev }),
        }).catch(() => {})
      }
      try {
        const res = await fetch("/api/consultation/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ patientRef: next.publicRef }),
        })
        if (!res.ok) {
          setError("patientInaccessible")
          setOpening(false)
          return
        }
        const data = (await res.json()) as { cTok: string }
        setPatient(next)
        setCTok(data.cTok)
        setExpanded(false)
      } catch {
        setError("networkError")
      } finally {
        setOpening(false)
      }
    },
    [],
  )

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), [])

  // Fermeture clavier (Échap) quand le drawer est ouvert.
  useEffect(() => {
    if (!patient) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [patient, close])

  // Destruction du jeton au déchargement de la page (refresh / navigation
  // externe) : `sendBeacon` survit au unload.
  useEffect(() => {
    const onPageHide = () => {
      const tok = cTokRef.current
      if (tok && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/consultation/close",
          new Blob([JSON.stringify({ cTok: tok })], { type: "application/json" }),
        )
      }
    }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [])

  const value = useMemo<ConsultationState>(
    () => ({ patient, cTok, expanded, error, opening, open, close, toggleExpanded }),
    [patient, cTok, expanded, error, opening, open, close, toggleExpanded],
  )

  const isOpen = patient !== null

  return (
    <ConsultationContext.Provider value={value}>
      {/* L'app entière (sidebar + header + contenu) devient inerte sous le
          drawer : ni focus clavier, ni clic. Le drawer est un frère, hors zone
          inerte, donc reste interactif. */}
      <div inert={isOpen ? true : undefined} className={isOpen ? "select-none" : undefined}>
        {children}
      </div>
      {isOpen && patient && cTok && (
        <PatientConsultationDrawer
          patient={patient}
          cTok={cTok}
          expanded={expanded}
          onClose={close}
          onToggleExpanded={toggleExpanded}
        />
      )}
    </ConsultationContext.Provider>
  )
}
