# US-2627 — Unifier le seuil de capture TIR (`MIN_CAPTURE_RATE`)

> 📌 **medecin** · Priorité **V2** · Type **TECH-DEBT** · Suivi de US-2625

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2627` |
| **Type** | Dette technique (cohérence source unique) |
| **Priorité** | **V2** |
| **Story points** | **1** |
| **Composant** | `src/lib/clinical-bounds.ts`, `src/lib/services/population-analytics.service.ts` |

---

## 📋 Contexte

US-2625 a introduit `DASHBOARD_TIR.MIN_CAPTURE_RATE = 30` dans `clinical-bounds.ts`
(plancher de suffisance du TIR par patient). `population-analytics.service.ts:47`
conserve un `const MIN_CAPTURE_RATE = 30` **local et dupliqué**. Les valeurs sont
identiques aujourd'hui → comportement correct, mais **double source** = risque de dérive
silencieuse si l'une évolue sans l'autre.

`clinical-bounds.ts` étant la « SINGLE SOURCE OF TRUTH » des bornes cliniques (et un module
sans dépendance serveur), il doit porter cette constante.

---

## ✅ Critères d'acceptation

### AC-1 — Source unique
```gherkin
Étant donné le seuil de capture TIR
Quand population-analytics l'utilise
Alors il importe DASHBOARD_TIR.MIN_CAPTURE_RATE depuis clinical-bounds (plus de const local)
```

### AC-2 — Aucune régression
```gherkin
Étant donné la suite de tests population-analytics + clinical-bounds
Quand le refactor est appliqué
Alors tous les tests restent verts (valeur 30 % inchangée)
```

---

## 🔗 Liens

- Révélé par la revue de US-2625 (note LOW medical-domain-validator)
- À garder cohérent avec `analytics.service.ts` (`MIN_CAPTURE_RATE = 70` — fenêtre individuelle, sémantique distincte : ne pas fusionner aveuglément)
