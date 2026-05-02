# J-06 — Activation mode grossesse

> 🟢 Priorité **MVP** · Persona **DOCTOR** · 4 écrans · 13 SP cumulés

---

## Séquence d'écrans

1. Liste patients
2. [SCR-132 — Fiche patient — Vue d'ensemble](../by-category/05-fichepatient/SCR-132-fiche-patient-vue-d-ensemble.md)
3. [SCR-171 — Activation mode grossesse](../by-category/10-modescontextuels/SCR-171-activation-mode-grossesse.md)
4. Configuration cibles glycémiques (cibles strictes obstétriques)

---

## Représentation flow (Mermaid)

```mermaid
flowchart TD
    N0["?<br/>Liste patients"]
    N1["SCR-132<br/>Fiche patient — Vue d'ensemble"]
    N2["SCR-171<br/>Activation mode grossesse"]
    N3["?<br/>Configuration cibles glycémiques (cibles strictes obstétriques)"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
```

---

## Notes

- Ce parcours doit être validé par un PO produit avant développement
- Chaque écran de la séquence est documenté individuellement (cf liens ci-dessus)
- Tests E2E Playwright recommandés sur le parcours complet (1 spec par parcours critique)
