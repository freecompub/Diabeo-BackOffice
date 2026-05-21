/**
 * Preview — Dashboard médecin en style Swiss Modernism 2.0
 *
 * Route isolée pour comparer visuellement avec `/medecin` (style actuel
 * Sérénité Active). Aucun fetch — mock data inline pour focus design.
 *
 * Accès : `/preview/medecin-swiss`
 *
 * Note (2026-05-21) : Ce fichier est un prototype design, PAS du code
 * de production. À supprimer ou itérer après décision design system.
 */

import type { Metadata } from "next"
import { AlertCircle, ArrowUpRight, Calendar, Clock } from "lucide-react"
import {
  SwissPage,
  SwissHeader,
  SwissSection,
  SwissMetric,
  SwissDataRow,
  SWISS_TOKENS,
} from "@/components/diabeo/preview-swiss/swiss-layout"

export const metadata: Metadata = {
  title: "Diabeo — Prototype Swiss Modernism",
  robots: { index: false, follow: false },
}

// ── Mock data (pas de fetch — prototype design) ────────────────────

const MOCK_EMERGENCIES = [
  {
    id: 1,
    patient: "DT1-001",
    age: 34,
    type: "Hypoglycémie sévère",
    glucoseMgdl: 52,
    timeAgo: "il y a 3 min",
    severity: "critical" as const,
  },
  {
    id: 2,
    patient: "DT1-014",
    age: 28,
    type: "Hyperglycémie répétée",
    glucoseMgdl: 312,
    timeAgo: "il y a 17 min",
    severity: "warning" as const,
  },
  {
    id: 3,
    patient: "DT2-088",
    age: 62,
    type: "CGM signal perdu",
    glucoseMgdl: null,
    timeAgo: "il y a 1 h",
    severity: "warning" as const,
  },
]

const MOCK_APPOINTMENTS = [
  { id: 1, patient: "DT1-007", reason: "Titration basale", time: "09:30", duration: 30 },
  { id: 2, patient: "DT2-022", reason: "Consult post-hospi", time: "10:15", duration: 45 },
  { id: 3, patient: "GD-003", reason: "Suivi grossesse S28", time: "11:00", duration: 30 },
  { id: 4, patient: "DT1-014", reason: "Ajustement ICR", time: "14:00", duration: 30 },
]

const MOCK_PATIENTS_AT_RISK = [
  { id: 1, code: "DT1-031", tir: 42, hypos7d: 4, lastSync: "2 j", reason: "TIR < 50%" },
  { id: 2, code: "DT2-099", tir: 58, hypos7d: 1, lastSync: "8 h", reason: "Hypos répétées" },
  { id: 3, code: "DT1-118", tir: 71, hypos7d: 0, lastSync: "5 j", reason: "Silence > 5j" },
  { id: 4, code: "GD-015", tir: 65, hypos7d: 2, lastSync: "1 j", reason: "GMI ↑ 0.4%" },
  { id: 5, code: "DT1-007", tir: 81, hypos7d: 0, lastSync: "1 h", reason: "Variabilité > 36%" },
]

const MOCK_KPI = [
  { label: "Patients actifs", value: "142", unit: "", delta: "+8 vs S-1", deltaTone: "positive" as const },
  { label: "TIR moyen cabinet", value: "68", unit: "%", delta: "+2.1 pts", deltaTone: "positive" as const },
  { label: "Urgences ouvertes", value: "3", unit: "", delta: "-2 vs S-1", deltaTone: "positive" as const },
  { label: "Adhérence CGM", value: "82", unit: "%", delta: "-1.3 pts", deltaTone: "negative" as const },
]

// ── Page ───────────────────────────────────────────────────────────

