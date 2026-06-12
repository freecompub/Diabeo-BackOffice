# Rapport d'exécution QA — 04-appointments.md

**Date** : 2026-06-11 · **Environnement** : `http://localhost:3000` (local) · **Chrome** · **FR**

## Synthèse

| Scénario | Résultat |
|---|---|
| Affichage calendrier Semaine — filtres statuts, compteur, vue, axe horaire | ✅ OK |
| `GET /api/appointments?from&to&memberId` → 200 | ✅ OK |
| `POST /api/appointments` sans `X-Requested-With` → 403 csrfMissing | ✅ OK |
| Bouton "+ Nouveau RDV" visible pour DOCTOR | ✅ OK |
| Membre cabinet auto-résolu ("Dr Sophie Martin · Service Diabetologie") | ✅ OK |
| VIEWER sur `/appointments` — RBAC (redirection) | ⏭️ N/A |
| Création RDV (POST → 201), détail, confirm, cancel | ⏭️ Non exécuté (écriture différée) |

**4 OK · 0 KO · 0 écart · 2 N/A**

## Détail

- **Calendrier** : vue Semaine active, juin 2026, jeudi 11 surligné (aujourd'hui), axe horaire "00 h" → visible ✅.
- **Filtres statuts** : Planifié (vert), En attente de validation (gris/orange), Confirmé (teal), Annulé (rouge), Terminé (gris), Patient absent (rose) — visuellement distincts ✅.
- **Compteur** : "22 sur 25 rendez-vous" ✅ (filtres statuts actifs excluent certains RDV).
- **API** : `GET /api/appointments?from=2026-05-25&to=2026-07-14&memberId=1 → 200` ✅. Paramètre `memberId` requis (sans → 400 — comportement attendu).
- **CSRF** : `POST /api/appointments` sans `X-Requested-With` → 403 ✅.
- **Sélecteur vue** : Semaine/Mois/Jour disponible ✅.

## Non couvert

- Création RDV wizard (modale + POST → 201) — écriture complexe, couverte par `tests/manual/appointments-create.spec.ts`.
- Drag & drop (PUT), confirm/cancel/propose-alternative.
- VIEWER RBAC (pas en session VIEWER ici).
- Anti-chevauchement (Serializable transaction).

## Anomalies i18n

Même source que les autres domaines. Pas de nouvelles clés sans accents détectées sur cet écran (le calendrier utilise des labels corrects).

## Captures

| Fichier | État |
|---|---|
| `appointments_calendrier-semaine.jpg` | Calendrier vue Semaine, filtres statuts actifs |
