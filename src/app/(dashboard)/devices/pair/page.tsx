/**
 * US-2089 — Wizard pairing device.
 *
 * 3 étapes : (1) catégorie + marque/modèle, (2) numéro de série + type
 * connexion, (3) confirmation. Le backend `device.service.create` enforce
 * RBAC + GDPR + audit déjà.
 *
 * **Patient context** : `?patientId=X` est requis dans l'URL. La page valide
 * via l'API (404 si inaccessible).
 *
 * **Accessibilité** : étape courante annoncée via `aria-current="step"`,
 * progression via `<ol>` + `aria-label`. Boutons "Précédent / Suivant /
 * Confirmer" avec libellés explicites.
 */

"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useTranslations } from "next-intl"

type DeviceCategory = "glucometer" | "cgm" | "insulinPump" | "insulinPen" | "healthApp"
type ConnectionType = "bluetooth" | "usb" | "api"

interface FormData {
  category: DeviceCategory | ""
  brand: string
  model: string
  sn: string
  connectionTypes: ConnectionType[]
}

const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  glucometer: "Glucomètre",
  cgm: "Capteur CGM",
  insulinPump: "Pompe à insuline",
  insulinPen: "Stylo connecté",
  healthApp: "Application santé",
}

const CONNECTION_LABELS: Record<ConnectionType, string> = {
  bluetooth: "Bluetooth",
  usb: "USB",
  api: "API cloud",
}

const STEPS = ["Type & Modèle", "Série & Connexion", "Confirmation"] as const

export default function DevicePairingWizardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations("common")
  const patientIdParam = searchParams.get("patientId")
  const patientId = patientIdParam ? Number.parseInt(patientIdParam, 10) : null

  const [step, setStep] = useState(0)
  const [data, setData] = useState<FormData>({
    category: "",
    brand: "",
    model: "",
    sn: "",
    connectionTypes: [],
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!patientId || patientId <= 0) {
    return (
      <div className="space-y-6">
        <DashboardHeader title="Appairage appareil" />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Aucun patient sélectionné.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => router.push("/patients")}
            >
              Retour
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const canGoNext =
    step === 0
      ? data.category && data.brand.trim() && data.model.trim()
      : step === 1
        ? data.sn.trim() && data.connectionTypes.length > 0
        : true

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          category: data.category,
          brand: data.brand.trim(),
          model: data.model.trim(),
          sn: data.sn.trim(),
          connectionTypes: data.connectionTypes,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.push(`/patients/${patientId}?tab=devices`)
    } catch {
      setError(t("error"))
      setSubmitting(false)
    }
  }

  const toggleConnection = (c: ConnectionType) => {
    setData((d) => ({
      ...d,
      connectionTypes: d.connectionTypes.includes(c)
        ? d.connectionTypes.filter((x) => x !== c)
        : [...d.connectionTypes, c],
    }))
  }

  return (
    <div className="space-y-6">
      <DashboardHeader title="Appairage appareil" />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Patient #{patientId} — Étape {step + 1} sur {STEPS.length}
          </CardTitle>
          <ol
            className="mt-3 flex gap-2 text-xs"
            aria-label="Progression de l'appairage"
          >
            {STEPS.map((label, i) => (
              <li
                key={label}
                aria-current={i === step ? "step" : undefined}
                className="flex items-center gap-1"
              >
                <Badge
                  variant={i === step ? "default" : i < step ? "secondary" : "outline"}
                >
                  {i + 1}
                </Badge>
                <span
                  className={
                    i === step ? "font-medium" : "text-[var(--color-muted-foreground)]"
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {step === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="category">Catégorie</Label>
                <Select
                  value={data.category}
                  onValueChange={(v) =>
                    setData((d) => ({ ...d, category: v as DeviceCategory }))
                  }
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CATEGORY_LABELS) as DeviceCategory[]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand">Marque</Label>
                <Input
                  id="brand"
                  value={data.brand}
                  onChange={(e) => setData((d) => ({ ...d, brand: e.target.value }))}
                  placeholder="Ex: Dexcom, Abbott, Medtronic"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Modèle</Label>
                <Input
                  id="model"
                  value={data.model}
                  onChange={(e) => setData((d) => ({ ...d, model: e.target.value }))}
                  placeholder="Ex: G7, FreeStyle Libre 3"
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="sn">Numéro de série</Label>
                <Input
                  id="sn"
                  value={data.sn}
                  onChange={(e) => setData((d) => ({ ...d, sn: e.target.value }))}
                  placeholder="Imprimé sur l'appareil"
                />
              </div>
              <div className="space-y-2">
                <Label>Type de connexion</Label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(CONNECTION_LABELS) as ConnectionType[]).map((c) => (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant={data.connectionTypes.includes(c) ? "default" : "outline"}
                      onClick={() => toggleConnection(c)}
                      aria-pressed={data.connectionTypes.includes(c)}
                    >
                      {CONNECTION_LABELS[c]}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted-foreground)]">Catégorie</dt>
                <dd className="font-medium">
                  {data.category && CATEGORY_LABELS[data.category]}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted-foreground)]">Marque / Modèle</dt>
                <dd className="font-medium">
                  {data.brand} {data.model}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted-foreground)]">N° série</dt>
                <dd className="font-mono text-xs">{data.sn}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted-foreground)]">Connexion</dt>
                <dd className="font-medium">
                  {data.connectionTypes
                    .map((c) => CONNECTION_LABELS[c])
                    .join(", ")}
                </dd>
              </div>
            </dl>
          )}

          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || submitting}
              aria-label="Étape précédente"
            >
              {t("previous")}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canGoNext}
                aria-label="Étape suivante"
              >
                {t("next")}
              </Button>
            ) : (
              <Button onClick={() => void submit()} disabled={submitting}>
                {submitting ? t("loading") : t("confirm")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
