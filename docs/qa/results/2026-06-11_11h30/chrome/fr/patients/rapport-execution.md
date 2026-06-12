# Rapport d'exécution QA — 03-patients.md

**Date** : 2026-06-11 · **Environnement** : `http://localhost:3000` (local) · **Exécution** : navigateur interactif Chrome · **Référence** : [`03-patients.md`](../../../../../03-patients.md)

## Synthèse

| Scénario | Résultat |
|---|---|
| Liste patients — affichage (titre, filtres, barre recherche, bouton +) | ✅ OK |
| Liste patients — filtre DT1 → 2 patients, bouton pressed | ✅ OK |
| API `GET /api/patients/search?search=Durand` → 200 + `Cache-Control: no-store` | ✅ OK |
| API `POST /api/patients` sans `X-Requested-With` → 403 csrfMissing | ✅ OK |
| API `GET /api/patients/2` (DOCTOR, portefeuille) → 200 | ✅ OK |
| API `GET /api/patients/9999` (hors portefeuille) → 403 | ✅ OK |
| API `GET /api/patients/abc` (id invalide) → 400 | ✅ OK |
| Wizard création — étape 1 : bouton Suivant disabled si vide | ✅ OK |
| Wizard création — étape 1 : bouton activé avec email+prénom+nom | ✅ OK |
| Wizard création — étape 2 : radios DT1/DT2/GD, DT1 pré-sélectionné | ✅ OK |
| Wizard création — soumission → `POST /api/patients 201` + redirect `/patients/66` | ✅ OK |
| Email déjà utilisé → `409 emailExists` | ✅ OK |
| Objectifs hors bornes (`ok=0.50`) → `400 validationFailed` | ✅ OK |
| VIEWER sur `/patients` → redirigé `/patient/dashboard` | ✅ OK |
| **`POST /api/consultation/open` → 403 csrfMissing** (frontend manque le header) | 🔴 KO |
| NURSE sur `/patients` — liste vide (DEMO_DATA non peuplée pour NURSE) | ⚠️ Écart |
| i18n FR — accents manquants dans le wizard et la liste | ⚠️ Écart |

**14 OK · 1 KO · 2 écarts · 0 N/A**

---

## Détail

### Liste patients (`/patients`)

- **DOCTOR** : "5 patients" (DEMO_DATA), 5 lignes visible (Jean Durand, Claire Bernard, Lucas Petit, Hélène Moreau, Amélie Rousseau), badges pathologie colorés (Type 1 = bleu, Type 2 = lilas, Gestationnel = rose) ✅.
- **NURSE** : "0 patients" — DEMO_DATA non peuplée pour le rôle NURSE. La liste est vide mais l'API réelle (`/api/patients/search`) fonctionne et retourne les patients accessibles.
  ⚠️ **Écart** : le rôle NURSE ne voit aucun patient dans l'UI alors que l'API retourne des données. La DEMO_DATA ne tient pas compte du rôle.
- **Filtre DT1** : clic → compteur passe à "2 patients", seuls Jean Durand et Lucas Petit restent → bouton "DT1" `pressed=true` ✅.
- **Barre de recherche** : placeholder correct "Rechercher un patient..." ✅ (filtre côté client sur DEMO_DATA).
- **VIEWER** : navigation vers `/patients` → redirigé `/patient/dashboard` par middleware ✅.

### Contrats API patients

| Endpoint | Status | Résultat |
|---|---|---|
| `GET /api/patients/search?search=Durand` | 200 | ✅ Jean Durand retourné, `Cache-Control: no-store, no-cache, must-revalidate, private` |
| `POST /api/patients` sans `X-Requested-With` | 403 | ✅ `{"error":"csrfMissing"}` |
| `GET /api/patients/2` (DOCTOR, portefeuille) | 200 | ✅ PII déchiffrées dans la réponse |
| `GET /api/patients/9999` (hors portefeuille) | 403 | ✅ `forbidden` (anti-énumération) |
| `GET /api/patients/abc` | 400 | ✅ `invalidPatientId` |
| `PUT /api/patient/objectives` ok=0.50 (hors bornes) | 400 | ✅ `validationFailed` |
| `POST /api/patients` même email | 409 | ✅ `emailExists` |

### Overlay consultation éphémère (`POST /api/consultation/open`)

🔴 **KO — Bug frontend** : clic sur ligne patient → `POST /api/consultation/open → 403 {"error":"csrfMissing"}`. L'overlay ne s'ouvre pas.

**Cause** : le composant frontend qui déclenche `POST /api/consultation/open` n'inclut pas l'en-tête `X-Requested-With: XMLHttpRequest`. Toutes les requêtes POST mutantes nécessitent cet en-tête (protection CSRF). L'API fonctionne correctement avec le header (confirmé par appel JS manuel → 200 + `cTok`).

**Correction** : ajouter `'X-Requested-With': 'XMLHttpRequest'` dans le `fetch` du composant `PatientRow` (ou équivalent) qui ouvre la consultation.

### Wizard création patient (`/patients/new`)

- **Étape 1** : bouton "Suivant" `disabled` à vide ✅ ; activé avec email+prénom+nom ✅. Champ Sexe (Homme/Femme/Autre) ✅. Date de naissance optionnelle ✅. Mention "Ces donnees sont chiffrees (AES-256-GCM)" ✅.
- **Étape 2** : radios DT1/DT2/GD ✅, DT1 pré-coché ✅. Année diagnostic `[1900, 2026]` ✅. Boutons Retour/Créer ✅.
- **Création réussie** : `POST /api/patients → 201`, redirect `/patients/66` ✅.
- **409 email existant** : renvoi du même email → `409 emailExists` ✅.

---

## Anomalies i18n (FR) — wizard et liste

| Texte affiché | Attendu |
|---|---|
| "Etape" (×2) | "Étape" |
| "Identite" | "Identité" |
| "Ces donnees sont chiffrees" | "Ces données sont chiffrées" |
| "Prenom" | "Prénom" |
| "Selectionnez" | "Sélectionnez" |
| "Diabete" (×3) | "Diabète" |
| "Insulinodependant" | "Insulinodépendant" |
| "Insulinoresistance" | "Insulinorésistance" |
| "Lie a la grossesse" | "Lié à la grossesse" |
| "Annee de diagnostic" | "Année de diagnostic" |
| "Creer le patient" | "Créer le patient" |
| "Derniere glycemie" | "Dernière glycémie" |
| "Derniere sync" | "Dernière sync" |
| "Aucun patient trouve" | "Aucun patient trouvé" |

---

## Non couvert

- Overlay consultation : navigation entre les 5 onglets (bloquée par le bug csrfMissing frontend).
- Détail patient `/patients/[id]` : onglets Glycémie/Traitements/Documents (page en DEMO_DATA partiellement).
- Création patient QA (`/patients/66`) laissée en base de test — à supprimer manuellement si besoin.
- Soft-delete (403 → 404) — nécessite accès admin pour supprimer un patient.
- Body > 16 KB → 413.

## Recommandations

1. **Bug critique** : ajouter `'X-Requested-With': 'XMLHttpRequest'` dans le fetch `POST /api/consultation/open` côté frontend. L'overlay est une fonctionnalité centrale qui ne fonctionne pas actuellement.
2. **DEMO_DATA** : la liste patients NURSE retourne 0 résultats — clarifier si c'est voulu (NURSE sans patients en seed) ou un bug de la DEMO_DATA.
3. **i18n** : 14 clés sans accents dans les messages FR pour le module patients/wizard — même source que les anomalies auth/dashboards.
