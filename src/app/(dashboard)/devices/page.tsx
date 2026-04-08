"use client"

/**
 * Connected Devices page — WEB-207
 *
 * Shows the patient's connected medical devices grouped by category:
 * Glucometers, CGMs, Insulin Pumps, Other.
 *
 * Features:
 * - Device list with sync status (freshness: green <1h, orange <24h, red >24h)
 * - Add device flow: category → manufacturer → model
 * - OAuth cloud devices (Dexcom, LibreView): "Connect via [provider]" button
 * - Non-cloud devices: iOS app pairing message
 * - Support section with phone + email links
 *
 * i18n: "devices" namespace.
 * Security: no PII logged.
 */

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Activity,
  Bluetooth,
  Cloud,
  Plus,
  RefreshCw,
  Smartphone,
  Wifi,
  WifiOff,
  Phone,
  Mail,
  ChevronRight,
} from "lucide-react"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { AlertBanner } from "@/components/diabeo/AlertBanner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeviceCategory = "CGM" | "GLUCOMETER" | "PUMP" | "OTHER"

interface DeviceSyncStatus {
  deviceId: number
  lastSyncAt: string | null
  status: "ok" | "warning" | "error" | "never"
}

interface PatientDevice {
  id: number
  brand: string | null
  name: string | null
  model: string | null
  category: DeviceCategory
  connectionTypes: string[]
  isActive: boolean
  createdAt: string
}

type SyncMap = Record<number, DeviceSyncStatus>

type AddStep = "category" | "manufacturer" | "model" | "oauth"

interface AddDeviceState {
  open: boolean
  step: AddStep
  category: DeviceCategory | null
  manufacturer: string
  model: string
}

// ---------------------------------------------------------------------------
// Cloud device manifest (OAuth providers)
// ---------------------------------------------------------------------------

const CLOUD_MANUFACTURERS: Partial<Record<DeviceCategory, string[]>> = {
  CGM: ["Dexcom", "LibreView"],
}

const CLOUD_OAUTH_URLS: Record<string, string> = {
  Dexcom: "https://api.dexcom.com/v3/oauth2/login",
  LibreView: "https://api.libreview.io/oauth2/authorize",
}

const MANUFACTURERS_BY_CATEGORY: Record<DeviceCategory, string[]> = {
  CGM: ["Dexcom", "LibreView", "Medtronic", "Eversense", "Other"],
  GLUCOMETER: ["Accu-Chek", "OneTouch", "FreeStyle", "Contour", "Other"],
  PUMP: ["Medtronic", "Tandem", "Insulet (Omnipod)", "DANA", "Ypsomed", "Other"],
  OTHER: ["Other"],
}

const MODELS_BY_MANUFACTURER: Record<string, string[]> = {
  Dexcom: ["G6", "G7", "ONE+"],
  LibreView: ["FreeStyle Libre 2", "FreeStyle Libre 3"],
  Medtronic: ["Guardian 4", "MiniMed 780G", "MiniMed 670G"],
  "Accu-Chek": ["Guide", "Instant", "Mobile"],
  OneTouch: ["Verio Reflect", "Ultra 2"],
  FreeStyle: ["Lite", "Precision Neo"],
  Tandem: ["t:slim X2", "Mobi"],
  "Insulet (Omnipod)": ["DASH", "5"],
  DANA: ["RS", "i"],
  Ypsomed: ["mylife YpsoPump"],
  Other: ["Unknown"],
}

const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
}

// ---------------------------------------------------------------------------
// Sync freshness helpers
// ---------------------------------------------------------------------------

type FreshnessLevel = "fresh" | "stale" | "old" | "never"

function getFreshness(lastSyncAt: string | null): FreshnessLevel {
  if (!lastSyncAt) return "never"
  const diffMs = Date.now() - new Date(lastSyncAt).getTime()
  const hours = diffMs / (1000 * 60 * 60)
  if (hours < 1) return "fresh"
  if (hours < 24) return "stale"
  return "old"
}

