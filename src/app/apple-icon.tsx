/**
 * Apple touch icon — Next.js App Router convention.
 *
 * Génère `/apple-icon` (180×180 PNG) consommé en `<link rel="apple-touch-icon">`.
 * Affiché par iOS quand l'utilisateur ajoute Diabeo à l'écran d'accueil.
 *
 * Le glyph SVG est factorisé dans `render-glyph.tsx` (partagé avec icon.tsx).
 */

import { ImageResponse } from "next/og"
import { renderGlyphForOg } from "@/components/diabeo/brand/render-glyph"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

// Statique au build — voir le rationnel dans `src/app/icon.tsx`. Pour
// l'apple-icon 180×180, le coût d'une régénération est ~32× celui du PNG 32×32.
export const dynamic = "force-static"
export const revalidate = false

export default function AppleIcon() {
  return new ImageResponse(
    renderGlyphForOg({ outerSize: 180, innerSize: 140, borderRadius: 36 }),
    size,
  )
}
