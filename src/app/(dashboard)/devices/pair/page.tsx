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
 * **i18n** : tous les libellés via `next-intl` (FR/EN/AR), incluant la
 * direction RTL pour AR (la racine `<html dir="rtl">` est gérée au layout).
 *
 * **Accessibilité** :
 *  - étape courante annoncée via `aria-current="step"` + live region polite
 *  - groupes de boutons toggle = `<fieldset>` + `<legend>`
 *  - inputs requis = `aria-required="true"` (en plus du gating `canGoNext`)
 *  - marges logiques (`me-`, `ms-`) au lieu de physiques pour bon rendu RTL
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

const CATEGORIES: readonly DeviceCategory[] = [
  "glucometer",
  "cgm",
  "insulinPump",
  "insulinPen",
  "healthApp",
] as const

const CONNECTION_TYPES: readonly ConnectionType[] = [
  "bluetooth",
  "usb",
  "api",
] as const

const STEP_LABEL_KEYS = [
  "typeModel",
  "serialConnection",
  "confirmation",
] as const

export default function DevicePairingWizardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tCommon = useTranslations("common")
  const tWiz = useTranslations("devicePairing")

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
        <DashboardHeader title={tWiz("title")} />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {tWiz("noPatient")}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => router.push("/patients")}
            >
              {tCommon("back")}
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
      // Reset submitting AVANT navigation : si la transition client-side
      // est lente (slow 3G, hydratation), le bouton ne reste pas bloqué
      // pendant la navigation. router.push est non-bloquant.
      setSubmitting(false)
      router.push(`/patients/${patientId}?tab=devices`)
    } catch {
      setError(tWiz("submitError"))
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

  const currentStepLabel = tWiz(
    `stepLabel.${STEP_LABEL_KEYS[step] ?? STEP_LABEL_KEYS[0]}`,
  )

  return (
    <div className="space-y-6">
      <DashboardHeader title={tWiz("title")} />

      {/* Live region — annonce le changement d'étape aux lecteurs d'écran. */}
      <p
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className="sr-only"
      >
        {tWiz("stepProgressAnnounce", {
          current: step + 1,
          total: STEP_LABEL_KEYS.length,
          label: currentStepLabel,
        })}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <bdi>{`#${patientId}`}</bdi>
            {" — "}
            {tWiz("stepXofY", {
              current: step + 1,
              total: STEP_LABEL_KEYS.length,
            })}
          </CardTitle>
          <ol
            className="mt-3 flex gap-2 text-xs"
            aria-label={tWiz("progressAria")}
          >
            {STEP_LABEL_KEYS.map((labelKey, i) => (
              <li
                key={labelKey}
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
                  {tWiz(`stepLabel.${labelKey}`)}
                </span>
              </li>
            ))}
          </ol>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          {step === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="category">{tWiz("field.category")}</Label>
                <Select
                  value={data.category}
                  onValueChange={(v) =>
                    setData((d) => ({ ...d, category: v as DeviceCategory }))
                  }
                >
                  <SelectTrigger id="category" aria-required="true">
                    <SelectValue placeholder={tWiz("field.categoryPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {tWiz(`category.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand">{tWiz("field.brand")}</Label>
                <Input
                  id="brand"
                  required
                  aria-required="true"
                  value={data.brand}
                  onChange={(e) => setData((d) => ({ ...d, brand: e.target.value }))}
                  placeholder={tWiz("field.brandPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">{tWiz("field.model")}</Label>
                <Input
                  id="model"
                  required
                  aria-required="true"
                  value={data.model}
                  onChange={(e) => setData((d) => ({ ...d, model: e.target.value }))}
                  placeholder={tWiz("field.modelPlaceholder")}
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="sn">{tWiz("field.sn")}</Label>
                <Input
                  id="sn"
                  required
                  aria-required="true"
                  value={data.sn}
                  onChange={(e) => setData((d) => ({ ...d, sn: e.target.value }))}
                  placeholder={tWiz("field.snPlaceholder")}
                />
              </div>
              {/* `<fieldset>` + `<legend>` = sémantique correcte pour un groupe
                  de boutons toggle multi-sélection. Le `<legend>` étiquette
                  déjà le groupe — pas besoin d'`aria-label` redondant. */}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium leading-none">
                  {tWiz("field.connectionType")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {CONNECTION_TYPES.map((c) => (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant={data.connectionTypes.includes(c) ? "default" : "outline"}
                      onClick={() => toggleConnection(c)}
                      aria-pressed={data.connectionTypes.includes(c)}
                    >
                      {tWiz(`connection.${c}`)}
                    </Button>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {step === 2 && (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted-foreground)]">
                  {tWiz("summary.category")}
                </dt>
                <dd className="font-medium">
                  {data.category && tWiz(`category.${data.category}`)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted-foreground)]">
                  {tWiz("summary.brandModel")}
                </dt>
                <dd className="font-medium">
                  <bdi>{`${data.brand} ${data.model}`}</bdi>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted-foreground)]">
                  {tWiz("summary.sn")}
                </dt>
                <dd className="font-mono text-xs">
                  <bdi>{data.sn}</bdi>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted-foreground)]">
                  {tWiz("summary.connection")}
                </dt>
                <dd className="font-medium">
                  {data.connectionTypes
                    .map((c) => tWiz(`connection.${c}`))
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
              aria-label={tWiz("previousStepAria")}
            >
              {tCommon("previous")}
            </Button>
            {step < STEP_LABEL_KEYS.length - 1 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canGoNext}
                aria-label={tWiz("nextStepAria")}
              >
                {tCommon("next")}
              </Button>
            ) : (
              <Button onClick={() => void submit()} disabled={submitting}>
                {submitting ? tCommon("loading") : tCommon("confirm")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
