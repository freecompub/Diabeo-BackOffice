# Runbook — Traçabilité des relances patient (`RECALL_INITIATED`)

> Portée : audit HDS des gestes de contact patient (« Appeler » / « SMS ») depuis
> les cartes « Relances en attente » des homes **médecin** et **infirmier**.
> Ajouté avec le correctif D6 (voir `docs/reference/homes-par-role.html`).

## Ce qui est tracé

Au clic sur « Appeler » (`tel:`) ou « SMS » (`sms:`) d'une relance, le client émet un
appel **fire-and-forget** `POST /api/dashboard/recall` (`src/components/diabeo/dashboard/infirmier/RecallListCard.tsx` → `logRecall`). La route écrit un **`AuditLog`** :

| Champ | Valeur |
|---|---|
| `action` | `RECALL_INITIATED` |
| `resource` | `PATIENT` |
| `resourceId` | `patientId` (pivot forensique, ADR #18) |
| `metadata` | `{ patientId, channel: "tel" \| "sms" }` — **aucun PHI** (ni nom ni téléphone) |

Gardes : `requireRole("NURSE")` (hiérarchique NURSE/DOCTOR/ADMIN), **anti-IDOR**
`canAccessPatient` avant écriture (sinon `403` + `accessDenied`), immutabilité
append-only du trigger `prevent_audit_log_mutation`. Route :
`src/app/api/dashboard/recall/route.ts`. Action ajoutée à `AuditAction`
(`audit.service.ts`) — colonne `AuditLog.action` libre (`VarChar(64)`), **pas de migration**.

## ⚠️ Limite — trace ADVISORY, pas opposable (V1)

`RECALL_INITIATED` journalise une **intention de contact (clic)**, PAS l'appel ou le
SMS réellement effectué. Deux limites intrinsèques au déclenchement client d'un lien
natif :

1. **Best-effort** : l'appel est `keepalive` + `catch` silencieux — si le réseau échoue,
   l'audit peut être **perdu** alors que le lien `tel:`/`sms:` s'ouvre quand même.
2. **Contournable** : un utilisateur peut ouvrir `tel:`/`sms:` hors du bouton (URL,
   devtools), sans passer par la trace ; et un clic sans appel réel reste possible.

**Conséquence conformité** : ne PAS invoquer `RECALL_INITIATED` comme **preuve
exhaustive/opposable** d'un contact patient. La trace légale opposable arrivera avec
l'**émission serveur** (Twilio + table `PatientRecallLog`, différés — US-2800 / V2),
qui journalisera l'envoi effectif côté serveur.

## Note connexe — `POST /api/events` sans appelant UI

Le nettoyage des pages legacy `/dashboard` + `/events/new` (voir même lot) a laissé
`POST /api/events` (`src/app/api/events/route.ts`) **sans front appelant**. L'endpoint
reste **correctement gardé** (`requireAuth` → `requireGdprConsent` →
`resolvePatientIdFromQuery` scope RBAC → Zod), donc aucune régression de sécurité. À
**arbitrer** : le conserver comme API (usage mobile/futur) ou le retirer pour réduire
la surface. `PUT`/`DELETE /api/events/[id]` (édition/suppression d'événement) restent,
eux, actifs.