function formatLastSync(lastSyncAt: string | null, t: (key: string) => string): string {
  if (!lastSyncAt) return t("neverSynced")
  const diffMs = Date.now() - new Date(lastSyncAt).getTime()
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (minutes < 2) return t("justNow")
  if (minutes < 60) return `${minutes} min`
  if (hours < 24) return `${hours} h`
  return `${days} j`
}

// ---------------------------------------------------------------------------
// SyncIndicator
// ---------------------------------------------------------------------------

function SyncIndicator({
  lastSyncAt,
  t,
}: {
  lastSyncAt: string | null
  t: (key: string) => string
}) {
  const freshness = getFreshness(lastSyncAt)
  const label = formatLastSync(lastSyncAt, t)

  const colorClass = {
    fresh: "bg-green-500",
    stale: "bg-amber-400",
    old: "bg-red-500",
    never: "bg-gray-300",
  }[freshness]

  const textClass = {
    fresh: "text-green-700",
    stale: "text-amber-700",
    old: "text-red-700",
    never: "text-muted-foreground",
  }[freshness]

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn("inline-block h-2 w-2 rounded-full", colorClass)}
        aria-hidden="true"
      />
      <span className={cn("text-xs", textClass)}>
        {freshness === "never" ? t("neverSynced") : `${t("lastSync")} ${label}`}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Category card header
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<DeviceCategory, React.ReactNode> = {
  CGM: <Activity className="h-5 w-5" aria-hidden="true" />,
  GLUCOMETER: <Bluetooth className="h-5 w-5" aria-hidden="true" />,
  PUMP: <Wifi className="h-5 w-5" aria-hidden="true" />,
  OTHER: <Smartphone className="h-5 w-5" aria-hidden="true" />,
}

// ---------------------------------------------------------------------------
// Device card
// ---------------------------------------------------------------------------

