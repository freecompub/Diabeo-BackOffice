/**
 * @module pdf/agp-report
 * @description US-2040 — Rapport AGP PDF.
 *
 * Génère un rapport AGP (Ambulatory Glucose Profile) en PDF à partir des
 * données calculées par `analyticsService.glycemicProfile` + `.agp`. Le
 * rendu reste volontairement minimaliste (pdf-lib pure JS) :
 * - en-tête + métadonnées patient (ID seul, pas de nom)
 * - bloc métriques (TIR, GMI, CV, capture rate)
 * - courbe AGP simplifiée (p25/p50/p75 sur 24h)
 * - barre TIR (couleurs ADA)
 *
 * Aucune donnée personnelle (nom, email) n'est intégrée — seul l'ID patient
 * technique apparaît. Le caller est responsable de l'audit `EXPORT`.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { glToMgdl, type AgpSlot, type TirResult } from "@/lib/statistics"

export type AgpReportInput = {
  patientId: number
  period: { from: string; to: string; days: number }
  metrics: {
    averageGlucoseMgdl: number
    gmi: number
    coefficientOfVariation: number
  }
  tir: TirResult
  captureRate: number
  readingCount: number
  agp: AgpSlot[]
  /** Optional clinical warning (e.g. "insufficientCgmCapture"). When set, a red
   *  banner is rendered above the metrics block to signal data unreliability. */
  warning?: string
}

const PAGE_W = 595 // A4 portrait, pt
const PAGE_H = 842
const MARGIN = 50

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color = rgb(0.12, 0.16, 0.22),
) {
  page.drawText(text, { x, y, size, font, color })
}

function drawTirBar(page: PDFPage, tir: TirResult, x: number, y: number, width: number, height: number) {
  const segments = [
    { pct: tir.severeHypo, color: rgb(0.5, 0.0, 0.0) },
    { pct: tir.hypo,       color: rgb(0.94, 0.27, 0.27) },
    { pct: tir.inRange,    color: rgb(0.06, 0.72, 0.51) },
    { pct: tir.elevated,   color: rgb(0.96, 0.62, 0.04) },
    { pct: tir.hyper,      color: rgb(0.86, 0.32, 0.05) },
  ]
  let offset = 0
  for (const seg of segments) {
    const w = (seg.pct / 100) * width
    if (w <= 0.5) continue
    page.drawRectangle({ x: x + offset, y, width: w, height, color: seg.color })
    offset += w
  }
  page.drawRectangle({
    x, y, width, height,
    borderColor: rgb(0.5, 0.5, 0.5),
    borderWidth: 0.5,
    color: undefined,
  })
}

function drawAgpCurve(
  page: PDFPage,
  agp: AgpSlot[],
  x: number,
  y: number,
  width: number,
  height: number,
  font: PDFFont,
) {
  // 96 slots over 24h. Y axis = mg/dL, clamp 40-400.
  const Y_MIN = 40
  const Y_MAX = 400
  const yOf = (mgdl: number) => {
    const clamped = Math.max(Y_MIN, Math.min(Y_MAX, mgdl))
    return y + ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * height
  }

  // Background grid (4-hour ticks)
  for (let h = 0; h <= 24; h += 4) {
    const gx = x + (h / 24) * width
    page.drawLine({
      start: { x: gx, y },
      end: { x: gx, y: y + height },
      thickness: 0.3,
      color: rgb(0.85, 0.85, 0.85),
    })
    drawText(page, `${h.toString().padStart(2, "0")}h`, gx - 8, y - 12, 7, font, rgb(0.4, 0.4, 0.4))
  }
  // Target range band (70-180 mg/dL)
  page.drawRectangle({
    x, y: yOf(70),
    width,
    height: yOf(180) - yOf(70),
    color: rgb(0.06, 0.72, 0.51),
    opacity: 0.12,
  })
  // Y-axis labels
  for (const v of [70, 180, 250]) {
    drawText(page, `${v}`, x - 22, yOf(v) - 3, 7, font, rgb(0.4, 0.4, 0.4))
  }

  // AGP values are in g/L — convert to mg/dL for Y axis.
  const mg = (gl: number) => (gl > 0 ? glToMgdl(gl) : 0)

  // p25-p75 band
  for (let i = 0; i < agp.length - 1; i++) {
    const s1 = agp[i]
    const s2 = agp[i + 1]
    if (s1.p25 <= 0 || s1.p75 <= 0) continue
    const x1 = x + (s1.timeMinutes / 1440) * width
    const x2 = x + (s2.timeMinutes / 1440) * width
    page.drawRectangle({
      x: x1,
      y: yOf(mg(s1.p25)),
      width: x2 - x1,
      height: yOf(mg(s1.p75)) - yOf(mg(s1.p25)),
      color: rgb(0.05, 0.58, 0.53),
      opacity: 0.25,
    })
  }
  // Median p50 line
  for (let i = 0; i < agp.length - 1; i++) {
    const s1 = agp[i]
    const s2 = agp[i + 1]
    if (s1.p50 <= 0 || s2.p50 <= 0) continue
    const x1 = x + (s1.timeMinutes / 1440) * width
    const x2 = x + (s2.timeMinutes / 1440) * width
    page.drawLine({
      start: { x: x1, y: yOf(mg(s1.p50)) },
      end:   { x: x2, y: yOf(mg(s2.p50)) },
      thickness: 1,
      color: rgb(0.05, 0.46, 0.42),
    })
  }
  // Frame
  page.drawRectangle({
    x, y, width, height,
    borderColor: rgb(0.5, 0.5, 0.5),
    borderWidth: 0.5,
    color: undefined,
  })
}

