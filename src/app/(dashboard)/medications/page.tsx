"use client"

/**
 * Medication search page — US-1000d.
 *
 * Full-text search on BDPM database (ANSM).
 * Displays: name, DCI (substance active), form, dosage, CIP, AMM status.
 * No medical advice or posology.
 */

import { useState, useCallback, useRef } from "react"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Search, Pill, Loader2, Info } from "lucide-react"

interface MedicationResult {
  codeCIS: string
  denomination: string
  formePharma: string
  statutAMM: string
  atcCode: string | null
  titulaires: string | null
  compositions: Array<{ substance: string; dosage: string | null }>
  presentations: Array<{
    codeCIP13: string
    libelle: string
    tauxRemb: string | null
    prix: number | null
  }>
}

export default function MedicationsPage() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<MedicationResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [lastImportDate, setLastImportDate] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      setHasSearched(false)
      return
    }

    setIsLoading(true)
    setHasSearched(true)

    try {
      const res = await fetch(
        `/api/medications/search?q=${encodeURIComponent(q)}&limit=20`,
        {
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        },
      )

      if (res.ok) {
        const data = await res.json()
        setResults(data.specialties ?? [])
        setLastImportDate(data.lastImportDate)
      } else {
        setResults([])
      }
    } catch {
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Debounced search — properly cancels previous timer
  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => search(value), 300)
    },
    [search],
  )

  return (
    <>
      <DashboardHeader
        title="Médicaments"
        subtitle="Base de Données Publique des Médicaments — ANSM"
      />

      <div className="space-y-4 p-6">
        {/* Search bar */}
        <div className="relative max-w-xl">
          <Search
            className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
            aria-hidden="true"
          />
          <Input
            placeholder="Rechercher par nom, DCI ou code CIP..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="ps-10"
            aria-label="Rechercher un médicament"
          />
          {isLoading && (
            <Loader2
              className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--color-muted-foreground)]"
              aria-hidden="true"
            />
          )}
        </div>

        {/* Source info */}
        <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            Source : BDPM — ANSM (Licence Ouverte 2.0)
            {lastImportDate && ` — Dernière mise à jour : ${new Date(lastImportDate).toLocaleDateString("fr-FR")}`}
          </span>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {results.length} résultat{results.length > 1 ? "s" : ""}
            </p>
            {results.map((med) => (
              <Card key={med.codeCIS}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Pill className="h-4 w-4 text-[var(--color-primary)]" aria-hidden="true" />
                        <h3 className="font-semibold text-[var(--color-foreground)]">
                          {med.denomination}
                        </h3>
                      </div>

                      {/* DCI / Substances actives */}
                      {med.compositions.length > 0 && (
                        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                          DCI : {med.compositions.map((c) =>
                            c.dosage ? `${c.substance} ${c.dosage}` : c.substance
                          ).join(" + ")}
                        </p>
                      )}

                      {/* Form + Route */}
                      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                        {med.formePharma}
                      </p>

                      {/* Titulaire */}
                      {med.titulaires && (
                        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                          {med.titulaires}
                        </p>
                      )}

                      {/* Presentations */}
                      {med.presentations.length > 0 && (
                        <>
                          <Separator className="my-2" />
                          <div className="space-y-1">
                            {med.presentations.slice(0, 3).map((pres) => (
                              <div
                                key={pres.codeCIP13}
                                className="flex items-center justify-between text-xs"
                              >
                                <span className="text-[var(--color-muted-foreground)]">
                                  CIP : {pres.codeCIP13} — {pres.libelle}
                                </span>
                                <div className="flex items-center gap-2">
                                  {pres.tauxRemb && (
                                    <Badge variant="outline" className="text-xs">
                                      {pres.tauxRemb}
                                    </Badge>
                                  )}
                                  {pres.prix !== null && (
                                    <span className="font-medium">{pres.prix.toFixed(2)} €</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* AMM status badge */}
                    <Badge
                      variant={med.statutAMM.includes("active") ? "default" : "secondary"}
                      className="shrink-0 text-xs"
                    >
                      {med.statutAMM}
                    </Badge>
                  </div>

                  {/* ATC code */}
                  {med.atcCode && (
                    <div className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                      ATC : {med.atcCode}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty state */}
        {hasSearched && !isLoading && results.length === 0 && (
          <div
            className="py-12 text-center text-[var(--color-muted-foreground)]"
            role="status"
            aria-live="polite"
          >
            <Pill className="mx-auto mb-3 h-8 w-8 opacity-30" aria-hidden="true" />
            <p>Aucun médicament trouvé pour « {query} »</p>
            <p className="mt-1 text-xs">
              Essayez avec le nom commercial, la DCI ou le code CIP
            </p>
          </div>
        )}

        {/* Initial state */}
        {!hasSearched && (
          <div className="py-12 text-center text-[var(--color-muted-foreground)]">
            <Pill className="mx-auto mb-3 h-8 w-8 opacity-30" aria-hidden="true" />
            <p>Recherchez un médicament par nom, DCI ou code CIP</p>
            <p className="mt-1 text-xs">
              Minimum 2 caractères — Aucun conseil médical
            </p>
          </div>
        )}
      </div>
    </>
  )
}
