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
import { PrismaPg } from "@prisma/adapter-pg"
import { hash as bcryptHash } from "bcryptjs"
import { assertSeedEnv } from "../src/lib/env"
import { hmacEmail, hmacField } from "../src/lib/crypto/hmac"
import { encryptField } from "../src/lib/crypto/fields"
// Fix M3 round 1 review PR #453 (Issue #448) — static imports pour le bloc
// 9.bis Messages messagerie (vs dynamic `await import(...)` qui n'apporte
// aucun bénéfice de lazy loading sur un script CLI one-shot + perd la
// validation TS au compile-time).
import { computeConversationKey } from "../src/lib/services/messaging.service"
import { encrypt } from "../src/lib/crypto/health-data"

// L2 — refuse de tourner sur un cluster production. Le seed crée 5 users avec
// des passwords plaintext committés dans le repo (visuellement préfixés
// DEV-ONLY) — si quelqu'un lance ça contre prod par accident, c'est admin
// compromise immédiate.
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "REFUSING to run seed in production (NODE_ENV=production). " +
      "The seed creates known-password admin/doctor/nurse users — never run on a real DB. " +
      "If you intentionally want to seed a non-prod DB, unset NODE_ENV.",
  )
}

// C1 + C2 fix — valide HMAC_SECRET, HEALTH_DATA_ENCRYPTION_KEY, DATABASE_URL
// AVANT toute écriture. Sans ça, `emailHmac` serait calculé avec une clé
// fallback prévisible du repo → RGPD Art. 32 cassée. `assertSeedEnv` throw
// avec un message clair pointant vers docs/local-development.md.
assertSeedEnv()

// Prisma 7 — Driver adapter pg requis (legacy "library" engine supprimé).
// `DATABASE_URL` validé ci-dessus par assertSeedEnv → non-null garanti.
const databaseUrl = process.env.DATABASE_URL!
const adapter = new PrismaPg({ connectionString: databaseUrl })
const prisma = new PrismaClient({ adapter, log: ["warn", "error"] })

// ─── Deterministic PRNG (seeded LCG) ──────────────────────
// Seed data must be reproducible for snapshot tests.
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

// H6 fix — on importe `hmacEmail` directement depuis le runtime
// (`src/lib/crypto/hmac.ts`) au lieu de répliquer la logique ici. Garantit
// que seed et runtime calculent identiquement l'emailHmac, même si le
// helper runtime évolue (e.g., normalisation NFKC unicode plus tard).
// C1/C2 — `assertSeedEnv()` au top du fichier garantit que `HMAC_SECRET`
// est présent et valide avant qu'`hmacEmail` ne soit appelé.

