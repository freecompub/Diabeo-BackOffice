---
name: qa-domain-runner
description: Exécute une campagne QA complète sur l'app Diabeo en boucle automatique sur TOUS les domaines (auth, dashboards, patients, etc.), pour les langues FR et AR et les navigateurs Chrome/Safari/Firefox (un par moteur : Blink/WebKit/Gecko), en pilotant un navigateur interactif, puis archive les preuves dans une arborescence horodatée par navigateur et langue. Use when the user wants to run/replay QA tests, execute the full QA matrix, execute Gherkin scenarios from docs/qa, test a screen or domain in the browser, or produce QA execution reports. Triggers : "lance la QA", "rejoue les tests QA", "teste tous les domaines", "/qa".
license: MIT
model: sonnet
metadata:
  author: Diabeo
  version: "2.0.0"
---

# QA Domain Runner — Diabeo Backoffice

Pilote l'exécution **manuelle assistée** d'une campagne QA, à partir des
spécifications Gherkin de `docs/qa/NN-domaine.md`, en utilisant un **navigateur
interactif** (Claude in Chrome). Produit, pour chaque combinaison
**domaine × langue × navigateur**, un dossier de résultats horodaté contenant
le rapport d'exécution et les captures d'écran, plus une synthèse de run.

> Pour l'exécution **automatisée non-interactive** (CI), voir
> `playwright.bdd.config.ts` + `tests/manual/bdd/` : ce skill ne remplace pas
> Playwright, il couvre les passes exploratoires/visuelles pilotées par un agent.

## Mode par défaut : BOUCLE COMPLÈTE

Lancé sans argument (`/qa`), le skill exécute la **matrice complète** :

```
pour chaque NAVIGATEUR ∈ {chrome, safari, firefox}
  pour chaque LANGUE ∈ {fr, ar}
    pour chaque DOMAINE ∈ (les 12 domaines ci-dessous)
      exécuter les scénarios → capturer → archiver
```

Les 3 navigateurs représentent **un moteur de rendu chacun** (ce qui fait varier
le comportement) : Chrome = **Blink**, Safari = **WebKit**, Firefox = **Gecko**.
Inutile d'empiler Edge/Opera/Brave : ils sont Blink comme Chrome.

Lancé avec un argument (`/qa auth`, `/qa patients fr`), il restreint la boucle
au domaine (et éventuellement à la langue/navigateur) indiqué.

⚠️ La matrice complète est volumineuse (3 navigateurs × 2 langues × 12
domaines). Avant de tout lancer, **confirmer le périmètre avec l'utilisateur**
(tout, ou un sous-ensemble) et **prévenir que c'est long**.

## Réalité multi-navigateurs (à dire honnêtement)

Le moteur d'automatisation est l'extension **Claude in Chrome**. Conséquences :

- **chrome** (Blink) — pilotable réellement (navigation, clics, fetch, captures). ✅
- **safari** (WebKit) — **non pilotable** par l'extension Chrome. Dossier +
  rapport créés, marqués **« NON EXÉCUTÉ — Safari non automatisable avec
  l'outillage actuel »**. Exécution réelle = manuelle, ou via Playwright (projet
  `webkit`) hors de ce skill.
- **firefox** (Gecko) — **non pilotable** par l'extension Chrome. Dossier +
  rapport créés, marqués **« NON EXÉCUTÉ — Firefox non automatisable avec
  l'outillage actuel »**. Exécution réelle = manuelle, ou via Playwright (projet
  `firefox`).

Ne jamais prétendre avoir exécuté Safari/Firefox : générer la structure et un
rapport « non exécuté » explicite, pour que la matrice soit complète et honnête.
Le vrai multi-moteur passe par Playwright (Chromium / WebKit / Gecko nativement).

## Pré-requis (vérifier AVANT de commencer)

1. **App lancée** sur `http://localhost:3000` (sinon : `docker compose --profile local up` + seed).
2. **Seed déterministe chargé** (`pnpm prisma db seed`). Comptes — cf. `docs/qa/README.md` §4 :

   | Rôle | Email | Mot de passe |
   |---|---|---|
   | ADMIN | `admin@diabeo.test` | `DEV-ONLY-Admin123!` |
   | DOCTOR | `docteur@diabeo.test` | `DEV-ONLY-Doctor123!` |
   | NURSE | `infirmiere@diabeo.test` | `DEV-ONLY-Nurse123!` |
   | VIEWER (DT1) | `patient.dt1@diabeo.test` | `DEV-ONLY-Patient123!` |
   | VIEWER (DT2) | `patient.dt2@diabeo.test` | `DEV-ONLY-Patient123!` |

3. **Navigateur interactif connecté** (extension Claude in Chrome) : `list_connected_browsers` / `select_browser`.
4. **Dossier Téléchargements connecté** à la session + **téléchargements multiples autorisés** pour `localhost:3000` dans Chrome (sinon le zip de captures est bloqué).

## Domaines (ordre de la boucle)

| # | Domaine | Fichier |
|---|---|---|
| 1 | `auth` | `01-auth.md` |
| 2 | `dashboards` | `02-dashboards.md` |
| 3 | `patients` | `03-patients.md` |
| 4 | `appointments` | `04-appointments.md` |
| 5 | `settings` | `05-settings.md` |
| 6 | `admin` | `06-admin.md` |
| 7 | `analytics` | `07-dashboards-analytics.md` |
| 8 | `admin-ops` | `08-admin-ops.md` |
| 9 | `compliance-billing` | `09-admin-compliance-billing.md` |
| 10 | `devices` | `10-devices-documents-events.md` |
| 11 | `clinical` | `11-clinical.md` |
| 12 | `communication` | `12-communication.md` |

