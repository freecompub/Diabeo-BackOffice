/**
 * Diabeo logo — source de vérité unique des paths SVG.
 *
 * Le glyph (goutte de glucose + onde CGM + point de données live) est
 * partagé entre :
 *  - `src/components/diabeo/brand/Logo.tsx` — composant React (web)
 *  - `src/app/icon.tsx` — favicon dynamique (next/og ImageResponse)
 *  - `src/app/apple-icon.tsx` — apple-touch-icon iOS
 *
 * Toute modification du dessin (proportions, angle, courbure) DOIT se faire
 * ici → les 3 sites consomment automatiquement la nouvelle version. Drift
 * impossible.
 *
 * Toutes les valeurs sont relatives au `viewBox="0 0 48 48"`.
 */

/** Chemin SVG de la goutte de glucose (drop). */
export const DROP_PATH =
  "M24 3 C 33 14, 40 22, 40 29 A 16 16 0 1 1 8 29 C 8 22, 15 14, 24 3 Z"

/** Chemin SVG de l'onde CGM (courbe de glycémie). */
export const WAVE_PATH =
  "M11 30 C 14 24, 18 24, 21 30 C 24 36, 28 36, 31 30 C 33 26, 35 26, 37 28"

/** Coordonnées + rayon du point de données live (extrémité de l'onde). */
export const DOT = { cx: 37, cy: 28, r: 2.4 } as const

/** Rotation du glyph entier autour du centre du viewBox (look dynamique). */
export const GLYPH_TRANSFORM = "rotate(-6 24 24)"

/** Largeur de trait de l'onde CGM. */
export const WAVE_STROKE_WIDTH = 2.4

/** Largeur du contour du dot (point de données live). */
export const DOT_OUTLINE_STROKE_WIDTH = 1