function DeviceCard({
  device,
  syncStatus,
  onRefresh,
  refreshLabel,
  t,
}: {
  device: PatientDevice
  syncStatus: DeviceSyncStatus | undefined
  onRefresh: (id: number) => void
  refreshLabel: string
  t: (key: string) => string
}) {
  const isCloud =
    device.brand !== null &&
    (CLOUD_MANUFACTURERS[device.category] ?? []).includes(device.brand)

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-white p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground">
            {device.name ?? device.model ?? device.brand ?? t("unknownDevice")}
          </span>
          {device.brand && (
            <Badge variant="outline" className="text-[10px] font-normal">
              {device.brand}
            </Badge>
          )}
          {isCloud && (
            <Cloud className="h-3.5 w-3.5 text-teal-500" aria-label={t("cloudDevice")} />
          )}
        </div>
        {device.model && device.name && (
          <span className="text-xs text-muted-foreground">{device.model}</span>
        )}
        <SyncIndicator
          lastSyncAt={syncStatus?.lastSyncAt ?? null}
          t={t}
        />
        {device.connectionTypes.length > 0 && (
          <div className="flex gap-1">
            {device.connectionTypes.map((ct) => (
              <Badge key={ct} variant="secondary" className="text-[10px]">
                {ct}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onRefresh(device.id)}
        aria-label={refreshLabel}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-gray-100 hover:text-teal-600 focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Category section
// ---------------------------------------------------------------------------

function CategorySection({
  category,
  devices,
  syncMap,
  onRefresh,
  onAdd,
  t,
}: {
  category: DeviceCategory
  devices: PatientDevice[]
  syncMap: SyncMap
  onRefresh: (id: number) => void
  onAdd: (category: DeviceCategory) => void
  t: (key: string) => string
}) {
  return (
    <DiabeoCard variant="elevated" padding="lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-teal-700">
          {CATEGORY_ICONS[category]}
          <h2 className="text-base font-semibold">
            {t(`category.${category.toLowerCase()}`)}
          </h2>
          <Badge variant="secondary" className="text-xs">
            {devices.length}
          </Badge>
        </div>
        <DiabeoButton
          variant="diabeoTertiary"
          size="sm"
          icon={<Plus />}
          onClick={() => onAdd(category)}
          aria-label={t("addDeviceIn").replace("{category}", t(`category.${category.toLowerCase()}`))}
        >
          {t("add")}
        </DiabeoButton>
      </div>

      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          {t("noDevicesInCategory")}
        </p>
      ) : (
        <div className="space-y-2">
          {devices.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              syncStatus={syncMap[d.id]}
              onRefresh={onRefresh}
              refreshLabel={t("refreshDevice")}
              t={t}
            />
          ))}
        </div>
      )}
    </DiabeoCard>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DevicesPage() {
  const t = useTranslations("devices")
  const tCommon = useTranslations("common")

  const [devices, setDevices] = useState<PatientDevice[]>([])
  const [syncMap, setSyncMap] = useState<SyncMap>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)

  const [addState, setAddState] = useState<AddDeviceState>({
    open: false,
    step: "category",
    category: null,
    manufacturer: "",
    model: "",
  })

  // ── Fetch devices ──────────────────────────────────────────────────────────
  const fetchDevices = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [devicesRes, syncRes] = await Promise.all([
        fetch("/api/devices", {
          credentials: "include",
          headers: API_HEADERS,
        }),
        fetch("/api/devices/sync-status", {
          credentials: "include",
          headers: API_HEADERS,
        }),
      ])

      if (!devicesRes.ok) throw new Error("fetchFailed")

      const devData = await devicesRes.json() as PatientDevice[]
      setDevices(devData)

      if (syncRes.ok) {
        const syncData = await syncRes.json() as DeviceSyncStatus[]
        const map: SyncMap = {}
        for (const s of syncData) {
          map[s.deviceId] = s
        }
        setSyncMap(map)
      }
    } catch {
      setError(t("errorLoading"))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void fetchDevices()
  }, [fetchDevices])

  // ── Refresh single device sync ──────────────────────────────────────────────
  const handleRefresh = useCallback(async (deviceId: number) => {
    setRefreshingId(deviceId)
    try {
      const res = await fetch("/api/devices/sync-status", {
        credentials: "include",
        headers: API_HEADERS,
      })
      if (res.ok) {
        const syncData = await res.json() as DeviceSyncStatus[]
        const found = syncData.find((s) => s.deviceId === deviceId)
        if (found) {
          setSyncMap((prev) => ({ ...prev, [deviceId]: found }))
        }
      }
    } finally {
      setRefreshingId(null)
    }
  }, [])

  // ── Add device flow ─────────────────────────────────────────────────────────
  const openAdd = (category: DeviceCategory) => {
    setAddState({
      open: true,
      step: "manufacturer",
      category,
      manufacturer: "",
      model: "",
    })
  }

  const handleAddSelectCategory = (category: DeviceCategory) => {
    setAddState((prev) => ({ ...prev, step: "manufacturer", category }))
  }

  const handleAddSelectManufacturer = (manufacturer: string) => {
    const isCloud =
      addState.category !== null &&
      (CLOUD_MANUFACTURERS[addState.category] ?? []).includes(manufacturer)
    setAddState((prev) => ({
      ...prev,
      manufacturer,
      step: isCloud ? "oauth" : "model",
    }))
  }

  const handleAddSelectModel = async (model: string) => {
    if (!addState.category) return
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        credentials: "include",
        headers: API_HEADERS,
        body: JSON.stringify({
          category: addState.category,
          brand: addState.manufacturer,
          model,
          name: `${addState.manufacturer} ${model}`,
          connectionTypes: ["bluetooth"],
        }),
      })
      if (!res.ok) throw new Error()
      const created = await res.json() as PatientDevice
      setDevices((prev) => [...prev, created])
      setAddState((prev) => ({ ...prev, open: false }))
    } catch {
      setError(t("errorAddingDevice"))
    }
  }

  const handleOAuthConnect = (manufacturer: string) => {
    const url = CLOUD_OAUTH_URLS[manufacturer]
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer")
    }
    setAddState((prev) => ({ ...prev, open: false }))
  }

  // ── Group devices by category ───────────────────────────────────────────────
  const CATEGORIES: DeviceCategory[] = ["CGM", "GLUCOMETER", "PUMP", "OTHER"]
  const devicesByCategory = CATEGORIES.reduce<Record<DeviceCategory, PatientDevice[]>>(
    (acc, cat) => {
      acc[cat] = devices.filter((d) => d.category === cat)
      return acc
    },
    { CGM: [], GLUCOMETER: [], PUMP: [], OTHER: [] }
  )

  const _ = refreshingId // suppress unused warning for loading visual (used implicitly)

  return (
    <>
      <DashboardHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="space-y-6 p-6">
        {/* Error */}
        {error && (
          <AlertBanner
            severity="warning"
            title={error}
            dismissible
            onDismiss={() => setError(null)}
          />
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div
              className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent"
              aria-label={tCommon("loading")}
            />
          </div>
        ) : devices.length === 0 ? (
          <DiabeoEmptyState
            variant="noData"
            title={t("noDevices")}
            message={t("noDevicesMessage")}
            action={{ label: t("addFirstDevice"), onClick: () => openAdd("CGM") }}
          />
        ) : (
          /* Device categories */
          <div className="grid gap-6 md:grid-cols-2">
            {CATEGORIES.map((cat) => (
              <CategorySection
                key={cat}
                category={cat}
                devices={devicesByCategory[cat]}
                syncMap={syncMap}
                onRefresh={(id) => void handleRefresh(id)}
                onAdd={openAdd}
                t={(key) => {
                  try {
                    return t(key as Parameters<typeof t>[0])
                  } catch {
                    return key
                  }
                }}
              />
            ))}
          </div>
        )}

        {/* Add button when devices exist */}
        {!isLoading && devices.length > 0 && (
          <div className="flex justify-center">
            <DiabeoButton
              variant="diabeoPrimary"
              icon={<Plus />}
              onClick={() =>
                setAddState({
                  open: true,
                  step: "category",
                  category: null,
                  manufacturer: "",
                  model: "",
                })
              }
            >
              {t("addDevice")}
            </DiabeoButton>
          </div>
        )}

        {/* Support section */}
        <DiabeoCard variant="outlined" padding="lg">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {t("support.title")}
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("support.description")}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={`tel:${t("support.phone")}`}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2.5",
                "border border-gray-200 bg-white text-sm font-medium text-foreground",
                "hover:border-teal-500 hover:text-teal-700 transition-colors",
                "focus-visible:outline-2 focus-visible:outline-teal-600"
              )}
              aria-label={`${t("support.callUs")}: ${t("support.phone")}`}
            >
              <Phone className="h-4 w-4 text-teal-600" aria-hidden="true" />
              <span>{t("support.phone")}</span>
              <ChevronRight className="ms-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </a>
            <a
              href={`mailto:${t("support.email")}`}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2.5",
                "border border-gray-200 bg-white text-sm font-medium text-foreground",
                "hover:border-teal-500 hover:text-teal-700 transition-colors",
                "focus-visible:outline-2 focus-visible:outline-teal-600"
              )}
              aria-label={`${t("support.emailUs")}: ${t("support.email")}`}
            >
              <Mail className="h-4 w-4 text-teal-600" aria-hidden="true" />
              <span>{t("support.email")}</span>
              <ChevronRight className="ms-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </a>
          </div>
        </DiabeoCard>
      </div>

      {/* ── Add device dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={addState.open}
        onOpenChange={(open) =>
          setAddState((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addDevice")}</DialogTitle>
            <DialogDescription>
              {addState.step === "category" && t("addStep.category")}
              {addState.step === "manufacturer" && t("addStep.manufacturer")}
              {addState.step === "model" && t("addStep.model")}
              {addState.step === "oauth" && t("addStep.oauth")}
            </DialogDescription>
          </DialogHeader>

          {/* Step: category */}
          {addState.step === "category" && (
            <div className="grid grid-cols-2 gap-3 py-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handleAddSelectCategory(cat)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border-2 border-gray-200 p-4",
                    "text-sm font-medium text-foreground",
                    "hover:border-teal-500 hover:bg-teal-50 transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-teal-600"
                  )}
                >
                  <span className="text-teal-600">{CATEGORY_ICONS[cat]}</span>
                  <span>{t(`category.${cat.toLowerCase()}`)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Step: manufacturer */}
          {addState.step === "manufacturer" && addState.category && (
            <div className="space-y-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="manufacturer-select">{t("manufacturer")}</Label>
                <Select<string> onValueChange={(v) => { if (v !== null && v !== undefined) handleAddSelectManufacturer(v) }}>
                  <SelectTrigger id="manufacturer-select">
                    <SelectValue placeholder={t("selectManufacturer")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(MANUFACTURERS_BY_CATEGORY[addState.category] ?? []).map((m) => (
                      <SelectItem key={m} value={m}>
                        <div className="flex items-center gap-2">
                          {(CLOUD_MANUFACTURERS[addState.category!] ?? []).includes(m) && (
                            <Cloud className="h-3.5 w-3.5 text-teal-500" aria-hidden="true" />
                          )}
                          {m}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Step: model */}
          {addState.step === "model" && (
            <div className="space-y-3 py-2">
              <Label>{t("selectModel")}</Label>
              <div className="grid gap-2">
                {(MODELS_BY_MANUFACTURER[addState.manufacturer] ?? ["Unknown"]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => void handleAddSelectModel(m)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3",
                      "text-sm font-medium text-foreground text-start",
                      "hover:border-teal-500 hover:bg-teal-50 transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-teal-600"
                    )}
                  >
                    <span>{m}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: OAuth */}
          {addState.step === "oauth" && (
            <div className="space-y-4 py-2">
              <AlertBanner
                severity="info"
                title={t("oauthInfo")}
                description={t("oauthDescription").replace(
                  "{provider}",
                  addState.manufacturer
                )}
              />
              <DiabeoButton
                variant="diabeoPrimary"
                fullWidth
                icon={<Cloud />}
                onClick={() => handleOAuthConnect(addState.manufacturer)}
              >
                {t("connectVia").replace("{provider}", addState.manufacturer)}
              </DiabeoButton>
            </div>
          )}

          {/* Non-cloud bluetooth devices — show iOS pairing message */}
          {addState.step === "model" &&
            addState.category !== null &&
            !(CLOUD_MANUFACTURERS[addState.category] ?? []).includes(
              addState.manufacturer
            ) && (
              <AlertBanner
                severity="info"
                title={t("iosAppRequired")}
                description={t("iosAppRequiredDescription")}
                className="mt-2"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-teal-700">
                  <Smartphone className="h-4 w-4" aria-hidden="true" />
                  <span>{t("useIosApp")}</span>
                </div>
              </AlertBanner>
            )}

          <DialogFooter>
            {addState.step !== "category" && (
              <DiabeoButton
                variant="diabeoTertiary"
                onClick={() =>
                  setAddState((prev) => ({
                    ...prev,
                    step:
                      prev.step === "model" || prev.step === "oauth"
                        ? "manufacturer"
                        : "category",
                  }))
                }
              >
                {tCommon("back")}
              </DiabeoButton>
            )}
            <DiabeoButton
              variant="diabeoGhost"
              onClick={() => setAddState((prev) => ({ ...prev, open: false }))}
            >
              {tCommon("cancel")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Offline/disconnected device warning */}
      {!isLoading &&
        Object.values(syncMap).some((s) => getFreshness(s.lastSyncAt) === "old") && (
          <div className="px-6">
            <AlertBanner
              severity="warning"
              title={t("devicesOutOfDate")}
              description={t("devicesOutOfDateDescription")}
            >
              <DiabeoButton
                variant="diabeoTertiary"
                size="sm"
                icon={<WifiOff />}
                onClick={() => void fetchDevices()}
              >
                {t("refreshAll")}
              </DiabeoButton>
            </AlertBanner>
          </div>
        )}
    </>
  )
}