// ─── Password hashing for seed users ───────────────────────
// bcrypt(12) — même cost factor que le runtime (cf. src/app/api/auth/login/route.ts).
//
// H3 fix — préfixe `DEV-ONLY-` sur chaque password : visible visuellement au
// scan du code source, et garantit qu'un copier-coller accidentel en prod
// produit un password qui :
//   - flag immédiatement le risque (revue de PR repère "DEV-ONLY-")
//   - reste >= 12 chars + complexité (politique runtime OK)
// Combiné avec le guard `NODE_ENV === "production"` en haut de fichier, le
// seed est triple-locked.
//
// Mapping email → mot de passe (documenté dans docs/local-development.md §6) :
//   admin@diabeo.test       / DEV-ONLY-Admin123!
//   docteur@diabeo.test     / DEV-ONLY-Doctor123!
//   infirmiere@diabeo.test  / DEV-ONLY-Nurse123!
//   patient.dt1@diabeo.test / DEV-ONLY-Patient123!
//   patient.dt2@diabeo.test / DEV-ONLY-Patient123!
async function seedPassword(plaintext: string): Promise<string> {
  return bcryptHash(plaintext, 12)
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
      update: {},  // Ne pas écraser les données PK en prod — reference data immuable
      create: insulin,
    })
  }
  console.log(`  ✓ ${insulinCatalog.length} insulins seeded`)

  // ─── 1. Users (5) ─────────────────────────────────────────
  // PII (email/firstname/lastname) chiffrées AES-256-GCM comme en production
  // via `encUserPII` (#474) — voir ci-dessous.

  // Parallélise les bcrypt(12) (~250ms chacun) — 5×250ms séquentiel devient
  // ~250ms total. Acceptable même si le seed est run rare.
  const [
    adminPasswordHash,
    doctorPasswordHash,
    nursePasswordHash,
    patient1PasswordHash,
    patient2PasswordHash,
    extraPatientsPasswordHash, // partagé pour les 3 patients dev supplémentaires
  ] = await Promise.all([
    seedPassword("DEV-ONLY-Admin123!"),
    seedPassword("DEV-ONLY-Doctor123!"),
    seedPassword("DEV-ONLY-Nurse123!"),
    seedPassword("DEV-ONLY-Patient123!"),
    seedPassword("DEV-ONLY-Patient123!"),
    seedPassword("DEV-ONLY-Patient123!"),
  ])

  // #474 §11 — Seed PII chiffrées exactement comme en production
  // (AES-256-GCM base64). Sans ça, `patientService.safeDecrypt` (qui attend du
  // base64 chiffré) échoue silencieusement sur du texte clair → renvoie `null`
  // → les noms patients s'affichent "(?)" partout (liste, combobox, détail).
  //
  // R1 (review) — `firstnameHmac`/`lastnameHmac` peuplés (via `hmacField`) :
  // `patientService.search` + admin users cherchent EXCLUSIVEMENT par ces HMAC,
  // sinon la recherche par nom ne retourne aucun user seedé.
  // `emailHmac` n'est PAS dans ce helper (R2) : il est dérivé du clair et figure
  // déjà dans le `where` de l'upsert + le `create` ci-dessous — l'inclure dans
  // `update` produirait un `SET email_hmac` redondant sur une colonne @unique.
  //
  // R3 (review) — utilisé en `update` pour AUTO-RÉPARER les rows seedées en clair
  // (avant #474) sans wipe DB. Effet de bord assumé : AES-GCM ré-encrypte avec un
  // IV aléatoire à chaque `db seed`, donc le ciphertext de ces colonnes n'est PAS
  // byte-stable entre runs (le plaintext déchiffré, lui, l'est ; aucun snapshot
  // ne compare ces colonnes).
  const encUserPII = (email: string, firstname: string, lastname: string) => ({
    email: encryptField(email),
    firstname: encryptField(firstname),
    firstnameHmac: hmacField(firstname),
    lastname: encryptField(lastname),
    lastnameHmac: hmacField(lastname),
  })

  const admin = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("admin@diabeo.test") },
    // M4 — `update: {}` évite de re-hash bcrypt(12) à chaque seed run
    // (5×250ms gaspillés). Si tu veux resync les passwords après une
    // rotation, drop la DB (`docker compose down -v`) et reseed.
    // update re-chiffre les PII → répare les rows seedées en clair avant #474.
    update: encUserPII("admin@diabeo.test", "Admin", "Test"),
    create: {
      ...encUserPII("admin@diabeo.test", "Admin", "Test"),
      emailHmac: hmacEmail("admin@diabeo.test"),
      passwordHash: adminPasswordHash,
      title: "M.",
      role: Role.ADMIN,
      language: Language.fr,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const doctor = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("docteur@diabeo.test") },
    update: encUserPII("docteur@diabeo.test", "Sophie", "Martin"),
    create: {
      ...encUserPII("docteur@diabeo.test", "Sophie", "Martin"),
      emailHmac: hmacEmail("docteur@diabeo.test"),
      passwordHash: doctorPasswordHash,
      title: "Dr",
      role: Role.DOCTOR,
      language: Language.fr,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const nurse = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("infirmiere@diabeo.test") },
    update: encUserPII("infirmiere@diabeo.test", "Marie", "Dupont"),
    create: {
      ...encUserPII("infirmiere@diabeo.test", "Marie", "Dupont"),
      emailHmac: hmacEmail("infirmiere@diabeo.test"),
      passwordHash: nursePasswordHash,
      title: "Mme",
      role: Role.NURSE,
      language: Language.fr,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const patientUserDT1 = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("patient.dt1@diabeo.test") },
    update: encUserPII("patient.dt1@diabeo.test", "Jean", "Durand"),
    create: {
      ...encUserPII("patient.dt1@diabeo.test", "Jean", "Durand"),
      emailHmac: hmacEmail("patient.dt1@diabeo.test"),
      passwordHash: patient1PasswordHash,
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
    update: encUserPII("patient.dt2@diabeo.test", "Claire", "Bernard"),
    create: {
      ...encUserPII("patient.dt2@diabeo.test", "Claire", "Bernard"),
      emailHmac: hmacEmail("patient.dt2@diabeo.test"),
      passwordHash: patient2PasswordHash,
      sex: Sex.F,
      birthday: new Date("1975-08-22"),
      timezone: "Europe/Paris",
      language: Language.fr,
      role: Role.VIEWER,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  // ─── 1.bis Patients dev supplémentaires (seed enrichi calendrier RDV) ──
  //
  // 3 patients additionnels pour avoir une vraie liste à scroller en dev
  // (cabinet view, search bar, filtre pathologie). Tous rattachés au même
  // service + memberDoctor que DT1/DT2 (cohérent avec scope cabinet existant).
  //
  // Couvre les 3 pathologies de l'enum `Pathology` :
  //   - DT1 (jeune adulte, sous pompe)
  //   - DT2 (senior, ADO seul)
  //   - GD  (femme enceinte, suivi grossesse)
  //
  // Pattern idempotent identique (upsert via emailHmac unique).

  const patientUserDT1Extra = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("patient.dt1bis@diabeo.test") },
    update: encUserPII("patient.dt1bis@diabeo.test", "Lucas", "Petit"),
    create: {
      ...encUserPII("patient.dt1bis@diabeo.test", "Lucas", "Petit"),
      emailHmac: hmacEmail("patient.dt1bis@diabeo.test"),
      passwordHash: extraPatientsPasswordHash,
      sex: Sex.M,
      birthday: new Date("1998-11-04"),
      timezone: "Europe/Paris",
      language: Language.fr,
      role: Role.VIEWER,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const patientUserDT2Extra = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("patient.dt2bis@diabeo.test") },
    update: encUserPII("patient.dt2bis@diabeo.test", "Hélène", "Moreau"),
    create: {
      ...encUserPII("patient.dt2bis@diabeo.test", "Hélène", "Moreau"),
      emailHmac: hmacEmail("patient.dt2bis@diabeo.test"),
      passwordHash: extraPatientsPasswordHash,
      sex: Sex.F,
      birthday: new Date("1958-04-12"),
      timezone: "Europe/Paris",
      language: Language.fr,
      role: Role.VIEWER,
      hasSignedTerms: true,
      profileComplete: true,
    },
  })

  const patientUserGD = await prisma.user.upsert({
    where: { emailHmac: hmacEmail("patient.gd@diabeo.test") },
    update: encUserPII("patient.gd@diabeo.test", "Amélie", "Rousseau"),
    create: {
      ...encUserPII("patient.gd@diabeo.test", "Amélie", "Rousseau"),
      emailHmac: hmacEmail("patient.gd@diabeo.test"),
      passwordHash: extraPatientsPasswordHash,
      sex: Sex.F,
      birthday: new Date("1993-07-19"),
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
    patientDT1Extra: patientUserDT1Extra.id,
    patientDT2Extra: patientUserDT2Extra.id,
    patientGD: patientUserGD.id,
  })

  // ─── 2. Unit preferences ──────────────────────────────────

  for (const userId of [
    admin.id,
    doctor.id,
    nurse.id,
    patientUserDT1.id,
    patientUserDT2.id,
    patientUserDT1Extra.id,
    patientUserDT2Extra.id,
    patientUserGD.id,
  ]) {
    await prisma.userUnitPreferences.upsert({
      where: { userId },
      update: {},
      create: { userId, unitGlycemia: 4, unitWeight: 6, unitSize: 8, unitCarb: 2, unitHba1c: 10 },
    })
  }

  // ─── 3. Privacy settings ──────────────────────────────────
  //
  // Fix #6 (session 2026-05-22) — Inclut désormais les pros (admin,
  // doctor, nurse) en plus des patients. Sans `UserPrivacySettings`,
  // `requireGdprConsent(user.id)` lit `gdprConsent = false` → 403
  // `gdprConsentRequired` sur `/api/analytics/*`, `/api/cgm` et autres
  // routes médicales. En dev, un onboarding pro est inutilisable sans
  // upsert manuel — autant l'amorcer dans le seed.
  //
  // En prod, les pros consentent explicitement à leur 1er login via le
  // wizard `/api/account/privacy` (US-2013). Ici on simule cet état
  // pour les comptes de démo seedés.

  // Fix L-3 prisma round 2 review PR #426 — `consentDate` fixe (vs
  // `new Date()` non-déterministe). Cohérent avec autres dates seed.
  const SEED_CONSENT_DATE = new Date("2024-01-01T00:00:00.000Z")

  // Fix M-6 round 2 review PR #426 — `shareWithProviders` n'a pas de sens
  // pour un pro qui EST provider (anti-pattern conceptuel). False pour
  // admin/doctor/nurse, true pour patients (cohérent wizard US-2013).
  const proUserIds = [admin.id, doctor.id, nurse.id]
  for (const userId of proUserIds) {
    await prisma.userPrivacySettings.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        gdprConsent: true,
        consentDate: SEED_CONSENT_DATE,
        shareWithProviders: false,
        shareWithResearchers: false,
      },
    })
  }
  for (const userId of [
    patientUserDT1.id,
    patientUserDT2.id,
    patientUserDT1Extra.id,
    patientUserDT2Extra.id,
    patientUserGD.id,
  ]) {
    await prisma.userPrivacySettings.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        gdprConsent: true,
        consentDate: SEED_CONSENT_DATE,
        shareWithProviders: true,
        shareWithResearchers: false,
      },
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

  // ─── 4.bis Patients dev supplémentaires (3 extras) ───────
  const patientDT1Extra = await prisma.patient.upsert({
    where: { userId: patientUserDT1Extra.id },
    update: {},
    create: { userId: patientUserDT1Extra.id, pathology: Pathology.DT1 },
  })

  const patientDT2Extra = await prisma.patient.upsert({
    where: { userId: patientUserDT2Extra.id },
    update: {},
    create: { userId: patientUserDT2Extra.id, pathology: Pathology.DT2 },
  })

  const patientGD = await prisma.patient.upsert({
    where: { userId: patientUserGD.id },
    update: {},
    create: { userId: patientUserGD.id, pathology: Pathology.GD },
  })

  console.log("Patients created:", {
    dt1: patientDT1.id,
    dt2: patientDT2.id,
    dt1Extra: patientDT1Extra.id,
    dt2Extra: patientDT2Extra.id,
    gd: patientGD.id,
  })

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

  // ─── 5.bis MedicalData pour les 3 extras (minimal) ───────
  await prisma.patientMedicalData.upsert({
    where: { patientId: patientDT1Extra.id },
    update: {},
    create: {
      patientId: patientDT1Extra.id, dt1: true, size: 184, yearDiag: 2015,
      insulin: true, insulinYear: 2015, insulinPump: true, tabac: false, alcool: false,
    },
  })

  await prisma.patientMedicalData.upsert({
    where: { patientId: patientDT2Extra.id },
    update: {},
    create: {
      patientId: patientDT2Extra.id, dt1: false, size: 158, yearDiag: 2008,
      insulin: false, insulinPump: false, tabac: false, alcool: false,
      riskWeight: true, riskCardio: true,
    },
  })

  await prisma.patientMedicalData.upsert({
    where: { patientId: patientGD.id },
    update: {},
    create: {
      patientId: patientGD.id, dt1: false, size: 168, yearDiag: 2026,
      insulin: true, insulinYear: 2026, insulinPump: false, tabac: false, alcool: false,
    },
  })

  // ─── 6. CGM & annex objectives ────────────────────────────

  for (const patientId of [
    patientDT1.id,
    patientDT2.id,
    patientDT1Extra.id,
    patientDT2Extra.id,
    patientGD.id,
  ]) {
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

  // ─── 7. Patient insulins + therapy settings (DT1 — pump) ──

  // Create PatientInsulin entries first, then reference in settings
  const novorapidCatalog = await prisma.insulinCatalog.findUnique({ where: { displayName: "NovoRapid" } })
  const humalogCatalog = await prisma.insulinCatalog.findUnique({ where: { displayName: "Humalog" } })
  const lantusCatalog = await prisma.insulinCatalog.findUnique({ where: { displayName: "Lantus" } })

  // M10 — pattern findFirst + create idempotent. L'ancien
  // `upsert({ where: { id: -1 } })` créait un nouveau row à chaque run, ce
  // qui violait le partial unique index `patient_insulin_active_unique`
  // (post_deploy_sql) → P2002 au 2e seed.
  const piDT1Bolus =
    (await prisma.patientInsulin.findFirst({
      where: {
        patientId: patientDT1.id,
        insulinCatalogId: novorapidCatalog!.id,
        usage: "bolus",
        isActive: true,
      },
    })) ??
    (await prisma.patientInsulin.create({
      data: {
        patientId: patientDT1.id,
        insulinCatalogId: novorapidCatalog!.id,
        usage: "bolus",
        customDurationHours: 4.0,
      },
    }))

  const settingsDT1 = await prisma.insulinTherapySettings.upsert({
    where: { patientId: patientDT1.id },
    update: {},
    create: {
      patientId: patientDT1.id,
      bolusInsulinId: piDT1Bolus.id,
      deliveryMethod: InsulinDeliveryMethod.pump,
    },
  })

  // H2 — pas de @@unique sur GlucoseTarget → skipDuplicates inerte.
  // Pattern idempotent : deleteMany scope + createMany.
  await prisma.glucoseTarget.deleteMany({ where: { settingsId: settingsDT1.id } })
  await prisma.glucoseTarget.createMany({
    data: [
      {
        settingsId: settingsDT1.id, targetGlucose: 120,
        targetRangeLower: 0.70, targetRangeUpper: 1.80,
        preset: GlucoseTargetPreset.standard, isActive: true,
      },
    ],
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

  // ISF — 3 creneaux (H2 — idempotent via deleteMany scope)
  await prisma.insulinSensitivityFactor.deleteMany({
    where: { settingsId: settingsDT1.id },
  })
  await prisma.insulinSensitivityFactor.createMany({
    data: [
      { settingsId: settingsDT1.id, startHour: 6, endHour: 12, startTime: t(6, 0), endTime: t(12, 0), sensitivityFactorGl: 0.30, sensitivityFactorMgdl: 30 },
      { settingsId: settingsDT1.id, startHour: 12, endHour: 22, startTime: t(12, 0), endTime: t(22, 0), sensitivityFactorGl: 0.50, sensitivityFactorMgdl: 50 },
      { settingsId: settingsDT1.id, startHour: 22, endHour: 6, startTime: t(22, 0), endTime: t(6, 0), sensitivityFactorGl: 0.60, sensitivityFactorMgdl: 60 },
    ],
  })

  // ICR — 2 creneaux (H2 — idempotent via deleteMany scope)
  await prisma.carbRatio.deleteMany({ where: { settingsId: settingsDT1.id } })
  await prisma.carbRatio.createMany({
    data: [
      { settingsId: settingsDT1.id, startHour: 6, endHour: 12, startTime: t(6, 0), endTime: t(12, 0), gramsPerUnit: 8.0, mealLabel: "Petit-dejeuner" },
      { settingsId: settingsDT1.id, startHour: 12, endHour: 6, startTime: t(12, 0), endTime: t(6, 0), gramsPerUnit: 12.0, mealLabel: "Dejeuner/Diner" },
    ],
  })

  // Basal configuration — pump with 4 slots (Time, not Timestamptz)
  const basalConfig = await prisma.basalConfiguration.upsert({
    where: { settingsId: settingsDT1.id },
    update: {},
    create: {
      settingsId: settingsDT1.id, configType: BasalConfigType.pump,
      totalDailyDose: 18.6,
    },
  })

  // H2 — idempotent : deleteMany scope par basalConfig avant create.
  await prisma.pumpBasalSlot.deleteMany({ where: { basalConfigId: basalConfig.id } })
  await prisma.pumpBasalSlot.createMany({
    data: [
      { basalConfigId: basalConfig.id, startTime: t(0, 0), endTime: t(6, 0), rate: 0.65, durationHours: 6 },
      { basalConfigId: basalConfig.id, startTime: t(6, 0), endTime: t(12, 0), rate: 0.85, durationHours: 6 },
      { basalConfigId: basalConfig.id, startTime: t(12, 0), endTime: t(22, 0), rate: 0.75, durationHours: 10 },
      { basalConfigId: basalConfig.id, startTime: t(22, 0), endTime: t(0, 0), rate: 0.70, durationHours: 2 },
    ],
  })

  // ─── 8. Insulin therapy settings (DT2 — manual) ──────────

  // M10 — pattern findFirst + create (idempotent vs partial unique index).
  const piDT2Bolus =
    (await prisma.patientInsulin.findFirst({
      where: {
        patientId: patientDT2.id,
        insulinCatalogId: humalogCatalog!.id,
        usage: "bolus",
        isActive: true,
      },
    })) ??
    (await prisma.patientInsulin.create({
      data: {
        patientId: patientDT2.id,
        insulinCatalogId: humalogCatalog!.id,
        usage: "bolus",
        customDurationHours: 4.0,
      },
    }))

  const piDT2Basal =
    (await prisma.patientInsulin.findFirst({
      where: {
        patientId: patientDT2.id,
        insulinCatalogId: lantusCatalog!.id,
        usage: "basal",
        isActive: true,
      },
    })) ??
    (await prisma.patientInsulin.create({
      data: {
        patientId: patientDT2.id,
        insulinCatalogId: lantusCatalog!.id,
        usage: "basal",
      },
    }))

  const settingsDT2 = await prisma.insulinTherapySettings.upsert({
    where: { patientId: patientDT2.id },
    update: {},
    create: {
      patientId: patientDT2.id,
      bolusInsulinId: piDT2Bolus.id,
      basalInsulinId: piDT2Basal.id,
      deliveryMethod: InsulinDeliveryMethod.manual,
    },
  })

  // H2 — idempotent : deleteMany scope par settings avant create.
  await prisma.glucoseTarget.deleteMany({ where: { settingsId: settingsDT2.id } })
  await prisma.glucoseTarget.createMany({
    data: [
      {
        settingsId: settingsDT2.id, targetGlucose: 130,
        targetRangeLower: 0.90, targetRangeUpper: 2.00,
        preset: GlucoseTargetPreset.elderly, isActive: true,
      },
    ],
  })

  await prisma.basalConfiguration.upsert({
    where: { settingsId: settingsDT2.id },
    update: {},
    create: {
      settingsId: settingsDT2.id, configType: BasalConfigType.single_injection,
      dailyDose: 22,
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

  const memberNurse = await prisma.healthcareMember.upsert({
    where: { name_serviceId: { name: "Marie Dupont (IDE)", serviceId: service.id } },
    update: {},
    create: { name: "Marie Dupont (IDE)", serviceId: service.id, userId: nurse.id },
  })

  // Patient services & referent (5 patients = 2 original + 3 dev extras)
  for (const patientId of [
    patientDT1.id,
    patientDT2.id,
    patientDT1Extra.id,
    patientDT2Extra.id,
    patientGD.id,
  ]) {
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

  // ─── 9.bis Messages messagerie (seed dev US-2076-UI E2E — Issue #448) ──
  //
  // Idempotent ATOMIQUE (Fix H1 round 1 review PR #453) : si conversationKey
  // docteur↔patientDT1 a < 5 messages (état attendu), on cleanup + recrée le
  // bloc en transaction. Sans transaction, un crash entre msg 3 et msg 4
  // bloquait définitivement la DB en état partiel (count=3 → skip rerun)
  // → tests E2E silencieusement faux-négatifs.
  //
  // Le bloc crée 5 messages alternés docteur ↔ patient pour tester :
  //   - ThreadList affichage threads + unread badges
  //   - ThreadViewer auto-mark on scroll (couverture unit jsdom — E2E V1.5 Issue #454)
  //   - NewThreadModal contact list (canMessage via PatientReferent existant)
  //
  // Le `PatientReferent` (seed ci-dessus) garantit que `canMessage(doctor,
  // patientDT1)` retourne true → contact apparaît dans NewThreadModal.
  //
  // Couverture seed : badge UNREAD côté DOCTEUR uniquement (les 2 unread
  // sont du patient → docteur). Le badge côté PATIENT n'est pas couvert ici
  // (angle mort accepté scope #448 — focus vue docteur backoffice).
  //
  // Requiert env `CONVERSATION_KEY_PEPPER` (déjà configuré CI). Sans ce
  // pepper, `computeConversationKey` throw — comportement attendu (runbook
  // docs/runbook/e2e-messaging.md documente le setup).

  // Constantes nommées (Fix L1 round 1) — offsets minutes + count attendu.
  const MESSAGE_OFFSETS_MIN = [0, 5, 10, 15, 20]
  const EXPECTED_MESSAGE_COUNT = MESSAGE_OFFSETS_MIN.length

  // Fix M2 round 1 — date hard-codée déterministe : NE PAS modifier sans
  // aligner les tests E2E qui dépendent de l'ordre/dates des messages
  // (tests/e2e/messaging.spec.ts + tests/unit/ThreadViewer.test.tsx).
  const baseDate = new Date("2026-05-25T10:00:00.000Z")
  const conversationKey = computeConversationKey(doctor.id, patientUserDT1.id)
  const existingMessagesCount = await prisma.message.count({
    where: { conversationKey },
  })

  if (existingMessagesCount !== EXPECTED_MESSAGE_COUNT) {
    const messages = [
      { offsetMin: 0,  from: doctor.id,          to: patientUserDT1.id, text: "Bonjour, comment vous sentez-vous aujourd'hui ?", read: true },
      { offsetMin: 5,  from: patientUserDT1.id,  to: doctor.id,         text: "Bonjour docteur, ça va mieux merci. Glycémies stables.", read: true },
      { offsetMin: 10, from: doctor.id,          to: patientUserDT1.id, text: "Très bien. N'oubliez pas votre prochain rendez-vous mercredi.", read: true },
      // 2 unread récents du patient vers docteur — testent unread badge +
      // auto-mark on scroll côté ThreadViewer docteur.
      { offsetMin: 15, from: patientUserDT1.id,  to: doctor.id,         text: "J'ai une question sur mon nouveau dosage d'insuline.", read: false },
      { offsetMin: 20, from: patientUserDT1.id,  to: doctor.id,         text: "Pouvez-vous me rappeler quand vous avez un moment ?", read: false },
    ]

    // Fix H1 round 1 — transaction atomique : tout-ou-rien. Si crash
    // n'importe où dans la boucle, rollback intégral → rerun voit count=0
    // → recrée propre. Cleanup des messages partiels existants en début
    // de TX pour gérer l'état dégradé (count=3 ou count=4 par exemple).
    await prisma.$transaction(async (tx) => {
      if (existingMessagesCount > 0) {
        await tx.message.deleteMany({ where: { conversationKey } })
      }
      for (const m of messages) {
        const createdAt = new Date(baseDate.getTime() + m.offsetMin * 60_000)
        // readAt = createdAt + 2min (réaliste delivery → read latency).
        const readAt = m.read ? new Date(createdAt.getTime() + 2 * 60_000) : null
        // Fix M4 round 1 — `encrypt(text)` retourne Uint8Array, Prisma
        // `Bytes` field accepte direct (cohérent avec `messaging.service.ts`).
        // Le wrap `Buffer.from(...)` superflu créait une copie inutile.
        await tx.message.create({
          data: {
            conversationKey,
            fromUserId: m.from,
            toUserId: m.to,
            bodyEncrypted: encrypt(m.text),
            // Pivot US-2268 — patientId pour forensique "tous les messages
            // contextualisant patient X".
            patientId: patientDT1.id,
            readAt,
            createdAt,
          },
        })
      }
    })
    const action = existingMessagesCount === 0 ? "created" : `replaced (was ${existingMessagesCount})`
    console.log(`Messaging seed: ${EXPECTED_MESSAGE_COUNT} messages docteur↔patientDT1 ${action} (3 read + 2 unread)`)
  } else {
    console.log(`Messaging seed: skipped (${EXPECTED_MESSAGE_COUNT} messages already exist)`)
  }

  // ─── 9.ter Appointments (calendrier RDV — seed dev US-2500-UI) ──
  //
  // Idempotent : skippé si Dr Sophie Martin a déjà des RDV. Sinon, crée
  // ~15 RDV variés couvrant tous les statuts sur ±1 mois autour de today,
  // pour permettre de tester /appointments en dev avec des données
  // réalistes (différentes vues mois/semaine/jour, badges statuts).
  //
  // Distribution :
  //   - 4 cette semaine (scheduled / pending_validation / confirmed)
  //   - 3 semaine prochaine (scheduled)
  //   - 2 mois précédent (completed / no_show)
  //   - 1 cancelled
  //   - 2 sur memberNurse (test filtre membre cabinet)
  //   - 3 répartis sur le mois courant

  const existingApptCount = await prisma.appointment.count({
    where: { memberId: memberDoctor.id },
  })

  if (existingApptCount === 0) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    function dateAtOffset(days: number): Date {
      const d = new Date(today)
      d.setDate(d.getDate() + days)
      return d
    }

    function timeAt(h: number, m = 0): Date {
      // @db.Time naive — stocké en UTC sans tz pour heure d'horloge.
      return new Date(`1970-01-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`)
    }

    /**
     * Fix L-4 round 2 review PR #431 — seeds avec `motifEncrypted` pour
     * permettre de tester le modal détail RDV (déchiffrement AES-256-GCM)
     * en dev. PHI fictif (patients DT1/DT2 de démo).
     */
    type ApptRow = {
      patientId: number
      memberId: number
      type: string
      date: Date
      hour: Date
      durationMinutes: number
      location: "in_person" | "video" | "phone"
      status: "scheduled" | "pending_validation" | "confirmed" | "cancelled" | "completed" | "no_show"
      motifEncrypted?: string
    }

    const apptSeedData: ApptRow[] = [
      // ─── HISTORIQUE 3 MOIS PASSÉS (status completed / no_show) ───
      // Test vue mois précédent + KPI "RDV passés"
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(-75), hour: timeAt(9, 30), durationMinutes: 30, location: "in_person", status: "completed" },
      { patientId: patientDT2.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(-60), hour: timeAt(11, 0), durationMinutes: 30, location: "in_person", status: "completed" },
      { patientId: patientDT1Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(-45), hour: timeAt(14, 0), durationMinutes: 30, location: "in_person", status: "completed" },
      { patientId: patientDT2Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(-35), hour: timeAt(10, 30), durationMinutes: 30, location: "in_person", status: "no_show" },
      { patientId: patientGD.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(-28), hour: timeAt(9, 0), durationMinutes: 45, location: "in_person", status: "completed" },
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(-21), hour: timeAt(14, 30), durationMinutes: 30, location: "in_person", status: "completed" },
      { patientId: patientDT2.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(-14), hour: timeAt(11, 30), durationMinutes: 30, location: "in_person", status: "no_show" },
      { patientId: patientGD.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(-7), hour: timeAt(10, 0), durationMinutes: 30, location: "video", status: "completed" },

      // ─── SEMAINE EN COURS — DOCTOR (densité haute, journée chargée test back-to-back) ───
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(0), hour: timeAt(8, 30), durationMinutes: 30, location: "in_person", status: "confirmed", motifEncrypted: encryptField("Titration basale post-hypos répétées") },
      { patientId: patientDT2Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(0), hour: timeAt(9, 0), durationMinutes: 30, location: "in_person", status: "confirmed", motifEncrypted: encryptField("Bilan annuel HbA1c") },
      { patientId: patientGD.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(0), hour: timeAt(9, 45), durationMinutes: 30, location: "in_person", status: "confirmed", motifEncrypted: encryptField("Suivi grossesse — 24 SA") },
      { patientId: patientDT1Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(0), hour: timeAt(10, 30), durationMinutes: 45, location: "video", status: "confirmed", motifEncrypted: encryptField("Téléconsultation — ajustement ICR") },
      { patientId: patientDT2.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(1), hour: timeAt(10, 15), durationMinutes: 45, location: "in_person", status: "scheduled" },
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(2), hour: timeAt(14, 0), durationMinutes: 30, location: "video", status: "pending_validation" },
      { patientId: patientDT1Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(2), hour: timeAt(15, 30), durationMinutes: 30, location: "phone", status: "scheduled" },
      { patientId: patientDT2.id, memberId: memberDoctor.id, type: "hdj", date: dateAtOffset(3), hour: timeAt(11, 0), durationMinutes: 60, location: "in_person", status: "scheduled" },
      { patientId: patientGD.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(4), hour: timeAt(9, 30), durationMinutes: 30, location: "in_person", status: "scheduled" },

      // RDV annulé (test badge gris barré)
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(5), hour: timeAt(16, 0), durationMinutes: 30, location: "in_person", status: "cancelled" },

      // ─── SEMAINE PROCHAINE — DOCTOR ───
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(7), hour: timeAt(9, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientDT2Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(7), hour: timeAt(10, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientDT2.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(8), hour: timeAt(15, 30), durationMinutes: 30, location: "phone", status: "scheduled" },
      { patientId: patientGD.id, memberId: memberDoctor.id, type: "hdj", date: dateAtOffset(9), hour: timeAt(8, 30), durationMinutes: 90, location: "in_person", status: "scheduled", motifEncrypted: encryptField("HDJ surveillance glycémique grossesse") },
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(10), hour: timeAt(10, 30), durationMinutes: 45, location: "in_person", status: "scheduled" },
      { patientId: patientDT1Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(11), hour: timeAt(14, 0), durationMinutes: 30, location: "video", status: "scheduled" },

      // ─── 2 SEMAINES SUIVANTES — DOCTOR (vue mois remplie) ───
      { patientId: patientGD.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(14), hour: timeAt(9, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(15), hour: timeAt(9, 30), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientDT2.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(16), hour: timeAt(11, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientDT2Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(17), hour: timeAt(14, 30), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientDT1Extra.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(20), hour: timeAt(10, 0), durationMinutes: 30, location: "video", status: "scheduled" },
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(25), hour: timeAt(14, 0), durationMinutes: 45, location: "video", status: "scheduled" },
      { patientId: patientGD.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(28), hour: timeAt(9, 30), durationMinutes: 30, location: "in_person", status: "scheduled" },

      // ─── MOIS +2 (Schedule-X range fetch fetches -7..+14after-next-month) ───
      { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: dateAtOffset(35), hour: timeAt(10, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientGD.id, memberId: memberDoctor.id, type: "hdj", date: dateAtOffset(42), hour: timeAt(8, 30), durationMinutes: 120, location: "in_person", status: "scheduled" },

      // ─── NURSE — test filtre membre cabinet (≥2 memberships hors schema actuel) ───
      { patientId: patientDT1.id, memberId: memberNurse.id, type: "ide", date: dateAtOffset(0), hour: timeAt(13, 0), durationMinutes: 30, location: "in_person", status: "confirmed", motifEncrypted: encryptField("Éducation pompe insuline") },
      { patientId: patientDT2.id, memberId: memberNurse.id, type: "ide", date: dateAtOffset(2), hour: timeAt(15, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientDT1Extra.id, memberId: memberNurse.id, type: "ide", date: dateAtOffset(4), hour: timeAt(11, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientGD.id, memberId: memberNurse.id, type: "ide", date: dateAtOffset(9), hour: timeAt(11, 0), durationMinutes: 30, location: "in_person", status: "scheduled", motifEncrypted: encryptField("Suivi hebdomadaire IDE — grossesse") },
      { patientId: patientGD.id, memberId: memberNurse.id, type: "ide", date: dateAtOffset(16), hour: timeAt(11, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
      { patientId: patientGD.id, memberId: memberNurse.id, type: "ide", date: dateAtOffset(23), hour: timeAt(11, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
    ]

    // Fix M-5 round 2 review PR #431 — `skipDuplicates: true` retiré
    // car `Appointment` n'a aucune contrainte UNIQUE composite naturelle :
    // Prisma ne sait pas quoi "skip". Le guard `existingApptCount === 0`
    // au-dessus assure l'idempotence (binaire mais suffisante en dev).
    await prisma.appointment.createMany({
      data: apptSeedData,
    })

    // Fix L-4 round 2 review PR #431 — `MemberUnavailability` (plages
    // indispo médecin) seedés pour tester l'affichage gris hachuré sur
    // le calendrier (cf. US-2504 backend, US-2500-UI spec).
    const tomorrow = dateAtOffset(1)
    const tomorrowStart = new Date(tomorrow)
    tomorrowStart.setUTCHours(12, 0, 0, 0)
    const tomorrowEnd = new Date(tomorrow)
    tomorrowEnd.setUTCHours(14, 0, 0, 0)

    const nextWeek = dateAtOffset(7)
    const nextWeekStart = new Date(nextWeek)
    nextWeekStart.setUTCHours(0, 0, 0, 0)
    const nextWeekEnd = new Date(dateAtOffset(9))
    nextWeekEnd.setUTCHours(23, 59, 59, 999)

    // 2 plages additionnelles pour densifier le test "gris hachuré" :
    //   - Demi-journée formation continue (mardi matin de la semaine +2)
    //   - Journée fériée fictive (lundi de Pâques fictif J+24)
    const trainingDay = dateAtOffset(15)
    const trainingStart = new Date(trainingDay)
    trainingStart.setUTCHours(8, 0, 0, 0)
    const trainingEnd = new Date(trainingDay)
    trainingEnd.setUTCHours(12, 0, 0, 0)

    const holiday = dateAtOffset(24)
    const holidayStart = new Date(holiday)
    holidayStart.setUTCHours(0, 0, 0, 0)
    const holidayEnd = new Date(holiday)
    holidayEnd.setUTCHours(23, 59, 59, 999)

    await prisma.memberUnavailability.createMany({
      data: [
        {
          memberId: memberDoctor.id,
          startAt: tomorrowStart,
          endAt: tomorrowEnd,
          reasonEncrypted: encryptField("Réunion équipe — 2h"),
          createdBy: doctor.id,
        },
        {
          memberId: memberDoctor.id,
          startAt: nextWeekStart,
          endAt: nextWeekEnd,
          reasonEncrypted: encryptField("Congés — 3 jours"),
          createdBy: doctor.id,
        },
        {
          memberId: memberDoctor.id,
          startAt: trainingStart,
          endAt: trainingEnd,
          reasonEncrypted: encryptField("Formation continue DPC — diabétologie pédiatrique"),
          createdBy: doctor.id,
        },
        {
          memberId: memberDoctor.id,
          startAt: holidayStart,
          endAt: holidayEnd,
          reasonEncrypted: encryptField("Jour férié — cabinet fermé"),
          createdBy: doctor.id,
        },
        // Plage indispo NURSE (test affichage gris si filtre nurse actif)
        {
          memberId: memberNurse.id,
          startAt: nextWeekStart,
          endAt: nextWeekEnd,
          reasonEncrypted: encryptField("Congés annuels IDE"),
          createdBy: doctor.id,
        },
      ],
    })

    console.log(`  ✓ ${apptSeedData.length} appointments seeded sur 5 patients (DOCTOR + NURSE, -3 mois → +2 mois)`)
    console.log(`  ✓ 5 plages indispo seedées (4 DOCTOR + 1 NURSE — test US-2504 affichage gris hachuré)`)
  } else {
    console.log(`  ✓ Appointments already seeded (${existingApptCount} existing) — skipped`)
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

  // H2 — CgmEntry n'a pas de @@unique → deleteMany scope (patient) avant
  // batch insert pour garantir idempotence (re-seed = 8640 rows, pas 17280).
  await prisma.cgmEntry.deleteMany({ where: { patientId: patientDT1.id } })

  const BATCH_SIZE = 1000
  for (let i = 0; i < cgmData.length; i += BATCH_SIZE) {
    await prisma.cgmEntry.createMany({
      data: cgmData.slice(i, i + BATCH_SIZE),
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

  // ─── 12.bis Données démo dashboards (Home v3 peuplés — dev/QA only) ─────
  // Peuple les cartes staff (urgences, propositions, RDV du jour, backups) pour
  // refléter les mockups peuplés. Idempotent (guards de présence). PHI fictif.
  {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

    // Urgences glycémiques ouvertes — carte médecin « Urgences en cours ».
    if ((await prisma.emergencyAlert.count()) === 0) {
      await prisma.emergencyAlert.createMany({
        data: [
          { patientId: patientDT1.id, alertType: "severe_hypo", severity: "critical", status: "open", glucoseValueMgdl: 48, triggeredAt: hoursAgo(2) },
          { patientId: patientDT2.id, alertType: "hyper", severity: "warning", status: "open", glucoseValueMgdl: 268, triggeredAt: hoursAgo(5) },
          { patientId: patientGD.id, alertType: "hyper", severity: "warning", status: "open", glucoseValueMgdl: 252, triggeredAt: hoursAgo(9) },
        ],
      })
      console.log("  ✓ 3 emergency alerts seeded")
    }

    // Propositions d'ajustement en attente — carte « Propositions en attente ».
    if ((await prisma.adjustmentProposal.count({ where: { status: "pending" } })) === 0) {
      await prisma.adjustmentProposal.createMany({
        data: [
          { patientId: patientDT1.id, parameterType: "insulinToCarbRatio", currentValue: 12, proposedValue: 10, changePercent: -16.67, confidence: "high", reason: "icrTooLow", supportingEvents: 14, totalEventsConsidered: 18, status: "pending", carbRatioSlotStart: 12, carbRatioSlotEnd: 14, analysisPeriod: "14d", dataQuality: "good" },
          { patientId: patientDT2.id, parameterType: "basalRate", currentValue: 0.9, proposedValue: 0.8, changePercent: -11.11, confidence: "medium", reason: "basalTooHigh", supportingEvents: 9, totalEventsConsidered: 12, status: "pending", timeSlotStartHour: 0, timeSlotEndHour: 6, analysisPeriod: "14d", dataQuality: "moderate" },
        ],
      })
      console.log("  ✓ 2 adjustment proposals seeded")
    }

    // RDV du jour — carte « Rendez-vous du jour » (guard sur la date du jour).
    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0)
    const timeAtDay = (h: number, m = 0) =>
      new Date(`1970-01-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`)
    const todayApptCount = await prisma.appointment.count({
      where: { memberId: memberDoctor.id, date: todayDate },
    })
    if (todayApptCount === 0) {
      await prisma.appointment.createMany({
        data: [
          { patientId: patientDT2.id, memberId: memberDoctor.id, type: "diabeto", date: todayDate, hour: timeAtDay(9, 0), durationMinutes: 30, location: "video", status: "confirmed" },
          { patientId: patientGD.id, memberId: memberDoctor.id, type: "diabeto", date: todayDate, hour: timeAtDay(10, 30), durationMinutes: 30, location: "in_person", status: "confirmed" },
          { patientId: patientDT1.id, memberId: memberDoctor.id, type: "diabeto", date: todayDate, hour: timeAtDay(14, 0), durationMinutes: 30, location: "in_person", status: "scheduled" },
        ],
      })
      console.log("  ✓ 3 today appointments seeded")
    }

    // Backups — carte admin « Conformité HDS » (1 OK récent + 1 échec récent).
    if ((await prisma.backupLog.count()) === 0) {
      await prisma.backupLog.createMany({
        data: [
          { backupRef: "seed-backup-ok-1", status: "completed", startedAt: hoursAgo(8), completedAt: new Date(hoursAgo(8).getTime() + 95_000), sizeBytes: BigInt(734_003_200), durationMs: 95_000, location: "ovh://diabeo-backups/daily" },
          { backupRef: "seed-backup-fail-1", status: "failed", startedAt: hoursAgo(32), errorMessage: "S3 timeout (seed demo)" },
        ],
      })
      console.log("  ✓ 2 backup logs seeded")
    }
  }

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
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    // `finally` garantit le disconnect dans tous les cas (success + crash) →
    // évite un pool de connexions pg laissé pendant qui hang le process.
    await prisma.$disconnect()
  })
