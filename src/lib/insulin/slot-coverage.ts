/**
 * Analyse de couverture 24 h d'un ensemble de créneaux horaires (ISF/ICR/basal).
 *
 * Extrait de `treatment-view.ts` (US-2647) pour être réutilisable **hors des pages**
 * (services back : détection du mode de traitement, gating d'écriture) sans créer de
 * dépendance `lib → app`. Source de vérité unique de la définition « trou / chevauchement ».
 */

/** Résultat : la plage 24 h a-t-elle un trou (minute non couverte) / un chevauchement. */
export type SlotCoverage = { hasGap: boolean; hasOverlap: boolean }

/**
 * "Time" Prisma (`@db.Time`, sans TZ) → minutes dans [0,1440]. `null` si non parsable.
 * Utilisé pour convertir des créneaux basaux pompe (startTime/endTime) avant `analyzeSlotCoverage`.
 */
export function timeToMinutes(t: Date | string): number | null {
  const iso = typeof t === "string" ? t : t.toISOString()
  const m = /T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

const MINUTES_PER_DAY = 1440

/** Borne une valeur de minutes dans [0,1440]. */
const clampMin = (m: number): number => Math.min(Math.max(Math.round(m), 0), MINUTES_PER_DAY)

/**
 * Analyse la couverture sur 24 h d'intervalles `[start,end)` exprimés en minutes.
 * Les intervalles qui « passent minuit » (end ≤ start) sont découpés en deux.
 * Balayage minute par minute (≤ n × 1440) — robuste pour trou + chevauchement.
 *
 * NB : un intervalle `start === end` est traité comme dégénéré (longueur nulle)
 * et ignoré — y compris l'encodage « plein jour » `HH:00 → HH:00`.
 */
export function analyzeSlotCoverage(
  raw: { start: number; end: number }[],
): SlotCoverage {
  const segments: { start: number; end: number }[] = []
  for (const r of raw) {
    const s = clampMin(r.start)
    const e = clampMin(r.end)
    if (s === e) continue // créneau dégénéré → ignoré (ni trou ni chevauchement)
    if (e > s) {
      segments.push({ start: s, end: e })
    } else {
      segments.push({ start: s, end: MINUTES_PER_DAY })
      if (e > 0) segments.push({ start: 0, end: e })
    }
  }
  if (segments.length === 0) return { hasGap: false, hasOverlap: false }

  const cover = new Uint8Array(MINUTES_PER_DAY)
  let hasOverlap = false
  for (const seg of segments) {
    for (let m = seg.start; m < seg.end; m++) {
      if (cover[m]! > 0) hasOverlap = true
      cover[m]!++
    }
  }
  let hasGap = false
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    if (cover[m] === 0) {
      hasGap = true
      break
    }
  }
  return { hasGap, hasOverlap }
}
