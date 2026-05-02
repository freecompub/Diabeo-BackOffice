"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { DiabeoTextField } from "@/components/diabeo/DiabeoTextField"
import { DiabeoFormSection } from "@/components/diabeo/DiabeoFormSection"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { AlertBanner } from "@/components/diabeo/AlertBanner"

type Pathology = "DT1" | "DT2" | "GD"
type Sex = "M" | "F" | "X"

const PATHOLOGIES: { value: Pathology; label: string; description: string }[] = [
  { value: "DT1", label: "Diabète Type 1", description: "Insulinodépendant, auto-immun" },
  { value: "DT2", label: "Diabète Type 2", description: "Insulinorésistance, souvent adulte" },
  { value: "GD", label: "Diabète Gestationnel", description: "Lié à la grossesse" },
]

const ERROR_MESSAGES: Record<string, string> = {
  validationFailed: "Champs invalides. Vérifiez les données saisies.",
  emailExists: "Un compte avec cet email existe déjà.",
  forbidden: "Vous n'avez pas les droits pour créer un patient.",
  csrfMissing: "Session expirée. Rechargez la page.",
  serverError: "Erreur serveur. Réessayez.",
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function NewPatientPage() {
  const router = useRouter()
  const t = useTranslations("patients")
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [sex, setSex] = useState<Sex>("M")
  const [birthday, setBirthday] = useState("")

  const [pathology, setPathology] = useState<Pathology>("DT1")
  const [yearDiag, setYearDiag] = useState("")

  const isStep1Valid = EMAIL_REGEX.test(email) && firstName.trim().length > 0 && lastName.trim().length > 0
  const currentYear = new Date().getFullYear()
  const yearDiagNum = yearDiag ? parseInt(yearDiag, 10) : null
  const isYearDiagValid = !yearDiag || (yearDiagNum !== null && yearDiagNum >= 1900 && yearDiagNum <= currentYear)

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          sex,
          birthday: birthday || undefined,
          pathology,
          yearDiag: yearDiagNum ?? undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        const code = data.error ?? "serverError"
        setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.serverError)
        return
      }

      const patient = await res.json()
      router.push(`/patients/${patient.id}`)
    } catch {
      setError(ERROR_MESSAGES.serverError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-900">{t("newPatient")}</h1>
        <p className="text-sm text-ink-500 mt-1">
          {t("step")} {step} {t("of")} 2 — {step === 1 ? t("identity") : t("pathology")}
        </p>
        <div
          className="flex gap-2 mt-3"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={2}
          aria-label={`${t("step")} ${step} ${t("of")} 2`}
        >
          <div className={`h-1 flex-1 rounded-full ${step >= 1 ? "bg-teal-600" : "bg-ink-100"}`} />
          <div className={`h-1 flex-1 rounded-full ${step >= 2 ? "bg-teal-600" : "bg-ink-100"}`} />
        </div>
      </div>

      {error && (
        <AlertBanner severity="critical" title="Erreur" description={error} className="mb-4" />
      )}

      {step === 1 && (
        <DiabeoCard>
          <DiabeoFormSection title={t("identity")} description={t("identityEncrypted")}>
            <DiabeoTextField
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={email.length > 0 && !EMAIL_REGEX.test(email) ? "Format email invalide" : undefined}
              id="patient-email"
            />
            <div className="grid grid-cols-2 gap-4">
              <DiabeoTextField
                label={t("firstName")}
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                id="patient-firstname"
              />
              <DiabeoTextField
                label={t("lastName")}
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                id="patient-lastname"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="patient-sex" className="block text-sm font-medium text-ink-700 mb-1.5">
                  {t("sex")}
                </label>
                <select
                  id="patient-sex"
                  value={sex}
                  onChange={(e) => setSex(e.target.value as Sex)}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2.5 text-sm"
                  aria-label={t("sex")}
                >
                  <option value="M">{t("male")}</option>
                  <option value="F">{t("female")}</option>
                  <option value="X">{t("other")}</option>
                </select>
              </div>
              <DiabeoTextField
                label={t("birthDate")}
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                id="patient-birthday"
              />
            </div>
          </DiabeoFormSection>

          <div className="flex justify-end gap-3 mt-6">
            <DiabeoButton
              variant="diabeoSecondary"
              onClick={() => router.push("/patients")}
            >
              {t("cancel")}
            </DiabeoButton>
            <DiabeoButton
              onClick={() => setStep(2)}
              disabled={!isStep1Valid}
            >
              {t("next")}
            </DiabeoButton>
          </div>
        </DiabeoCard>
      )}

      {step === 2 && (
        <DiabeoCard>
          <DiabeoFormSection title={t("pathology")} description={t("pathologyDescription")}>
            <div className="space-y-3" role="radiogroup" aria-label={t("pathology")}>
              {PATHOLOGIES.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${
                    pathology === p.value
                      ? "border-teal-600 bg-teal-50"
                      : "border-ink-100 hover:border-ink-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="pathology"
                    value={p.value}
                    checked={pathology === p.value}
                    onChange={(e) => setPathology(e.target.value as Pathology)}
                    className="mt-1 accent-teal-600"
                  />
                  <div>
                    <div className="text-sm font-semibold text-ink-900">{p.label}</div>
                    <div className="text-xs text-ink-500">{p.description}</div>
                  </div>
                </label>
              ))}
            </div>

            <DiabeoTextField
              label={t("yearOfDiagnosis")}
              type="number"
              value={yearDiag}
              onChange={(e) => setYearDiag(e.target.value)}
              hint={`Entre 1900 et ${currentYear}`}
              error={!isYearDiagValid ? `Année entre 1900 et ${currentYear}` : undefined}
              id="patient-yeardiag"
            />
          </DiabeoFormSection>

          <div className="flex justify-between mt-6">
            <DiabeoButton variant="diabeoSecondary" onClick={() => setStep(1)}>
              {t("back")}
            </DiabeoButton>
            <DiabeoButton
              onClick={handleSubmit}
              disabled={loading || !isYearDiagValid}
            >
              {loading ? t("creating") : t("createPatient")}
            </DiabeoButton>
          </div>
        </DiabeoCard>
      )}
    </div>
  )
}
