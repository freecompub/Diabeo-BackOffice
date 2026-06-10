"use client"

/**
 * US-2018b — Récupération de données patient dans le workspace de consultation.
 *
 * Ajoute l'en-tête `x-consultation-token` (au lieu d'un `?patientId=` dans
 * l'URL) à chaque appel : le serveur résout le patient via le jeton éphémère.
 * Aucun id patient ne transite par la barre d'adresse.
 */

import { useEffect, useState } from "react"
// Module client-safe (PAS query-helpers, qui tirerait Prisma/Redis côté client).
import { CONSULTATION_TOKEN_HEADER } from "@/lib/auth/consultation-token"

interface State<T> {
  data: T | null
  loading: boolean
  error: boolean
}

export function useConsultationData<T>(path: string, cTok: string): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: false })

  useEffect(() => {
    // Pas de reset synchrone de l'état ici (react-hooks/set-state-in-effect) :
    // l'état initial est déjà `loading:true`, et dans notre usage `path`/`cTok`
    // sont stables par onglet (chaque onglet remonte avec un état neuf).
    const ctrl = new AbortController()
    fetch(path, {
      credentials: "same-origin",
      headers: { [CONSULTATION_TOKEN_HEADER]: cTok },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as T
      })
      .then((data) => setState({ data, loading: false, error: false }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return
        setState({ data: null, loading: false, error: true })
      })
    return () => ctrl.abort()
  }, [path, cTok])

  return state
}
