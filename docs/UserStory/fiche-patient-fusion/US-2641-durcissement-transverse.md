# US-2641 — Durcissement transverse : tokens, i18n/glossaire, a11y, audit/perf, lazy-load

> 📌 Fiche patient · epic US-2630 · transverse · Taille **M** · dépend de : US-2635 → US-2639

## Contexte
Passe de consolidation des invariants transverses (partiellement absorbés par chaque US, mais une gate finale est nécessaire).

## Périmètre & critères d'acceptation
- **AC-1 Design system** : zéro hex/Tailwind brut dans les viz ; SVG/Recharts via `tokens.ts`, classes sémantiques.
- **AC-2 i18n/glossaire** : libellés FR/EN/AR pour BGM, AGP, GMI, ICR, HbA1c (namespace `glossary`) avant tout affichage ; logs jamais i18n.
- **AC-3 A11y** (gate `accessibility-tester`) : segments période/vue et onglets en `role=tablist` + clavier ; dialog drawer (`aria-modal`, focus) ; contraste WCAG AA des nouvelles pills/courbes.
- **AC-4 Lazy-load** : aucune donnée d'onglet inactif dans le payload/DOM (proscrire le `display:none` de la maquette côté React).
- **AC-5 Audit/perf** : 1 READ par agrégat, `metadata` sans PHI (`patientId`, `period`, `surface`), export = **`EXPORT`** ; debounce des refetch ; pas d'inflation `audit_logs`.

## Notes
Gate finale `accessibility-tester` + `healthcare-security-auditor`. Couvre archi US-L + invariants HDS (lazy-load, EXPORT, title sans PHI).
