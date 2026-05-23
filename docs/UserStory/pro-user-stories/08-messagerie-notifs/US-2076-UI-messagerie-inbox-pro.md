# US-2076-UI — Messagerie inbox pro (UI dédiée)

> 📌 **8. Messagerie & notifs** · Priorité **V1.5** · Pays **Universel**
>
> 🔗 **Issue GitHub** : [#429](https://github.com/freecompub/Diabeo-BackOffice/issues/429)
>
> 🆕 **Créé 2026-05-23** — découvert lors de la session dev quand un médecin
> a constaté l'absence d'inbox messagerie (aucun composant UI côté pro).
> Backend US-2076 scope A déjà livré PR #412, UI manquante.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2076-UI` |
| **Référence parente** | `US-2076` (backend scope A, ✅ DONE PR #412) |
| **Domaine** | 8. Messagerie & notifs |
| **Priorité** | **V1.5** (post-merge backend, pré-prod patients réels) |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (consume `/api/messages/*` + FCM push) |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 🆕 À démarrer |
| **Story points** | **13** (Fibonacci) |
| **Issue GH** | [#429](https://github.com/freecompub/Diabeo-BackOffice/issues/429) |
| **Owner** | À assigner |

---

## 🎯 Contexte

Le backend Messagerie scope A est livré et déployé en prod depuis **PR #412** (US-2076 — REST + polling 60s + FCM, sans WebSocket). 5 routes API opérationnelles :

| Route | Verbe | Notes |
|-------|-------|-------|
| `/api/messages` | POST | send (rate-limit + chiffrement AES-256-GCM body + audit accessDenied US-2265) |
| `/api/messages` | GET | list threads (UNION ALL DISTINCT ON via 2 indexes composite partial) |
| `/api/messages/thread/[conversationKey]` | GET | thread paginated cursor + recheck `isPsManagingPatient` |
| `/api/messages/[id]/read` | PUT | markRead atomique idempotent |
| `/api/messages/unread-count` | GET | badge polling 60s (COUNT direct partial idx) |

**Backend features déjà disponibles** :
- Corps AES-256-GCM bytea natif PG
- `conversation_key` HMAC-SHA256 + pepper
- FCM data-only push `nonce: randomUUID()` (pas de PHI lockscreen)
- `requireGdprConsent` bilatéral émetteur + destinataire
- `canMessage` (patient↔PS via PatientReferent/PatientService, staff↔staff même cabinet, ADMIN bypass restreint)
- AuditResource `MESSAGE`
- Export RGPD Art. 20 inclut `messages.{sent, received, truncated, exportLimit}`

**UI pro actuelle** : aucun composant côté médecin/infirmier/admin. La messagerie est invisible dans le backoffice malgré le backend prod. Identifié dans `docs/reference/features-by-role.md` §11.d et PR #426 (audit RBAC).

---

## 👤 User story

> **En tant que médecin/infirmier**, je veux **une inbox messagerie complète** pour **lire les messages de mes patients**, **leur répondre depuis un thread**, et **voir un badge "messages non lus" dans la sidebar**, **afin de communiquer avec mes patients sans quitter le backoffice**.

---

## ✅ Critères d'acceptation

### Navigation

- [ ] Item sidebar **"Messagerie"** avec icône (`MessageSquare` lucide-react), gated `minRole: NURSE`
- [ ] **Badge count rouge** sur l'item (compteur `/api/messages/unread-count`, polling 60s)
- [ ] Route `/messages` (page client-component pour le polling)
- [ ] Lien depuis le widget urgences si un patient en urgence a un thread actif

### Layout inbox

- [ ] **2-column layout** : sidebar threads (gauche, 320px) + thread viewer (droite, fill)
- [ ] Sidebar threads :
  - Liste threads triés par `lastMessageAt DESC`
  - Per-thread : avatar patient (initiales), nom (HMAC search), dernier message tronqué 60c, timestamp relatif (`il y a 3 min`), badge unread count
  - Search bar haut : filtre par patient (HMAC match côté backend)
  - Filtre rapide : "Tous", "Non lus" (toggle)
- [ ] Thread viewer (droite) :
  - Header : nom patient + lien fiche patient + tags
  - Messages en bubble (vert pro / blanc patient), timestamp + status (envoyé/lu)
  - Composer en bas : textarea + bouton Envoyer (Cmd+Enter)
  - Auto-scroll au bas, "Charger plus ancien" en haut (cursor pagination)

### Vue mobile (< 768px)

- [ ] Mode "list-then-thread" : afficher sidebar threads OU viewer, pas les 2
- [ ] Bouton "back to list" depuis thread viewer

### Read receipts

- [ ] Quand le thread est ouvert et le viewer scroll au bas, mark all visible unread → `PUT /api/messages/[id]/read`
- [ ] Status visible : "Envoyé" → "Lu il y a 2 min" (uniquement pour les messages envoyés par moi)
- [ ] Compteur unread mis à jour optimistic (decrement local + revalidation)

### Composer

- [ ] Textarea expandable (auto-grow, max 8 lignes)
- [ ] Caractères restants visibles (cap à définir backend — vérifier limit byte UTF-8)
- [ ] Cmd+Enter / Ctrl+Enter pour envoyer
- [ ] Bouton "Envoyer" disabled si textarea vide ou < 1 char
- [ ] Optimistic UI : message apparaît immédiatement avec status "Envoi..." → "Envoyé" après 200
- [ ] Rollback + toast erreur si POST fail (rate-limit, GDPR consent, canMessage refusé)

### Création nouveau thread

- [ ] Bouton "+ Nouveau message" haut sidebar
- [ ] Modal : search patient (selon `canMessage`), textarea premier message
- [ ] POST `/api/messages` avec `toUserId` = patient.userId

### Polling & temps réel

- [ ] Polling `/api/messages/unread-count` toutes les 60s (badge sidebar)
- [ ] Polling thread ouvert : 30s pour fetch nouveaux messages
- [ ] Polling thread list : 60s
- [ ] Optionnel : indicateur "is typing" via FCM data-only (scope B WebSocket V2 US-2076bis — **hors scope cette US**)

### FCM push reception

- [ ] Service worker côté backoffice consume push notifications data-only
- [ ] Si `kind: "message_received"` + page `/messages` ouverte → incrémenter badge + refresh thread courant
- [ ] Si page `/messages` fermée → incrémenter badge sidebar uniquement (pas de toast spam)

### Accessibilité

- [ ] Liste threads = `role="list"`, chaque thread = `role="listitem"` + `role="button"`
- [ ] Navigation clavier : flèches Haut/Bas pour naviguer threads, Enter pour ouvrir
- [ ] Focus visible sur message courant
- [ ] `aria-live="polite"` sur le viewer pour annoncer nouveaux messages
- [ ] Touch targets ≥ 44px (composer, send button)
- [ ] Contraste bubbles : vérifier 4.5:1 (texte vert sur bg vert clair)

### i18n

- [ ] Tous libellés via `useTranslations("messages")` — clés `fr` / `en` / `ar` à ajouter
- [ ] Timestamps relatifs via `formatRelativeTime` (US-2115)
- [ ] RTL support : 2-column layout inversé (sidebar threads à droite en arabe)
- [ ] Bubble messages : align left vs right inversé en RTL

### Audit & sécurité

- [ ] Audit `READ` sur thread open déjà fait côté backend
- [ ] Pas de leak conversationKey en URL (utiliser query param ou hash)
- [ ] `Cache-Control: no-store` sur la page (PHI)
- [ ] Aucun affichage de plain text dans les logs console (`logger.debug?` only)
- [ ] Modal "Nouveau message" : check `canMessage(senderUser, recipientUser)` côté UI avant POST (anti-frustration), backend confirme

---

## 🔗 Dépendances

| Dépendance | État |
|---|---|
| Backend Messagerie scope A (US-2076) | ✅ DONE PR #412 |
| Backend FCM push (US-2073) | ✅ DONE PR #340 |
| Backend rappels appointment + audit (US-2502/2506) | ✅ DONE PR #418 |
| NavigationShell + helper `role-home` | ✅ DONE PR #426 |
| Design system Sérénité Active + i18n FR/EN/AR (US-2112/2115) | ✅ DONE PR #351 |
| Service worker FCM côté backoffice (web push) | ⚠️ à vérifier ou provisionner |
| DPIA messagerie scope A | ✅ DONE (`docs/compliance/dpia-messaging-scope-a.md`) |

---

## 🏗️ Spécifications techniques proposées

- **Layout** : single-page `/messages` client-component avec sidebar `NavigationShell` standard
- **Stack UI** : shadcn/ui (`Sheet` pour mobile, `ScrollArea` pour threads, `Avatar`, `Badge`) + composer custom
- **State management** : SWR ou TanStack Query avec keys par thread
- **Fetch** :
  - Thread list : `useSWR("/api/messages?cursor=${cursor}", { refreshInterval: 60_000 })`
  - Thread open : `useSWR("/api/messages/thread/${key}", { refreshInterval: 30_000 })`
  - Unread count : `useSWR("/api/messages/unread-count", { refreshInterval: 60_000 })` (call dans NavigationShell aussi pour le badge)
- **Pagination** : cursor-based, 50 messages/page, infinite scroll vers le haut
- **Optimistic UI** : send message → ajout dans cache local avant POST, status "sending"
- **Tests** : 30-50 unit (composer, thread viewer, badge polling) + 10-15 E2E Playwright (send/read/reply workflow + RGPD consent block)

---

## 🚫 Hors scope (V2 ou autre US)

- **WebSocket / realtime layer** (US-2076bis V2 — scope B reporté, voir issue #413)
- Pièces jointes (fichiers/images) — pas dans scope A
- Réactions emoji
- Search full-text dans les messages (only patient/HMAC search)
- Templates messages cabinet (US-2078 déjà livré backend, UI séparée à scoper)
- Marquer tous comme lus (action bulk)
- Délégation conversation (transfert thread médecin → IDE) — US-2083 backend déjà DONE
- Archive thread

---

## ⏱️ Estimation détaillée

**13 SP** (~3-4 jours dev senior + 1 jour review + 0.5 jour QA) :

| Tâche | SP |
|---|---:|
| Layout 2-column + responsive | 2 |
| Liste threads + search + filtres | 2 |
| Thread viewer + composer + optimistic | 3 |
| Read receipts + polling | 2 |
| Badge sidebar + FCM consume | 2 |
| Polish + i18n + a11y + RTL | 1 |
| Tests | 1 |
| **Total** | **13** |

---

## 📁 Référence backend (rappel)

| Élément | Path |
|---|---|
| Schéma Prisma | `prisma/schema.prisma` → model `Message` |
| Service | `src/lib/services/messaging.service.ts` (~520 lignes) |
| Routes API | `src/app/api/messages/**/route.ts` |
| DPIA | `docs/compliance/dpia-messaging-scope-a.md` |
| Runbook contrat mobile | `docs/runbook/messaging-mobile-contract.md` |
| Runbook rotation pepper | `docs/runbook/messaging-pepper-rotation.md` |
| Inventaire API | `docs/reference/features-by-role.md` §3.8 |

---

## 🎯 Priorité

V1.5 — pré-requis 100% UI scope médecin/infirmier. Sans cette page, les pros ne peuvent communiquer avec leurs patients (pourtant fonctionnalité critique du backoffice).
