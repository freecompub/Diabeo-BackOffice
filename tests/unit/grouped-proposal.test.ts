/**
 * US-2663 (S0) — Typage de la disposition GROUPÉE (`src/lib/insulin/grouped-proposal.ts`).
 *
 * Vérifie la FORME (pas les bornes cliniques, validées ailleurs) des jeux de créneaux par levier :
 * l'encodage de chaque levier est stable et le mauvais encodage est rejeté (garde anti-JSON corrompu
 * avant que S1/S3 ne consomment ces payloads). Socle typé du basculement moteur (S3) et de la voie
 * manuelle groupée (S4) — testé dès S0 même si seuls ISF/ICR sont émis aujourd'hui.
 */
import { describe, it, expect } from "vitest"
import {
  isfIcrSlotSchema,
  pumpBasalSlotSchema,
  styloBasalSlotSchema,
  fixedDoseSlotSchema,
  groupedSlotsSchema,
} from "@/lib/insulin/grouped-proposal"

describe("grouped-proposal — schémas de forme par levier", () => {
  it("ISF/ICR : accepte { startHour, endHour, value, mealLabel? } ; rejette une heure hors [0,23]", () => {
    expect(isfIcrSlotSchema.safeParse({ startHour: 8, endHour: 22, value: 0.5 }).success).toBe(true)
    expect(isfIcrSlotSchema.safeParse({ startHour: 8, endHour: 22, value: 10, mealLabel: "midi" }).success).toBe(true)
    expect(isfIcrSlotSchema.safeParse({ startHour: 24, endHour: 22, value: 0.5 }).success).toBe(false)
    expect(isfIcrSlotSchema.safeParse({ startHour: 8, endHour: 22, value: 0 }).success).toBe(false) // positive
    expect(isfIcrSlotSchema.safeParse({ startHour: 8, endHour: 22 }).success).toBe(false) // value requise
  })

  it("basale POMPE : accepte { startTime HH:MM, endTime, rate } ; rejette un format horaire invalide", () => {
    expect(pumpBasalSlotSchema.safeParse({ startTime: "06:00", endTime: "22:30", rate: 0.85 }).success).toBe(true)
    expect(pumpBasalSlotSchema.safeParse({ startTime: "6:00", endTime: "22:30", rate: 0.85 }).success).toBe(false)
    expect(pumpBasalSlotSchema.safeParse({ startTime: "24:00", endTime: "22:30", rate: 0.85 }).success).toBe(false)
    expect(pumpBasalSlotSchema.safeParse({ startTime: "06:00", endTime: "22:30", rate: -1 }).success).toBe(false) // nonnegative
  })

  it("basale STYLO : accepte { kind ∈ daily/morning/evening, value } ; rejette un kind inconnu", () => {
    expect(styloBasalSlotSchema.safeParse({ kind: "daily", value: 20 }).success).toBe(true)
    expect(styloBasalSlotSchema.safeParse({ kind: "morning", value: 12 }).success).toBe(true)
    expect(styloBasalSlotSchema.safeParse({ kind: "noon", value: 12 }).success).toBe(false)
  })

  it("dose fixe : accepte { usage, moment ∈ morning/noon/evening/night, value } ; rejette moment/usage inconnu ou usage manquant", () => {
    expect(fixedDoseSlotSchema.safeParse({ usage: "bolus", moment: "noon", value: 4 }).success).toBe(true)
    expect(fixedDoseSlotSchema.safeParse({ usage: "basal", moment: "evening", value: 20 }).success).toBe(true)
    expect(fixedDoseSlotSchema.safeParse({ usage: "bolus", moment: "midnight", value: 4 }).success).toBe(false) // moment inconnu
    expect(fixedDoseSlotSchema.safeParse({ usage: "mixed", moment: "noon", value: 4 }).success).toBe(false) // usage hors enum
    expect(fixedDoseSlotSchema.safeParse({ moment: "noon", value: 4 }).success).toBe(false) // usage manquant (S3d — clé (usage,moment))
  })

  it("groupedSlotsSchema : route vers le bon schéma de tableau par parameterType", () => {
    expect(groupedSlotsSchema("insulinSensitivityFactor").safeParse([{ startHour: 0, endHour: 24, value: 0.5 }]).success).toBe(false) // endHour 24 hors forme
    expect(groupedSlotsSchema("insulinToCarbRatio").safeParse([{ startHour: 0, endHour: 12, value: 10 }]).success).toBe(true)
    expect(groupedSlotsSchema("fixedDose").safeParse([{ usage: "bolus", moment: "morning", value: 6 }]).success).toBe(true)
    // basalRate accepte l'union pompe|stylo (discriminée par la présence de startTime vs kind).
    expect(groupedSlotsSchema("basalRate").safeParse([{ startTime: "06:00", endTime: "22:00", rate: 0.8 }]).success).toBe(true)
    expect(groupedSlotsSchema("basalRate").safeParse([{ kind: "evening", value: 18 }]).success).toBe(true)
    // Jeu vide = forme valide (rejeté en aval par les gardes de couverture/bornes, contrat stable).
    expect(groupedSlotsSchema("insulinSensitivityFactor").safeParse([]).success).toBe(true)
  })
})
