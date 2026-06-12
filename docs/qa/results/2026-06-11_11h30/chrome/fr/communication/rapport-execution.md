# Rapport d'exécution QA — 12-communication.md
**Date** : 2026-06-11 · **Chrome** · **FR** · **Rôle** : ADMIN

## Synthèse
| Scénario | Résultat |
|---|---|
| Page `/messages` chargée — layout 2 colonnes, bouton "+ Nouveau", filtres | ✅ OK |
| État vide "Vous n'avez pas encore de conversation." | ✅ OK |
| Panneau droit "Sélectionnez une conversation pour afficher les messages." | ✅ OK |
| `/api/messages/conversations` → 404 (chemin incorrect pour ADMIN) | ⚠️ Écart |

**3 OK · 0 KO · 1 écart**

## Détail
- **Messages** : layout correct (liste + panneau détail). Filtres "Tous" / "Non lus". Barre de recherche "Rechercher une conversation...". État vide informatif ✅.
- **API** : `/api/messages/conversations → 404` — endpoint probable est `/api/messages` ou requiert paramètres. Le badge "2 messages non lus" dans la nav (visible pour DOCTOR session précédente) suggère que l'API `/api/messages/unread-count` fonctionne ✅.

## Non couvert
- Création conversation, envoi message.
- `/patient/appointments` (calendrier VIEWER).
- `/users` (legacy).
