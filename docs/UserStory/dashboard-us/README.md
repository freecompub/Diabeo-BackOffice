# Dashboards Diabeo — User Stories

> **25 User Stories** pour les 5 dashboards (1 par persona) + leurs composants satellites.

## Vue d'ensemble

| Métrique | Valeur |
|----------|-------:|
| **US totales** | 25 |
| **US principales** (1 par dashboard) | 5 |
| **US satellites** | 20 |
| **Story points cumulés** | 170 |

## Répartition par priorité

- 🟢 **MVP** : 8 US (60 SP)
- 🔵 **V1** : 17 US (110 SP)

## Répartition par dashboard

| Dashboard | US | SP |
|-----------|---:|---:|
| [Patient mobile](patient-mobile/README.md) | 5 | 39 |
| [Patient web](patient-web/README.md) | 4 | 29 |
| [Médecin](medecin/README.md) | 5 | 34 |
| [Infirmier](infirmier/README.md) | 5 | 31 |
| [Administrateur](admin/README.md) | 6 | 37 |


## Conventions

### Format : B (allégé)
Les US suivent le **format B allégé** (~250 lignes par US) pour les dashboards :
- Focus composition, performance, temps réel
- Sections sécurité HDS / RGPD / chiffrement référencées vers `docs/security/baseline.md`
- Plan de test complet référencé vers `docs/testing/baseline.md`
- DoD générale référencée vers `docs/dod/baseline.md`
- Sections dashboard-spécifiques détaillées dans chaque US

### Numérotation
- **US backoffice** : US-2400 → US-2415 (dashboards médecin, infirmier, admin)
- **US patient** : US-3355 → US-3363 (dashboards patient mobile + web)

### Substitutions
- **US-2094** (Tableau de bord population) → remplacée par **US-2400** (Dashboard médecin)
- **FNP-178** (Tableau de bord journalier) → remplacée par **US-3355** (Dashboard patient mobile)

## Organisation des fichiers

```
dashboard-us/
├── README.md (ce fichier)
├── patient-mobile/
│   ├── README.md
│   ├── US-3355-dashboard-patient-mobile.md (principale)
│   ├── US-3357 à US-3360 (satellites)
├── patient-web/
│   ├── US-3356-dashboard-patient-web.md (principale)
│   ├── US-3361 à US-3363 (satellites)
├── medecin/
│   ├── US-2400-dashboard-medecin.md (principale)
│   ├── US-2401 à US-2404 (satellites)
├── infirmier/
│   ├── US-2405-dashboard-infirmier.md (principale)
│   ├── US-2406 à US-2409 (satellites)
└── admin/
    ├── US-2410-dashboard-administrateur.md (principale)
    ├── US-2411 à US-2415 (satellites)
```

## Cadres communs à créer dans le repo

Le format B référence trois fichiers de baseline qui doivent exister dans le repo
pour que les US soient lisibles indépendamment :

- `docs/security/baseline.md` — règles HDS, RGPD, chiffrement AES-256-GCM, AuditLog
- `docs/testing/baseline.md` — plan de test 3 niveaux (unit, intégration, E2E)
- `docs/dod/baseline.md` — DoD générale (code review, tests ≥85%, conformité)

Ces fichiers ne sont **pas** générés ici — à créer une fois pour tout le projet.
