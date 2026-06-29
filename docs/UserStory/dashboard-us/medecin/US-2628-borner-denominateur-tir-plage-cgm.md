# US-2628 — Borner le dénominateur du TIR par patient à la plage CGM physiologique

> 📌 **medecin** · Priorité **V2** · Type **TECH-DEBT** · Suivi de US-2625

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2628` |
| **Type** | Dette technique (cohérence agrégats CGM) |
| **Priorité** | **V2** |
| **Story points** | **1** |
| **Composant** | `src/lib/services/doctor-dashboard.service.ts` (calcul TIR par patient + KPI cabinet) |

---

## 📋 Contexte

Le TIR par patient (US-2625, carte Alertes) compte au **dénominateur** toutes les lignes
`CgmEntry` de la fenêtre 14 j, **sans filtrer** la plage physiologiquement valide
`CGM_AGGREGATE_RANGE_GL` (0,20–6,00 g/L) que `analytics.service` / `population-analytics`
appliquent à leurs agrégats. Des artefacts capteur hors plage gonfleraient marginalement
le dénominateur et **sous-estimeraient** le TIR.

Impact **faible** en pratique : le `CHECK` base (`value_gl BETWEEN 0.20 AND 6.00`,
`prisma/sql/cgm_partitioning.sql`) couvre déjà la plage, et le KPI cabinet du même fichier
a le **même comportement** (cohérent en interne). À aligner pour homogénéité et robustesse
si la contrainte base évoluait.

---

## ✅ Critères d'acceptation

### AC-1 — Dénominateur borné
```gherkin
Étant donné le calcul du TIR par patient (et le KPI cabinet)
Quand le total des relevés est compté
Alors il applique le filtre valueGl ∈ CGM_AGGREGATE_RANGE_GL (0,20–6,00 g/L)
```

### AC-2 — Cohérence inter-services
```gherkin
Étant donné les agrégats TIR de doctor-dashboard, analytics et population-analytics
Quand on compare la plage CGM du dénominateur
Alors elle est identique (source unique CGM_AGGREGATE_RANGE_GL)
```

---

## 🔗 Liens

- Révélé par la revue de US-2625 (note LOW medical-domain-validator)
- Source : `src/lib/clinical-bounds.ts` (`CGM_AGGREGATE_RANGE_GL`)
