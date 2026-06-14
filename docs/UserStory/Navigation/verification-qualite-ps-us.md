# US-ACCESS-002 — Vérification de la qualité de professionnel de santé

> **Périmètre :** socle d'accès — établit et maintient la **« qualité PS vérifiée »** qui conditionne l'accès clinique (Q1). **Format B léger.**
> **Baselines :** `BASELINE-RBAC` · `BASELINE-AUDIT` (immuable) · `BASELINE-I18N` (FR/AR) · chiffrement AES-256-GCM (justificatifs).
> **Dépend de :** `US-ACCESS-001` (modèle 2 axes, états, politique fail-secure) · `US-SYSADMIN-001` (back-office de validation).

## 👤 En tant que
- Le **professionnel** (ou l'**org-admin** pour son compte) qui **soumet** une preuve d'enregistrement.
- Le **`SYSTEM_ADMIN`** (Diabeo) qui **valide/rejette** les preuves manuelles.

## 🎯 Je veux / Afin de
Prouver et maintenir la qualité PS de façon **fiable et multi-pays**, afin que l'accès aux données de santé (Q1) ne soit ouvert qu'à de **vrais soignants enregistrés**, et **retiré** dès que cette qualité tombe.

## 📌 Description fonctionnelle
- **Soumission de preuve** : identifiant pro (FR : RPPS/ADELI · DZ : n° Ordre / diplôme · autres) + **justificatif** (chiffré).
- **Stratégie par pays (pluggable)** : FR = **manuel V1 → API RPPS/Annuaire Santé V2** · DZ/autres = **manuel** (pas d'API).
- **Validation / rejet** par `SYSTEM_ADMIN` (back-office) → met à jour l'**état**.
- **Cycle de vie de l'état** : `en_attente` → `vérifié` | `refusé` ; `provisoire` (via politique tenant, US-ACCESS-001) ; `expiré` ; `révoqué`.
- **Expiration / re-vérification** (F11) : `expiresAt`/`reviewDueAt` sur la preuve ; **retrait automatique de Q1** à expiration, révocation (radiation) ou rejet.

## ✔️ Critères d'acceptation
- Q1 n'est **octroyable que si l'état = `vérifié`** (jamais `provisoire`/`en_attente`) — cohérent F3.
- La preuve est **générique multi-pays** `{ pays, type, numéro, méthode, justificatif, vérifié_par, date, expiresAt }` ; **justificatif chiffré**, jamais exposé en clair hors validation.
- Validation/rejet/expiration/révocation → **état mis à jour + `AuditLog`** (acteur, cible, état, méthode).
- **Expiration ou révocation ⇒ retrait immédiat de Q1** (couplé à la révocation de capacité, F7).
- Le PS sans preuve `vérifié` n'a **aucun accès aux données de santé**, quel que soit le rôle attribué.
- FR/AR.

## 🧩 Règles métier
- **Jamais d'auto-octroi de la qualité PS** : on **valide une preuve**, on ne la **décrète** pas.
- **Manuel = socle permanent** ; **API RPPS = optimisation FR (V2)**.
- États **distincts** : `provisoire` (flag tenant) ≠ `vérifié` (preuve) — on ne ment pas sur le statut.
- Le **justificatif** est une donnée personnelle → chiffré, **rétention bornée**, purge après usage selon politique.

## ⚠️ Points ouverts → décisions (2026-06-14)
1. **Cadence de re-vérification** — **reportée en V4** (la vérification est en pause ; V1 = auto-vérifié).
2. **Résilience API RPPS** — **décidé** : en cas de panne de l'API, l'inscription est **présumée valide 15 jours** avec **relance automatique** de la vérification ; **au-delà de 15 j sans succès → bascule en vérification manuelle**.
3. **Rétention du justificatif** (RGPD) — **reportée en V4** (durée, purge, base légale).

## 🗺️ Roadmap
- **V1** : ⚠️ **pas de vérification** — toutes les inscriptions sont **considérées vérifiées** (cf. risque accepté US-ACCESS-001 + alerte ROADMAP). Cette US **n'est pas livrée en V1**.
- **V4** : **workflow de vérification complet** — manuel multi-pays **+ API RPPS / Annuaire Santé (FR)** + cycle de vie (états, expiration, retrait Q1) + cadence de re-vérification + rétention. Résilience API : règle des 15 j (ci-dessus).

## 🔗 Dépendances
`US-ACCESS-001` · `US-SYSADMIN-001` · `ProfessionalRegistration` (US-TECH-SEC-003) · `AuditLog`.