export default function MedecinSwissPreviewPage() {
  return (
    <SwissPage>
      <SwissHeader
        title="Dashboard médecin"
        subtitle="Vue d'ensemble cabinet — urgences, consultations, adhérence. Mise à jour automatique toutes les 30 secondes."
        meta={
          <>
            <div>
              <div className="mb-1 text-neutral-500">Date</div>
              <div className="font-medium text-black">21 mai 2026</div>
            </div>
            <div>
              <div className="mb-1 text-neutral-500">Rôle</div>
              <div className="font-medium text-black">DOCTOR</div>
            </div>
            <div>
              <div className="mb-1 text-neutral-500">Sync</div>
              <div className="font-medium text-black">il y a 12 s</div>
            </div>
          </>
        }
      />

      {/* Section 1 — Urgences (asymétrique 7 cols) ─────────────────── */}
      <SwissSection
        number="01"
        title="Urgences en cours"
        description="Triées par sévérité clinique. Cliquer pour ouvrir la timeline patient."
      >
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 lg:col-span-7">
            <SwissDataRow
              isHeader
              cells={["Patient", "Type", "Glucose", "Délai", ""]}
            />
            {MOCK_EMERGENCIES.map((e) => (
              <SwissDataRow
                key={e.id}
                severity={e.severity}
                cells={[
                  <div key="p">
                    <div className="font-medium text-black">{e.patient}</div>
                    <div className="text-xs text-neutral-500">{e.age} ans</div>
                  </div>,
                  <div key="t" className="text-black">
                    {e.type}
                  </div>,
                  <div
                    key="g"
                    className={
                      e.severity === "critical"
                        ? "font-medium text-[#991B1B]"
                        : "font-medium text-[#F59E0B]"
                    }
                  >
                    {e.glucoseMgdl !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <AlertCircle
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {e.glucoseMgdl} mg/dL
                      </span>
                    ) : (
                      <span className="text-neutral-500">—</span>
                    )}
                  </div>,
                  <div key="d" className="text-neutral-600">
                    {e.timeAgo}
                  </div>,
                  <div key="a" className="text-right">
                    <ArrowUpRight
                      className="ml-auto h-4 w-4 text-neutral-400"
                      aria-hidden="true"
                    />
                  </div>,
                ]}
              />
            ))}
          </div>

          {/* Side panel : compteur visuel */}
          <aside
            className="col-span-12 lg:col-span-5"
            aria-label="Synthèse urgences"
          >
            <div className="grid grid-cols-2 gap-8">
              <SwissMetric label="Total ouvert" value="3" />
              <SwissMetric
                label="Critiques"
                value="1"
                delta="depuis 3 min"
                deltaTone="negative"
              />
              <SwissMetric label="En attente" value="2" />
              <SwissMetric
                label="Résolues 24h"
                value="11"
                delta="100% < 30 min"
                deltaTone="positive"
              />
            </div>
            <div
              className="mt-8 border-l-2 pl-4 text-sm text-neutral-700"
              style={{ borderLeftColor: SWISS_TOKENS.accent }}
            >
              Toutes les urgences sont traitées dans les délais cibles
              (cible SLO 30 min).
            </div>
          </aside>
        </div>
      </SwissSection>

      {/* Section 2 — RDV du jour (asymétrique 5 cols) ────────────────── */}
      <SwissSection
        number="02"
        title="Rendez-vous aujourd'hui"
        description="4 consultations. Prochain dans 12 minutes."
      >
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 lg:col-span-7">
            {MOCK_APPOINTMENTS.map((a, i) => (
              <div
                key={a.id}
                className="grid grid-cols-12 items-baseline gap-4 border-b border-black/10 py-5"
              >
                <div className="col-span-2 font-mono text-xs uppercase tracking-[0.12em] text-neutral-500">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="col-span-3">
                  <div className="text-lg font-medium tabular-nums tracking-tight">
                    {a.time}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {a.duration} min
                  </div>
                </div>
                <div className="col-span-4">
                  <div className="font-medium">{a.patient}</div>
                  <div className="text-xs text-neutral-500">{a.reason}</div>
                </div>
                <div className="col-span-3 text-right text-xs uppercase tracking-[0.1em] text-neutral-500">
                  Programmé
                </div>
              </div>
            ))}
          </div>

          <aside
            className="col-span-12 lg:col-span-5"
            aria-label="Synthèse RDV"
          >
            <div className="grid grid-cols-2 gap-8">
              <SwissMetric label="Aujourd'hui" value="4" />
              <SwissMetric label="Cette semaine" value="27" />
            </div>
            <div className="mt-8 flex items-center gap-3 text-sm text-neutral-700">
              <Clock className="h-4 w-4" aria-hidden="true" />
              <span>Prochain : 09:30 — Titration basale (DT1-007)</span>
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm text-neutral-700">
              <Calendar className="h-4 w-4" aria-hidden="true" />
              <span>Plage libre suivante : 13:00 (60 min)</span>
            </div>
          </aside>
        </div>
      </SwissSection>

      {/* Section 3 — Patients à suivre (full width tableau dense) ────── */}
      <SwissSection
        number="03"
        title="Patients à suivre"
        description="Heuristique : TIR < 65% sur 14 j, ou hypos répétées, ou silence > 5 j."
      >
        <SwissDataRow
          isHeader
          cells={[
            "Patient",
            "Motif",
            "TIR 14 j",
            "Hypos 7 j",
            "Dernière sync",
            "",
          ]}
        />
        {MOCK_PATIENTS_AT_RISK.map((p) => (
          <SwissDataRow
            key={p.id}
            cells={[
              <span key="c" className="font-medium">
                {p.code}
              </span>,
              <span key="r" className="text-neutral-700">
                {p.reason}
              </span>,
              <span
                key="t"
                className={
                  p.tir < 50
                    ? "font-medium text-[#991B1B]"
                    : p.tir < 70
                      ? "font-medium text-[#F59E0B]"
                      : "font-medium text-[#10B981]"
                }
              >
                {p.tir}%
              </span>,
              <span key="h" className="tabular-nums">
                {p.hypos7d}
              </span>,
              <span key="s" className="text-neutral-600">
                {p.lastSync}
              </span>,
              <ArrowUpRight
                key="a"
                className="ml-auto h-4 w-4 text-neutral-400"
                aria-hidden="true"
              />,
            ]}
          />
        ))}
      </SwissSection>

      {/* Section 4 — KPI cabinet 14j ───────────────────────────────── */}
      <SwissSection
        number="04"
        title="KPI cabinet — 14 derniers jours"
        description="Indicateurs agrégés non-PHI. Comparés à la semaine précédente."
      >
        <div className="grid grid-cols-12 gap-8">
          {MOCK_KPI.map((k, i) => (
            <div key={i} className="col-span-12 sm:col-span-6 lg:col-span-3">
              <SwissMetric
                label={k.label}
                value={k.value}
                unit={k.unit}
                delta={k.delta}
                deltaTone={k.deltaTone}
              />
            </div>
          ))}
        </div>
      </SwissSection>

      {/* Footer minimal ─────────────────────────────────────────────── */}
      <footer className="mt-24 border-t border-black/10 pt-8 text-xs text-neutral-500">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 lg:col-span-6">
            Diabeo Backoffice — prototype Swiss Modernism 2.0 ·
            <span className="ml-2">Non-PHI mock data</span>
          </div>
          <div className="col-span-12 lg:col-span-6 lg:text-right">
            Comparer : <span className="underline">/medecin</span> (production)
            ↔ <span className="underline">/preview/medecin-swiss</span> (ce
            prototype)
          </div>
        </div>
      </footer>
    </SwissPage>
  )
}