export async function generateAgpPdf(input: AgpReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_W, PAGE_H])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  let cursor = PAGE_H - MARGIN

  drawText(page, "Rapport AGP — Diabeo", MARGIN, cursor, 18, fontBold)
  cursor -= 22
  drawText(
    page,
    `Patient #${input.patientId}  -  Periode: ${input.period.from.slice(0, 10)} a ${input.period.to.slice(0, 10)}  (${input.period.days} jours)`,
    MARGIN,
    cursor,
    10,
    font,
    rgb(0.4, 0.4, 0.45),
  )
  cursor -= 14
  drawText(
    page,
    `Lectures CGM: ${input.readingCount}   ·   Capture: ${input.captureRate}%`,
    MARGIN,
    cursor,
    9,
    font,
    rgb(0.4, 0.4, 0.45),
  )

  // Clinical-safety warning banner (red rectangle + bold text) when the
  // caller flags data unreliability (e.g. capture rate < 70%). Drawn above
  // the metrics so a clinician cannot miss it.
  if (input.warning === "insufficientCgmCapture") {
    cursor -= 24
    page.drawRectangle({
      x: MARGIN, y: cursor - 4, width: PAGE_W - 2 * MARGIN, height: 22,
      color: rgb(0.94, 0.27, 0.27), opacity: 0.18,
      borderColor: rgb(0.94, 0.27, 0.27), borderWidth: 0.8,
    })
    drawText(
      page,
      "Donnees CGM insuffisantes (capture < 70%) - interpretation non fiable",
      MARGIN + 6, cursor + 4, 10, fontBold, rgb(0.78, 0.15, 0.15),
    )
  }

  // Metrics block
  cursor -= 30
  drawText(page, "Indicateurs clés", MARGIN, cursor, 12, fontBold)
  cursor -= 16
  const metrics = [
    ["Glucose moyen", `${input.metrics.averageGlucoseMgdl} mg/dL`],
    ["GMI (HbA1c estimée)", `${input.metrics.gmi} %`],
    ["Coefficient de variation", `${input.metrics.coefficientOfVariation} %`],
  ]
  for (const [label, value] of metrics) {
    drawText(page, label, MARGIN, cursor, 10, font)
    drawText(page, value, MARGIN + 200, cursor, 10, fontBold)
    cursor -= 14
  }

  // TIR bar
  cursor -= 14
  drawText(page, "Temps dans la cible (TIR)", MARGIN, cursor, 12, fontBold)
  cursor -= 18
  drawTirBar(page, input.tir, MARGIN, cursor, PAGE_W - 2 * MARGIN, 18)
  cursor -= 18
  drawText(
    page,
    `Cible: ${input.tir.inRange.toFixed(1)}%   ·   Hypo: ${(input.tir.hypo + input.tir.severeHypo).toFixed(1)}%   ·   Hyper: ${(input.tir.elevated + input.tir.hyper).toFixed(1)}%`,
    MARGIN,
    cursor,
    9,
    font,
    rgb(0.4, 0.4, 0.45),
  )

  // AGP curve
  cursor -= 40
  drawText(page, "Profil glycémique ambulatoire (p25 / médiane / p75)", MARGIN, cursor, 12, fontBold)
  cursor -= 180
  drawAgpCurve(page, input.agp, MARGIN + 30, cursor, PAGE_W - 2 * MARGIN - 30, 160, font)

  // Footer
  drawText(
    page,
    `Diabeo BackOffice — Document de support clinique. Ne se substitue pas à la décision médicale.`,
    MARGIN,
    MARGIN - 20,
    8,
    font,
    rgb(0.55, 0.55, 0.6),
  )

  return doc.save()
}
