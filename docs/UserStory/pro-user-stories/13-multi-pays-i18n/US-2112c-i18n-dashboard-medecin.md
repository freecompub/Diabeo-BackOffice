# US-2112c — Internationalisation du tableau de bord médecin (`/medecin`)

> Follow-up de [US-2112](./US-2112-internationalisation-fr-ar.md) (moteur i18n, DONE) et
> [US-2112b](./US-2112b-preference-langue-utilisateur.md) (switcher + persistance + alerte, DONE PR #513).
> US-2112 a livré le moteur next-intl (FR/EN/AR + `dir="rtl"`) et US-2112b l'accès/la
> persistance de la langue. **Mais le contenu du dashboard médecin était resté codé en dur
> en français** : un compte avec une session arabe (cookie `diabeo_locale=ar`, `dir="rtl"`)
> affichait malgré tout « Tableau de bord médecin », « Urgences en cours », « RDV du jour »,
> « Hypoglycémie sévère », « 4 hypos / 7j », « KPI cabinet — 14 derniers jours », etc.
> Anomalie détectée par l'audit QA `docs/qa/01-auth.md` (finding **i18n-1**, 🔴) lors d'un
> test de connexion en session arabe.

---

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2112c` |
| **Référence inventaire** | `FN-112` (extension) |
| **Domaine** | 13. Multi-pays & i18n |
| **Priorité** | **V1** |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (next-intl) |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 🟢 DONE (médecin) — infirmier/admin tracés en follow-up |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | US-2112 (moteur i18n, DONE) · US-2400→US-2404 (cartes dashboard médecin, DONE) |
| **Sprint cible** | 2026-06-09 |
| **Owner** | — |

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

Le dashboard médecin (`/medecin`, US-2400) est le **premier écran** vu après connexion par un
DOCTOR/NURSE/ADMIN. Avec un déploiement ciblant aussi l'Algérie (cf. domaine), un praticien
arabophone qui a choisi l'arabe (préférence ou cookie) voit une interface « mi-arabe mi-française » :
le chrome de l'app (sidebar, header) est traduit, mais **tout le contenu métier du dashboard reste
en français**, ce qui :

1. **casse la confiance** dans la cohérence linguistique (impression de produit non fini) ;
2. **réduit l'accessibilité** réelle pour les utilisateurs non francophones ;
3. **contredit** l'investissement i18n déjà consenti (US-2112 / US-2112b).

### Chaînes concernées (toutes codées en dur avant cette US)

| Source | Exemples de chaînes |
|--------|---------------------|
| `medecin/page.tsx` | « Tableau de bord médecin » |
| `EmergencyCard` | « Urgences en cours », « MAJ {heure} », « Aucune urgence », labels d'alerte (« Hypoglycémie sévère », « Cétoacidose »…), « N urgences en cours » |
| `AppointmentCard` | « RDV du jour », « N prévu(s) », « Aucun RDV », « Visio » / « Présence », « imminent » |
| `PatientsAtRiskCard` | « Patients à suivre », « Top N », « Tous stables », « Hypos récentes » / « Silence saisie », **`metricLabel` généré serveur** (« 4 hypos / 7j », « 12 j sans saisie ») |
| `KpiSection` | « KPI cabinet — 14 derniers jours », « Patients actifs (14j) », « TIR moyen (14j) », « Urgences (7j) », « Propositions en attente » |
| `StaleBanner` | « Données obsolètes — rafraîchissement en attente. » |
| Formatage horaire | `toLocaleTimeString("fr-FR")` codé en dur (heure non localisée pour AR/EN) |

---

## ✅ Critères d'acceptation

### AC-1 — Tout le chrome du dashboard médecin est traduit (FR/EN/AR) ✅

```gherkin
Scenario: dashboard médecin entièrement en arabe pour une session AR
  Given je suis authentifié en tant que DOCTOR
  And ma langue active est "ar" (cookie diabeo_locale=ar, dir="rtl")
  When j'ouvre "/medecin"
  Then le titre, les titres de cartes, les états vides, les messages d'erreur,
       les libellés d'alerte, de risque et de KPI sont affichés en arabe
  And aucune chaîne française n'apparaît dans le contenu du dashboard
```

### AC-2 — Le `metricLabel` « patients à suivre » est localisé ✅

```gherkin
Scenario: métrique de risque localisée via une valeur structurée
  Given un patient à risque avec 4 hypos sur 7 jours
  When j'ouvre "/medecin" en anglais
  Then je vois "4 hypos / 7d" (et non "4 hypos / 7j")
  # Le service expose désormais `metricValue` (compte brut) en plus de
  # `metricLabel` (libellé FR conservé pour les consommateurs non localisés,
  # ex. liste de rappel infirmier). Le dashboard médecin formate via i18n + ICU.
```

### AC-3 — Le formatage horaire suit la locale active, sans changer le fuseau ✅

```gherkin
Scenario: heure RDV localisée mais ancrée Europe/Paris
  Given un RDV à 08:00 UTC en mai (CEST = UTC+2)
  When j'affiche la carte RDV
  Then l'heure murale affichée correspond à 10:00 (Europe/Paris)
  And le format des chiffres suit la locale active (fr-FR / en-GB / ar)
```

---

## 🛠️ Implémentation

- Nouveau namespace `dashboard.medecin.*` dans `messages/{fr,en,ar}.json`
  (titres, états vides, erreurs, `urgencies.alert.*`, `risk.reason.*`, `risk.metric.*`
  en ICU plural, `appointments.count`/`urgencies.countAnnounce` en ICU plural, `kpi.*`).
- `page.tsx` (Server Component) : `getTranslations("dashboard.medecin")`.
- 4 cartes (`EmergencyCard`, `AppointmentCard`, `PatientsAtRiskCard`, `KpiSection`) :
  `useTranslations("dashboard.medecin")`. Les maps de libellés en dur sont remplacées
  par des clés i18n ; les variants visuels (badge severity / reason) restent en code.
- Formatage horaire locale-aware : helper `bcp47(locale)` ajouté dans `src/i18n/config.ts`
  (`fr→fr-FR`, `en→en-GB` 24 h, `ar→ar`), consommé via `useLocale()` dans les cartes.
- `doctor-dashboard.service.ts` : champ **additif** `PatientAtRiskItem.metricValue`
  (compte brut), `metricLabel` (FR) conservé pour rétro-compatibilité (liste rappel infirmier).
- `StaleBanner` reçoit désormais un `message` localisé de chaque carte (défaut FR conservé en
  filet de sécurité).

## 🔭 Hors périmètre (follow-up)

- **Dashboards infirmier (`/infirmier`) et admin (`/admin`)** : mêmes fuites de chaînes FR
  détectées par grep, non testées par l'audit QA `01-auth.md` (qui ne couvrait que `/medecin`).
  À traiter dans une US suivante (`US-2112d`, même patron) une fois le périmètre confirmé.
- **`metricLabel` côté service** : reste en FR pour les consommateurs non localisés ; une
  refonte « valeur structurée partout » (médecin + infirmier) est un chantier transverse séparé.
