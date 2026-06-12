/**
 * Legacy `/favicon.ico` route handler.
 *
 * Les browsers font un probe automatique `GET /favicon.ico` au load (avant
 * même de parser le HTML pour lire les `<link rel="icon">`). Sans ce
 * handler, ce probe retournerait 404 — bruit dans les logs serveur
 * (1× par session) + bookmarks/PWA pré-existants cassés.
 *
 * On redirige (308 Permanent) vers `/icon` qui est servi par la convention
 * Next.js App Router (`src/app/icon.tsx`, statique au build).
 */

import { NextResponse, type NextRequest } from "next/server"

export function GET(req: NextRequest) {
  // 308 Permanent Redirect → préserve la méthode (GET) et permet aux browsers
  // de cacher la redirection. Coût runtime minimal : pas d'I/O, juste l'écho
  // d'un header `Location` calculé via l'origin de la requête.
  return NextResponse.redirect(new URL("/icon", req.url), 308)
}
