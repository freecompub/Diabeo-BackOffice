/**
 * @vitest-environment jsdom
 */

/**
 * Tests — US-2634 : sélecteur de période + `usePeriodAnalytics`.
 *
 * Vérifie le contrat de la couche de fetch client :
 *  - amorce serveur conservée tant que la période = `seedPeriod` (aucun fetch) ;
 *  - changement de période → re-fetch (debounced) via le transport injecté +
 *    mapping du retour ; retour à l'amorce = seed sans nouveau fetch ;
 *  - sélecteur a11y `radiogroup` (aria-checked, navigation, libellés i18n).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

import {
  PatientRecordProvider,
  usePeriodAnalytics,
  type AnalyticsFetcher,
} from "@/components/diabeo/patient/PatientRecordContext"
import { PeriodSelector } from "@/components/diabeo/patient/PeriodSelector"

function Harness() {
  const { value, loading, error, valuePeriod } = usePeriodAnalytics<string>({
    seed: "SEED",
    endpoint: "/api/analytics/glycemic-profile",
    map: (raw) => (raw as { v: string }).v,
  })
  return (
    <>
      <span data-testid="value">{value}</span>
      <span data-testid="loading">{loading ? "1" : "0"}</span>
      <span data-testid="error">{error ? "1" : "0"}</span>
      <span data-testid="valuePeriod">{valuePeriod}</span>
      <PeriodSelector />
    </>
  )
}

function renderWith(fetchAnalytics: AnalyticsFetcher) {
  return render(
    <PatientRecordProvider fetchAnalytics={fetchAnalytics} seedPeriod="14d">
      <Harness />
    </PatientRecordProvider>,
  )
}

const okResponse = (v: string) => ({ ok: true, json: async () => ({ v }) }) as unknown as Response

describe("usePeriodAnalytics + PeriodSelector (US-2634)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps the server seed and does NOT fetch while period === seedPeriod", () => {
    const fetcher = vi.fn<AnalyticsFetcher>().mockResolvedValue(okResponse("X"))
    renderWith(fetcher)
    expect(screen.getByTestId("value").textContent).toBe("SEED")
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("renders an accessible radiogroup with the active period checked", () => {
    renderWith(vi.fn<AnalyticsFetcher>().mockResolvedValue(okResponse("X")))
    expect(screen.getByRole("radiogroup")).toBeTruthy()
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(4) // 7/14/30/90 j
    // Amorce 14 j (« 2 sem. ») cochée.
    expect(screen.getByRole("radio", { name: "2 sem." }).getAttribute("aria-checked")).toBe("true")
  })

  it("re-fetches (debounced) via the injected transport on period change, then maps the result", async () => {
    const fetcher = vi.fn<AnalyticsFetcher>().mockResolvedValue(okResponse("FETCHED"))
    renderWith(fetcher)

    fireEvent.click(screen.getByRole("radio", { name: "1 mois" })) // 30 j
    // État de chargement immédiat (pas de flicker — la valeur reste l'amorce).
    expect(screen.getByTestId("loading").textContent).toBe("1")
    expect(screen.getByTestId("value").textContent).toBe("SEED")

    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("FETCHED"))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      "/api/analytics/glycemic-profile",
      { period: "30d" },
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(screen.getByRole("radio", { name: "1 mois" }).getAttribute("aria-checked")).toBe("true")
  })

  it("on fetch failure: reverts to seed, flags error, and re-labels the value to seedPeriod (never the requested period)", async () => {
    // HTTP échoué → l'UI ne doit PAS présenter la donnée d'amorce comme celle de
    // la période demandée (faux rassurement clinique, revue #610).
    const fetcher = vi.fn<AnalyticsFetcher>().mockResolvedValue({ ok: false, status: 500 } as unknown as Response)
    renderWith(fetcher)

    fireEvent.click(screen.getByRole("radio", { name: "3 mois" })) // 90 j demandé
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("1"))
    // Donnée retombée sur l'amorce, ré-étiquetée à seedPeriod (14 j), pas 90 j.
    expect(screen.getByTestId("value").textContent).toBe("SEED")
    expect(screen.getByTestId("valuePeriod").textContent).toBe("14d")
    expect(screen.getByTestId("loading").textContent).toBe("0")
  })

  it("tracks valuePeriod = requested period only after a SUCCESSFUL fetch", async () => {
    const fetcher = vi.fn<AnalyticsFetcher>().mockResolvedValue(okResponse("FETCHED"))
    renderWith(fetcher)
    expect(screen.getByTestId("valuePeriod").textContent).toBe("14d") // amorce

    fireEvent.click(screen.getByRole("radio", { name: "1 mois" })) // 30 j
    // Pendant le chargement, la donnée affichée reste l'amorce → valuePeriod=14d.
    expect(screen.getByTestId("valuePeriod").textContent).toBe("14d")
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("FETCHED"))
    expect(screen.getByTestId("valuePeriod").textContent).toBe("30d")
  })

  it("returns to the seed (no new fetch) when the period goes back to seedPeriod", async () => {
    const fetcher = vi.fn<AnalyticsFetcher>().mockResolvedValue(okResponse("FETCHED"))
    renderWith(fetcher)

    fireEvent.click(screen.getByRole("radio", { name: "3 mois" })) // 90 j
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("FETCHED"))
    expect(fetcher).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("radio", { name: "2 sem." })) // retour amorce 14 j
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("SEED"))
    // Aucun fetch supplémentaire pour l'amorce.
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
