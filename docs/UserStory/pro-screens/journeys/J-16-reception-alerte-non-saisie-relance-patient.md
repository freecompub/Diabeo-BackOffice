# J-16 — Réception alerte non-saisie + relance patient

> 🔵 Priorité **V1** · Persona **DOCTOR** · 4 écrans · 18 SP cumulés

---

## Séquence d'écrans

1. Dashboard médecin
2. [SCR-119 — Card 'Patients à suivre'](../by-category/03-dashboard/SCR-119-card-patients-a-suivre.md)
3. [SCR-132 — Fiche patient — Vue d'ensemble](../by-category/05-fichepatient/SCR-132-fiche-patient-vue-d-ensemble.md)
4. [SCR-202 — Composer message (templates)](../by-category/15-messagerie/SCR-202-composer-message-templates.md)

---

## Représentation flow (Mermaid)

```mermaid
flowchart TD
    N0["?<br/>Dashboard médecin"]
    N1["SCR-119<br/>Card 'Patients à suivre'"]
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
