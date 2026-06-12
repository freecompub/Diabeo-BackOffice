# Rapport d'exécution QA — 10-devices-documents-events.md
**Date** : 2026-06-11 · **Chrome** · **FR** · **Rôle** : ADMIN

## Synthèse
| Scénario | Résultat |
|---|---|
| Page `/devices` chargée — titre, état vide, bouton "Ajouter un appareil" | ✅ OK |
| Erreur chargement appareils (ADMIN sans patient) | ⚠️ Écart (contexte manquant) |
| Section "Support technique" visible (tel + email) | ✅ OK |
| APIs contexte-dépendantes → 404 pour ADMIN (devices, documents) | ⚠️ Écart (attendu) |

**2 OK · 0 KO · 2 écarts**

## Détail
- **Appareils** : bannière orange "Impossible de charger les appareils" + état vide "Aucun appareil connecte" (i18n: "connecté"). Support technique visible. Bouton "Ajouter un appareil" présent.
- **Contexte ADMIN** : les APIs `/api/devices`, `/api/documents` retournent 404 pour ADMIN sans contexte patient — comportement attendu (données liées à un patient).

## Non couvert
- Appairage appareil (`/devices/pair`).
- Upload/téléchargement documents (`/documents`) — dépendant du contexte patient.
- `/events/new` — non visité.
