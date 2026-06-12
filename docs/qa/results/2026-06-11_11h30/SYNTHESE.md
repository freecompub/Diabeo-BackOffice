# Synthèse de run QA — 2026-06-11_11h30

**Navigateur exécuté** : Chrome (Blink) · **Langues** : FR + AR  
**Safari/Firefox** : NON EXÉCUTÉ (non pilotables par l'extension Chrome — voir rapports individuels)  
**Durée estimée** : 11h30 → ~13h30 · **Exécutant** : Claude Code (qa-domain-runner skill)

---

## Matrice de résultats

| Domaine | Chrome/FR | Chrome/AR | Safari/FR | Safari/AR | Firefox/FR | Firefox/AR |
|---|---|---|---|---|---|---|
| 01-auth | ✅ 11 OK · 2 écarts | ✅ 5 OK | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 02-dashboards | ✅ 12 OK · **1 KO** | ✅ 2 OK · **1 KO** | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 03-patients | ✅ 14 OK · **1 KO** · 2 écarts | ✅ 6 OK | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 04-appointments | ✅ 4 OK · 2 N/A | ✅ 5 OK | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 05-settings | ✅ 7 OK | ✅ 5 OK | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 06-admin | ✅ 5 OK | ✅ 2 OK · **1 KO** | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 07-analytics | ✅ 1 OK · 1 écart | N/A | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 08-admin-ops | ✅ 5 OK | N/A | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 09-compliance-billing | ✅ 3 OK | N/A | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 10-devices | ✅ 2 OK · 2 écarts | N/A | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 11-clinical | ✅ 2 OK · 2 écarts | ✅ 5 OK | ⏭️ | ⏭️ | ⏭️ | ⏭️ |
| 12-communication | ✅ 3 OK · 1 écart | ✅ 3 OK | ⏭️ | ⏭️ | ⏭️ | ⏭️ |

**Légende** : ✅ OK · 🔴 KO · ⚠️ écart · ⏭️ non exécuté · N/A non visité en AR

---

## Bugs critiques (🔴 KO)

### KO-1 — `GET /api/cgm → 500` (dashboard patient)
- **Écran** : `/patient/dashboard` → section "Glycémie sur 24 h"
- **Impact** : graphique CGM 24h absent pour tous les patients VIEWER. Fonctionnalité centrale.
- **Preuve** : `reqid=761 GET http://localhost:3000/api/cgm?from=...&to=... [500]`
- **Rapport** : `chrome/fr/dashboards/rapport-execution.md`

### KO-2 — `POST /api/consultation/open → 403 csrfMissing` (frontend)
- **Écran** : `/patients` → clic ligne patient
- **Impact** : overlay consultation éphémère (US-2018b) ne s'ouvre pas. L'API fonctionne avec le header correct (`200 + cTok` confirmé en JS).
- **Cause** : header `X-Requested-With: XMLHttpRequest` absent dans le fetch du composant `PatientRow`.
- **Correction** : ajouter ce header dans l'appel `POST /api/consultation/open`.
- **Rapport** : `chrome/fr/patients/rapport-execution.md`

### KO-3 — Traductions AR manquantes sur le dashboard admin
- **Écran** : `/admin` en locale `ar`
- **Impact** : dashboard administrateur affiché en français pour les utilisateurs arabophones.
- **Cause** : clés `admin-dashboard.*`, `billing.*`, `compliance.*` absentes de `messages/ar.json`.
- **Strings concernées** : "Tableau de bord administrateur", "Vue globale", "Conformité HDS", "Facturation à traiter", labels KPI, messages informatifs (>15 chaînes).
- **Rapport** : `chrome/ar/admin/rapport-execution.md`

---

## Écarts i18n FR (systématiques)

Source unique probable : batch de clés sans accents dans `messages/fr.json`. Environ **30 chaînes** concernées sur tous les domaines :

| Catégorie | Exemples |
|---|---|
| Auth/login | "acceder", "oublie", "Donnees hebergees HDS", "Reinitialiser", "reinitialisation", "Retour a la connexion", "ete envoye", "bloque", "Reessayez" |
| Nav | "Medicaments", "Parametres", "Deconnexion", "Insulinotherapie" |
| Patients | "Derniere glycemie", "Derniere sync", "Aucun patient trouve", "Etape", "Prenom", "Identite", "Creer", "Diabete", "Annee" |
| Devices/clinical | "Appareils connectes", "glucometres", "Glycemie cible", "Duree d'action", "Facteur de sensibilite" |

**Recommandation** : script de lint `messages/fr.json` (grep des caractères [a-zA-Z] sans accents sur les clés communes → flaguer automatiquement en CI).

---

## Observations RTL (AR)

- **Navigation** : 100% traduite et mirrored RTL ✅
- **Pages utilisateur** (patients, appointments, settings, clinical, communication) : entièrement traduites ✅
- **Timeline FSI** (`/insulin-therapy`) : axe 24h→0h correctement inversé en RTL ✅
- **Dashboard admin** : contenu FR (KO-3)
- **Login** : sélecteur de langue position mirrored (haut-droit FR → haut-gauche AR) ✅

---

## Non couvert (à planifier)

| Domaine | Raison |
|---|---|
| Overlay consultation 5 onglets | Bloqué par KO-2 (csrfMissing) |
| Création RDV, confirm/cancel | Écriture complexe (couverte par `tests/manual/appointments-*.spec.ts`) |
| MFA login | Pas de compte seed avec MFA |
| RGPD consent absent (patient dashboard) | Seed DT1 a consentement |
| Appariement appareil, upload documents | Contexte patient requis, non testé |
| US-2112b AC-3 (alerte langue post-login) | Nécessite seed `User.language=ar` |
| Safari/Firefox | Non pilotables — à exécuter manuellement ou via Playwright |

---

## Captures archivées

```
chrome/fr/  — 24 captures .jpg (auth: 7, dashboards: 4, patients: 3, appointments: 1, settings: 1, admin: 2, analytics: 1, admin-ops: 1, clinical: 2, communication: 1, devices: 1)
chrome/ar/  —  6 captures .jpg (auth: 1, admin: 1, patients: 1, settings: 1, clinical: 2)
safari/     — 24 rapports NON EXÉCUTÉ (12 FR + 12 AR)
firefox/    — 24 rapports NON EXÉCUTÉ (12 FR + 12 AR)
```

---

## Actions recommandées (priorité)

1. **[P0]** Corriger `POST /api/consultation/open` — ajouter `X-Requested-With` dans le fetch frontend (KO-2).
2. **[P0]** Investiguer `GET /api/cgm → 500` — log serveur + stack trace (KO-1).
3. **[P1]** Compléter `messages/ar.json` pour le module admin-dashboard (KO-3).
4. **[P1]** Passer en revue `messages/fr.json` et corriger les ~30 clés sans accents (script lint).
5. **[P2]** Ajouter numéro de téléphone valide au seed (test boutons Appeler/SMS infirmier).
6. **[P2]** Ajouter compte seed avec `User.language=ar` (test US-2112b AC-3).
7. **[P3]** Planifier passage Playwright pour Safari (WebKit) et Firefox (Gecko).
