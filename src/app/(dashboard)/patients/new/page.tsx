"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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

export default function NewPatientPage() {
  const router = useRouter()
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

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          sex,
          birthday: birthday || undefined,
          pathology,
          yearDiag: yearDiag ? parseInt(yearDiag, 10) : undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Erreur lors de la création")
        return
      }

      const patient = await res.json()
      router.push(`/patients/${patient.id}`)
    } catch {
      setError("Erreur réseau. Réessayez.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-900">Nouveau patient</h1>
        <p className="text-sm text-ink-500 mt-1">
          Étape {step} sur 2 — {step === 1 ? "Identité" : "Pathologie"}
        </p>
        <div className="flex gap-2 mt-3">
          <div className={`h-1 flex-1 rounded-full ${step >= 1 ? "bg-teal-600" : "bg-ink-100"}`} />
          <div className={`h-1 flex-1 rounded-full ${step >= 2 ? "bg-teal-600" : "bg-ink-100"}`} />
        </div>
      </div>

      {error && (
        <AlertBanner severity="critical" title="Erreur" description={error} className="mb-4" />
      )}

      {step === 1 && (
        <DiabeoCard>
          <DiabeoFormSection title="Identité du patient" description="Ces informations sont chiffrées (AES-256-GCM).">
            <DiabeoTextField
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              id="patient-email"
            />
            <div className="grid grid-cols-2 gap-4">
              <DiabeoTextField
                label="Prénom"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                id="patient-firstname"
              />
              <DiabeoTextField
                label="Nom"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                id="patient-lastname"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="patient-sex" className="block text-sm font-medium text-ink-700 mb-1.5">
                  Sexe
                </label>
                <select
                  id="patient-sex"
                  value={sex}
                  onChange={(e) => setSex(e.target.value as Sex)}
                  className="w-full rounded-lg border border-ink-300 px-3 py-2.5 text-sm"
                >
                  <option value="M">Masculin</option>
                  <option value="F">Féminin</option>
                  <option value="X">Autre</option>
                </select>
              </div>
              <DiabeoTextField
                label="Date de naissance"
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
              Annuler
            </DiabeoButton>
            <DiabeoButton
              onClick={() => setStep(2)}
              disabled={!email || !firstName || !lastName}
            >
              Suivant
            </DiabeoButton>
          </div>
        </DiabeoCard>
      )}

      {step === 2 && (
        <DiabeoCard>
          <DiabeoFormSection title="Pathologie" description="Type de diabète et année de diagnostic.">
            <div className="space-y-3">
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
              label="Année de diagnostic"
              type="number"
              value={yearDiag}
              onChange={(e) => setYearDiag(e.target.value)}
              hint={`Entre 1900 et ${new Date().getFullYear()}`}
              id="patient-yeardiag"
            />
          </DiabeoFormSection>

          <div className="flex justify-between mt-6">
            <DiabeoButton variant="diabeoSecondary" onClick={() => setStep(1)}>
              Retour
            </DiabeoButton>
            <DiabeoButton
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? "Création en cours…" : "Créer le patient"}
            </DiabeoButton>
          </div>
        </DiabeoCard>
      )}
    </div>
  )
}