## Langues (FR / AR)

Locale = cookie **`diabeo_locale`** (`fr` | `en` | `ar` supportées par l'app ;
la matrice teste **`fr` et `ar`**), `fr` par défaut. **`ar` est RTL**
(`<html dir="rtl">`) — c'est la langue à fort risque d'écart visuel, d'où sa
présence dans la matrice.

Bascule de langue (utilisateur authentifié) — via `javascript_tool` dans l'onglet :

```js
await fetch('/api/account/locale', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  body: JSON.stringify({ locale: 'ar' })   // 'fr' | 'ar'
});
location.reload();
```

Après bascule en `ar`, **vérifier explicitement le RTL** :
`document.documentElement.dir === 'rtl'` et l'alignement visuel (capture dédiée).
Vérifier aussi qu'aucune chaîne n'est laissée en clé brute (ex. `auth.login.title`)
ni en français quand `ar` est actif (couverture i18n).

## Processus par combinaison (domaine × langue × navigateur)

### A. Si navigateur = safari ou firefox
Créer le dossier de résultats et y écrire un `rapport-execution.md` « NON EXÉCUTÉ »
(motif : moteur non pilotable par l'extension Chrome). **Ne pas** tenter de piloter. Passer.

### B. Si navigateur = chrome
1. **Régler la langue** (fetch PUT locale + reload) ; pour `ar`, contrôler le RTL.
2. **Lire** `docs/qa/NN-domaine.md` (scénarios `Scenario:` + `Cas limites`) et
   `docs/qa/README.md` §2bis (anomalies connues). Une todo par scénario.
3. **Exécuter** chaque scénario :
   - `browser_batch` pour enchaîner navigation → remplissage → soumission → vérif.
   - **Saisie fiable** : après navigation/téléchargement la frappe peut se perdre →
     `form_input` (par `ref` de `find`) puis `document.querySelector('form').requestSubmit()`.
     Toujours vérifier en JS la valeur réellement saisie avant de soumettre.
   - **Preuve = réseau** : confirmer 200/401/403/409/422/429 via `read_network_requests`
     sur `/api/...`, pas seulement le rendu.
   - **Effets base** (`# Effet base:`) : vérifier si accès DB / écran `/audit`, sinon « non vérifié ».
4. **Pièges** :
   - **Lockout login** : 3 échecs → 5 min (progressif 5/15/60). Scénarios de
     verrouillage **en dernier**, compte dédié si possible.
   - **Anti-énumération** : comparer email existant vs inexistant (message + délai identiques).
   - **RBAC** : refus = absence UI **ET** appel API direct (403).
   - **Écritures réelles** (création, MAJ, annulation, suppression, export, envoi) :
     **demander l'accord de l'utilisateur** avant de les exécuter. Sinon couvrir le
     volet lecture/validation (payload invalide → 400/422 sans insert ; CSRF manquant → 403).
5. **Capturer** tous les états notables via `scripts/capture.js` (clé localStorage
   `qa_<navigateur>_<langue>_<domaine>_<ecran>_<etat>`).

## Capture & archivage

`save_to_disk` est indisponible et la sortie base64 directe est bloquée → pipeline :

1. Charger **`html-to-image`** depuis cdnjs (⚠️ **pas html2canvas** : échoue sur
   les couleurs `oklab` de Tailwind v4).
2. Stocker chaque JPEG en `localStorage` sous `qa_<navigateur>_<langue>_<domaine>_<ecran>_<etat>`.
3. Par combinaison (ou en fin de boucle), zipper les clés `qa_*` avec **JSZip** et
   déclencher **UN SEUL** téléchargement (Chrome bloque les téléchargements
   multiples) ; **purger** un éventuel zip précédent du même nom dans
   `~/Downloads` avant, sinon Chrome renomme en `(1)` et le mauvais zip est
   extrait.
4. Dézipper (via bash) dans l'arborescence cible, puis **nettoyer** les clés `qa_*`.

### Arborescence des résultats

Un dossier **par lancement**, horodaté ; sous-arbre **navigateur → langue → domaine** :

```
docs/qa/results/<YYYY-MM-DD_HHhMM>/        ← jour + heure du run
  SYNTHESE.md                              ← agrégat de toute la matrice
  chrome/
    fr/
      auth/
        rapport-execution.md
        auth_login_affichage-initial.jpg
        …
      dashboards/ …
    en/ …
    ar/ …
  safari/   (rapports « NON EXÉCUTÉ »)
  firefox/  (rapports « NON EXÉCUTÉ »)
```

L'arborescence distingue ainsi **jour+heure** (dossier de run), **navigateur**,
**langue** et **domaine**. Les captures gardent un nom court
`<domaine>_<ecran>_<etat>.jpg` (le contexte navigateur/langue est porté par le chemin).

### SYNTHESE.md (à produire en fin de run)
Tableau récapitulatif : lignes = domaines, colonnes = combinaisons
navigateur/langue, cellules = OK / KO / écart / N/A / non exécuté, avec le total
d'anomalies et un lien vers chaque `rapport-execution.md`.

## Légende de statuts

`OK` conforme · `KO` non conforme (bug) · `écart` divergence mineure à arbitrer ·
`N/A` non testable (pré-requis manquant) · `non exécuté` (écriture non autorisée,
ou navigateur non automatisable).

## Fichiers d'appui

- `scripts/capture.js` — snippets JS (capture, zip, nettoyage) avec préfixe navigateur/langue.
- `assets/rapport-template.md` — squelette du rapport d'exécution.
- `assets/rapport-non-execute-template.md` — squelette « NON EXÉCUTÉ » (Safari/Firefox).
