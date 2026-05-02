# J-20 — Vérification dispositifs cabinet (proactivité)

> 🔵 Priorité **V1** · Persona **DOCTOR** · 4 écrans · 26 SP cumulés

---

## Séquence d'écrans

1. [SCR-183 — Statut sync temps réel cohorte](../by-category/12-dispositifs/SCR-183-statut-sync-temps-reel-cohorte.md)
2. [SCR-184 — Détection dispositifs défaillants](../by-category/12-dispositifs/SCR-184-detection-dispositifs-defaillants.md)
3. [SCR-132 — Fiche patient — Vue d'ensemble](../by-category/05-fichepatient/SCR-132-fiche-patient-vue-d-ensemble.md)
4. [SCR-202 — Composer message (templates)](../by-category/15-messagerie/SCR-202-composer-message-templates.md)

---

## Représentation flow (Mermaid)

```mermaid
flowchart TD
    N0["SCR-183<br/>Statut sync temps réel cohorte"]
    N1["SCR-184<br/>Détection dispositifs défaillants"]
    N2["SCR-132<br/>Fiche patient — Vue d'ensemble"]
    N3["SCR-202<br/>Composer message (templates)"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
```

---

## Notes

- Ce parcours doit être validé par un PO produit avant développement
- Chaque écran de la séquence est documenté individuellement (cf liens ci-dessus)
- Tests E2E Playwright recommandés sur le parcours complet (1 spec par parcours critique)
