import {
  PrismaClient,
  Pathology,
  Role,
  Language,
  Sex,
  InsulinDeliveryMethod,
  BasalConfigType,
  GlucoseTargetPreset,
  DayMomentType,
} from "@prisma/client"
import { createHmac } from "crypto"

const prisma = new PrismaClient()

// ─── Deterministic PRNG (seeded LCG) ──────────────────────
// Seed data must be reproducible for snapshot tests.
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

// ─── HMAC helper for email lookup index ────────────────────
// In production, HMAC_SECRET comes from env. For seeds, use a fixed key.
const HMAC_KEY = process.env.HMAC_SECRET ?? "dev-seed-hmac-key-not-for-production"
function hmacEmail(email: string): string {
  return createHmac("sha256", HMAC_KEY).update(email).digest("hex")
}

// ─── Time helper ───────────────────────────────────────────
const t = (h: number, m: number) =>
  new Date(`1970-01-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`)

async function main() {
  console.log("Seeding database...")

  // ─── 0. Insulin Catalog (17 insulines) ────────────────────
  // Reference data — pharmacokinetic properties from FDA/EMA labeling.
  // Sources: Heise et al. (Diabetes Obes Metab 2017), FDA prescribing information.

  // All values are PHARMACODYNAMIC (glucose-lowering effect), not pharmacokinetic (serum levels).
  // Rapides/ultra-rapides : durée la plus COURTE de la plage documentée (sécurité IOB).
  // Basales/longue durée : durée la plus LONGUE de la plage documentée (couverture maximale).
  // Sources : FDA DailyMed (NDA labels), Endotext Table 3 (NCBI NBK278938), Vidal.
  const insulinCatalog = [
    // Ultra-rapide — Fiasp FDA NDA 208751: PD onset 16-20min, PD peak 91-133min, duration 5-7h
    //                Lyumjev FDA NDA 761109: PD onset 15-17min, PD peak 120-174min, duration 4.6-7.3h
    { displayName: "Fiasp", genericName: "insulin aspart (with niacinamide)", typicalOnsetMinutes: 16, typicalPeakMinutes: 91, typicalDurationHours: 5.0, isFasterActing: true, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 2017, manufacturer: "Novo Nordisk" },
    { displayName: "Lyumjev", genericName: "insulin lispro-aabc", typicalOnsetMinutes: 15, typicalPeakMinutes: 120, typicalDurationHours: 4.6, isFasterActing: true, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 2020, manufacturer: "Eli Lilly" },
    // Rapide — Endotext Table 3: lispro onset 23-27min peak 1-2h duration ~5h,
    //          aspart onset 21min peak 1-3h duration ~5h, glulisine onset 15-30min peak 0.5-1h duration ~4h
    //          Vidal: onset 5-15min, pic 1-3h, durée 3-5h
    { displayName: "Humalog", genericName: "insulin lispro", typicalOnsetMinutes: 15, typicalPeakMinutes: 90, typicalDurationHours: 3.0, isFasterActing: false, isTraditionalRapidActing: true, isLongActing: false, approvalYear: 1996, manufacturer: "Eli Lilly" },
    { displayName: "NovoRapid", genericName: "insulin aspart", typicalOnsetMinutes: 15, typicalPeakMinutes: 90, typicalDurationHours: 3.0, isFasterActing: false, isTraditionalRapidActing: true, isLongActing: false, approvalYear: 2000, manufacturer: "Novo Nordisk" },
    { displayName: "Apidra", genericName: "insulin glulisine", typicalOnsetMinutes: 15, typicalPeakMinutes: 60, typicalDurationHours: 3.0, isFasterActing: false, isTraditionalRapidActing: true, isLongActing: false, approvalYear: 2004, manufacturer: "Sanofi" },
    // Régulière — Endotext Table 3: onset ~1h, peak 2-4h, duration 5-8h
    { displayName: "Humulin R", genericName: "regular human insulin", typicalOnsetMinutes: 30, typicalPeakMinutes: 150, typicalDurationHours: 5.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 1982, manufacturer: "Eli Lilly" },
    { displayName: "Actrapid", genericName: "regular human insulin", typicalOnsetMinutes: 30, typicalPeakMinutes: 150, typicalDurationHours: 5.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 1991, manufacturer: "Novo Nordisk" },
    // Intermédiaire (NPH) — Endotext Table 3: onset 1-2h, peak 4-10h, duration 14h+
    //                        Basales → durée la plus longue → 24h
    { displayName: "Humulin N", genericName: "NPH human insulin (isophane)", typicalOnsetMinutes: 90, typicalPeakMinutes: 420, typicalDurationHours: 24.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 1982, manufacturer: "Eli Lilly" },
    { displayName: "Insulatard", genericName: "NPH human insulin (isophane)", typicalOnsetMinutes: 90, typicalPeakMinutes: 420, typicalDurationHours: 24.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 1991, manufacturer: "Novo Nordisk" },
    // Longue durée — Lantus FDA: onset 1.5h, peakless, duration ~24h
    { displayName: "Lantus", genericName: "insulin glargine U-100", typicalOnsetMinutes: 90, typicalPeakMinutes: null, typicalDurationHours: 24.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: true, approvalYear: 2000, manufacturer: "Sanofi" },
    // Toujeo FDA: onset 6h, peakless, serum detectable beyond 36h → durée longue 36h
    { displayName: "Toujeo", genericName: "insulin glargine U-300", typicalOnsetMinutes: 360, typicalPeakMinutes: null, typicalDurationHours: 36.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: true, approvalYear: 2015, manufacturer: "Sanofi" },
    // Levemir — Endotext: onset 3-4h, peak 6-8h, duration up to 20-24h → longue 24h
    { displayName: "Levemir", genericName: "insulin detemir", typicalOnsetMinutes: 180, typicalPeakMinutes: 420, typicalDurationHours: 24.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: true, approvalYear: 2004, manufacturer: "Novo Nordisk" },
    // Tresiba FDA NDA 203314: onset 1h, peakless (GIRmax median 12h), duration ≥42h
    { displayName: "Tresiba", genericName: "insulin degludec", typicalOnsetMinutes: 60, typicalPeakMinutes: null, typicalDurationHours: 42.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: true, approvalYear: 2013, manufacturer: "Novo Nordisk" },
    // Basaglar — biosimilaire Lantus, PK/PD identique
    { displayName: "Basaglar", genericName: "insulin glargine U-100 (biosimilar)", typicalOnsetMinutes: 90, typicalPeakMinutes: null, typicalDurationHours: 24.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: true, approvalYear: 2015, manufacturer: "Eli Lilly" },
    // Pré-mélangées — profil biphasique, durée longue (composante protamine) → 22-24h
    { displayName: "Humalog Mix 25", genericName: "insulin lispro 25% / lispro protamine 75%", typicalOnsetMinutes: 15, typicalPeakMinutes: 120, typicalDurationHours: 22.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 1999, manufacturer: "Eli Lilly" },
    { displayName: "NovoMix 30", genericName: "insulin aspart 30% / aspart protamine 70%", typicalOnsetMinutes: 15, typicalPeakMinutes: 120, typicalDurationHours: 24.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 2000, manufacturer: "Novo Nordisk" },
    // Concentrée — durée longue (effet dépôt) → 24h
    { displayName: "Humulin R U-500", genericName: "regular human insulin concentrated", typicalOnsetMinutes: 30, typicalPeakMinutes: 240, typicalDurationHours: 24.0, isFasterActing: false, isTraditionalRapidActing: false, isLongActing: false, approvalYear: 1994, manufacturer: "Eli Lilly" },
  ]

  for (const insulin of insulinCatalog) {
    await prisma.insulinCatalog.upsert({
      where: { displayName: insulin.displayName },
      update: insulin,
      create: insulin,
    })
  }
  console.log(`  ✓ ${insulinCatalog.length} insulins seeded`)

  // ─── 1. Users (5) ─────────────────────────────────────────
  // NOTE: In production, firstname/lastname/email must be encrypted.
  // Seeds use plaintext for readability — this is dev-only data.

  const admin = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("admin@diabeo.test") },
    update: {},
    create: {
      email: "admin@diabeo.test",
      emailHmac: hmacEmail("admin@diabeo.test"),
      passwordHash: "$2b$10$placeholder_hash_never_real",
      title: "M.",
      firstname: "Admin",
      lastname: "Test",
      role: Role.ADMIN,
      language: Language.fr,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const doctor = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("docteur@diabeo.test") },
    update: {},
    create: {
      email: "docteur@diabeo.test",
      emailHmac: hmacEmail("docteur@diabeo.test"),
      passwordHash: "$2b$10$placeholder_hash_never_real",
      title: "Dr",
      firstname: "Sophie",
      lastname: "Martin",
      role: Role.DOCTOR,
      language: Language.fr,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const nurse = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("infirmiere@diabeo.test") },
    update: {},
    create: {
      email: "infirmiere@diabeo.test",
      emailHmac: hmacEmail("infirmiere@diabeo.test"),
      passwordHash: "$2b$10$placeholder_hash_never_real",
      title: "Mme",
      firstname: "Marie",
      lastname: "Dupont",
      role: Role.NURSE,
      language: Language.fr,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const patientUserDT1 = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("patient.dt1@diabeo.test") },
    update: {},
    create: {
      email: "patient.dt1@diabeo.test",
      emailHmac: hmacEmail("patient.dt1@diabeo.test"),
      passwordHash: "$2b$10$placeholder_hash_never_real",
      firstname: "Jean",
      lastname: "Durand",
      sex: Sex.M,
      birthday: new Date("1990-03-15"),
      timezone: "Europe/Paris",
      language: Language.fr,
      role: Role.VIEWER,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const patientUserDT2 = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("patient.dt2@diabeo.test") },
    update: {},
    create: {
      email: "patient.dt2@diabeo.test",
      emailHmac: hmacEmail("patient.dt2@diabeo.test"),
      passwordHash: "$2b$10$placeholder_hash_never_real",
      firstname: "Claire",
      lastname: "Bernard",
      sex: Sex.F,
      birthday: new Date("1975-08-22"),
      timezone: "Europe/Paris",
      language: Language.fr,
      role: Role.VIEWER,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  console.log("Users created:", {
    admin: admin.id,
    doctor: doctor.id,
    nurse: nurse.id,
    patientDT1: patientUserDT1.id,
    patientDT2: patientUserDT2.id,
  })

  // ─── 2. Unit preferences ──────────────────────────────────

  for (const userId of [admin.id, doctor.id, nurse.id, patientUserDT1.id, patientUserDT2.id]) {
    await prisma.userUnitPreferences.upsert({
      where: { userId },
      update: {},
      create: { userId, unitGlycemia: 4, unitWeight: 6, unitSize: 8, unitCarb: 2, unitHba1c: 10 },
    })
  }

  // ─── 3. Privacy settings ──────────────────────────────────

  for (const userId of [patientUserDT1.id, patientUserDT2.id]) {
    await prisma.userPrivacySettings.upsert({
      where: { userId },
      update: {},
      create: { userId, gdprConsent: true, consentDate: new Date(), shareWithProviders: true, shareWithResearchers: false },
    })
  }

  // ─── 4. Patients ──────────────────────────────────────────

  const patientDT1 = await prisma.patient.upsert({
    where: { userId: patientUserDT1.id },
    update: {},
    create: { userId: patientUserDT1.id, pathology: Pathology.DT1 },
  })

  const patientDT2 = await prisma.patient.upsert({
    where: { userId: patientUserDT2.id },
    update: {},
    create: { userId: patientUserDT2.id, pathology: Pathology.DT2 },
  })

  console.log("Patients created:", { dt1: patientDT1.id, dt2: patientDT2.id })

  // ─── 5. Medical data ──────────────────────────────────────

  await prisma.patientMedicalData.upsert({
    where: { patientId: patientDT1.id },
    update: {},
    create: {
      patientId: patientDT1.id, dt1: true, size: 178, yearDiag: 2010,
      insulin: true, insulinYear: 2010, insulinPump: true, tabac: false, alcool: false,
    },
  })

  await prisma.patientMedicalData.upsert({
    where: { patientId: patientDT2.id },
    update: {},
    create: {
      patientId: patientDT2.id, dt1: false, size: 165, yearDiag: 2018,
      insulin: true, insulinYear: 2020, insulinPump: false, tabac: false, alcool: false,
      riskWeight: true, riskCardio: true,
    },
  })

  // ─── 6. CGM & annex objectives ────────────────────────────

  for (const patientId of [patientDT1.id, patientDT2.id]) {
    await prisma.cgmObjective.upsert({
      where: { patientId },
      update: {},
      create: { patientId, veryLow: 0.54, low: 0.70, ok: 1.80, high: 2.50, titrLow: 0.70, titrHigh: 1.80 },
    })

    await prisma.annexObjective.upsert({
      where: { patientId },
      update: {},
      create: { patientId, objectiveHba1c: 7.0, objectiveWalk: 30 },
    })
  }

  // ─── 7. Insulin therapy settings (DT1 — pump) ────────────

  const settingsDT1 = await prisma.insulinTherapySettings.upsert({
    where: { patientId: patientDT1.id },
    update: {},
    create: {
      patientId: patientDT1.id,
      bolusInsulinBrand: "novorapid",
      insulinActionDuration: 4.0,
      deliveryMethod: InsulinDeliveryMethod.pump,
    },
  })

  await prisma.glucoseTarget.createMany({
    data: [
      {
        settingsId: settingsDT1.id, targetGlucose: 120,
        targetRangeLower: 0.70, targetRangeUpper: 1.80,
        preset: GlucoseTargetPreset.standard, isActive: true,
      },
    ],
    skipDuplicates: true,
  })

  await prisma.iobSettings.upsert({
    where: { settingsId: settingsDT1.id },
    update: {},
    create: { settingsId: settingsDT1.id, considerIob: true, actionDurationHours: 4.0 },
  })

  await prisma.extendedBolusSettings.upsert({
    where: { settingsId: settingsDT1.id },
    update: {},
    create: { settingsId: settingsDT1.id, enabled: false, immediatePercentage: 100 },
  })

  // ISF — 3 creneaux
  await prisma.insulinSensitivityFactor.createMany({
    data: [
      { settingsId: settingsDT1.id, startHour: 6, endHour: 12, startTime: t(6, 0), endTime: t(12, 0), sensitivityFactorGl: 0.30, sensitivityFactorMgdl: 30 },
      { settingsId: settingsDT1.id, startHour: 12, endHour: 22, startTime: t(12, 0), endTime: t(22, 0), sensitivityFactorGl: 0.50, sensitivityFactorMgdl: 50 },
      { settingsId: settingsDT1.id, startHour: 22, endHour: 6, startTime: t(22, 0), endTime: t(6, 0), sensitivityFactorGl: 0.60, sensitivityFactorMgdl: 60 },
    ],
    skipDuplicates: true,
  })

  // ICR — 2 creneaux
  await prisma.carbRatio.createMany({
    data: [
      { settingsId: settingsDT1.id, startHour: 6, endHour: 12, startTime: t(6, 0), endTime: t(12, 0), gramsPerUnit: 8.0, mealLabel: "Petit-dejeuner" },
      { settingsId: settingsDT1.id, startHour: 12, endHour: 6, startTime: t(12, 0), endTime: t(6, 0), gramsPerUnit: 12.0, mealLabel: "Dejeuner/Diner" },
    ],
    skipDuplicates: true,
  })

  // Basal configuration — pump with 4 slots (Time, not Timestamptz)
  const basalConfig = await prisma.basalConfiguration.upsert({
    where: { settingsId: settingsDT1.id },
    update: {},
    create: {
      settingsId: settingsDT1.id, configType: BasalConfigType.pump,
      insulinBrand: "novorapid", totalDailyDose: 18.6,
    },
  })

  await prisma.pumpBasalSlot.createMany({
    data: [
      { basalConfigId: basalConfig.id, startTime: t(0, 0), endTime: t(6, 0), rate: 0.65, durationHours: 6 },
      { basalConfigId: basalConfig.id, startTime: t(6, 0), endTime: t(12, 0), rate: 0.85, durationHours: 6 },
      { basalConfigId: basalConfig.id, startTime: t(12, 0), endTime: t(22, 0), rate: 0.75, durationHours: 10 },
      { basalConfigId: basalConfig.id, startTime: t(22, 0), endTime: t(0, 0), rate: 0.70, durationHours: 2 },
    ],
    skipDuplicates: true,
  })

  // ─── 8. Insulin therapy settings (DT2 — manual) ──────────

  const settingsDT2 = await prisma.insulinTherapySettings.upsert({
    where: { patientId: patientDT2.id },
    update: {},
    create: {
      patientId: patientDT2.id, bolusInsulinBrand: "humalog",
      basalInsulinBrand: "lantus", insulinActionDuration: 4.0,
      deliveryMethod: InsulinDeliveryMethod.manual,
    },
  })

  await prisma.glucoseTarget.createMany({
    data: [
      {
        settingsId: settingsDT2.id, targetGlucose: 130,
        targetRangeLower: 0.90, targetRangeUpper: 2.00,
        preset: GlucoseTargetPreset.elderly, isActive: true,
      },
    ],
    skipDuplicates: true,
  })

  await prisma.basalConfiguration.upsert({
    where: { settingsId: settingsDT2.id },
    update: {},
    create: {
      settingsId: settingsDT2.id, configType: BasalConfigType.single_injection,
      insulinBrand: "lantus", dailyDose: 22,
    },
  })

  // ─── 9. Healthcare team ───────────────────────────────────

  const service = await prisma.healthcareService.upsert({
    where: { name_establishment: { name: "Service Diabetologie", establishment: "CHU Paris Test" } },
    update: {},
    create: { name: "Service Diabetologie", establishment: "CHU Paris Test", city: "Paris", country: "FR" },
  })

  const memberDoctor = await prisma.healthcareMember.upsert({
    where: { name_serviceId: { name: "Dr Sophie Martin", serviceId: service.id } },
    update: {},
    create: { name: "Dr Sophie Martin", serviceId: service.id, userId: doctor.id },
  })

  await prisma.healthcareMember.upsert({
    where: { name_serviceId: { name: "Marie Dupont (IDE)", serviceId: service.id } },
    update: {},
    create: { name: "Marie Dupont (IDE)", serviceId: service.id, userId: nurse.id },
  })

  // Patient services & referent
  for (const patientId of [patientDT1.id, patientDT2.id]) {
    await prisma.patientService.upsert({
      where: { patientId_serviceId: { patientId, serviceId: service.id } },
      update: {},
      create: { patientId, serviceId: service.id, memberId: memberDoctor.id },
    })

    await prisma.patientReferent.upsert({
      where: { patientId },
      update: {},
      create: { patientId, proId: memberDoctor.id, serviceId: service.id },
    })
  }

  // ─── 10. CGM data — 30 days for DT1 (deterministic) ──────

  const rng = seededRandom(42)
  const now = new Date()
  const cgmData: { patientId: number; valueGl: number; timestamp: Date; isManual: boolean }[] = []

  for (let day = 0; day < 30; day++) {
    for (let reading = 0; reading < 288; reading++) {
      const ts = new Date(now)
      ts.setDate(ts.getDate() - day)
      ts.setHours(0, reading * 5, 0, 0)

      const hour = ts.getHours()
      let base = 1.20
      if (hour >= 7 && hour <= 9) base = 1.50
      if (hour >= 12 && hour <= 14) base = 1.40
      if (hour >= 19 && hour <= 21) base = 1.45
      if (hour >= 2 && hour <= 5) base = 1.00

      const noise = (rng() - 0.5) * 0.40
      const value = Math.max(0.40, Math.min(4.00, base + noise))

      cgmData.push({
        patientId: patientDT1.id,
        valueGl: Math.round(value * 10000) / 10000,
        timestamp: ts,
        isManual: false,
      })
    }
  }

  const BATCH_SIZE = 1000
  for (let i = 0; i < cgmData.length; i += BATCH_SIZE) {
    await prisma.cgmEntry.createMany({
      data: cgmData.slice(i, i + BATCH_SIZE),
      skipDuplicates: true,
    })
  }
  console.log(`CGM entries created: ${cgmData.length} readings (30 days)`)

  // ─── 11. Day moments (idempotent via @@unique) ────────────

  const moments: { userId: number; type: DayMomentType; startTime: Date; endTime: Date }[] = [
    { userId: patientUserDT1.id, type: DayMomentType.morning, startTime: t(6, 0), endTime: t(12, 0) },
    { userId: patientUserDT1.id, type: DayMomentType.noon, startTime: t(12, 0), endTime: t(14, 0) },
    { userId: patientUserDT1.id, type: DayMomentType.evening, startTime: t(18, 0), endTime: t(22, 0) },
    { userId: patientUserDT1.id, type: DayMomentType.night, startTime: t(22, 0), endTime: t(6, 0) },
  ]

  for (const m of moments) {
    await prisma.userDayMoment.upsert({
      where: { userId_type: { userId: m.userId, type: m.type } },
      update: {},
      create: m,
    })
  }

  // ─── 12. Unit definitions (reference data) ────────────────

  const units = [
    { unitCode: 1, category: "carb", unit: "CP", title: "Portions", precision: 0 },
    { unitCode: 2, category: "carb", unit: "g", title: "Grammes", precision: 0 },
    { unitCode: 3, category: "glycemia", unit: "g/L", title: "Grammes par litre", factor: 1.0, precision: 2 },
    { unitCode: 4, category: "glycemia", unit: "mg/dL", title: "Milligrammes par decilitre", factor: 100.0, precision: 0 },
    { unitCode: 5, category: "glycemia", unit: "mmol/L", title: "Millimoles par litre", factor: 55.5, precision: 2 },
    { unitCode: 6, category: "weight", unit: "kg", title: "Kilogrammes", precision: 1 },
    { unitCode: 7, category: "weight", unit: "lbs", title: "Livres", precision: 1 },
    { unitCode: 8, category: "size", unit: "cm", title: "Centimetres", precision: 0 },
    { unitCode: 9, category: "size", unit: "ft", title: "Pieds", precision: 2 },
    { unitCode: 10, category: "hba1c", unit: "%", title: "Pourcentage NGSP", precision: 1 },
    { unitCode: 11, category: "hba1c", unit: "mmol/mol", title: "IFCC", precision: 0 },
    { unitCode: 12, category: "ketones", unit: "mmol/L", title: "Millimoles par litre", precision: 1 },
    { unitCode: 13, category: "ketones", unit: "mg/dL", title: "Milligrammes par decilitre", precision: 0 },
    { unitCode: 14, category: "blood_pressure", unit: "mmHg", title: "Millimetres de mercure", precision: 0 },
    { unitCode: 15, category: "carb_exchange", unit: "g", title: "Grammes par echange", precision: 0 },
  ]

  for (const u of units) {
    await prisma.unitDefinition.upsert({
      where: { unitCode: u.unitCode },
      update: {},
      create: u,
    })
  }

  console.log("Unit definitions seeded:", units.length)

  // ─── 13. Audit log entry for seed ─────────────────────────

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "CREATE",
      resource: "SESSION",
      resourceId: "seed",
      metadata: { description: "Database seeded with test data" },
    },
  })

  console.log("Seed complete!")
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
