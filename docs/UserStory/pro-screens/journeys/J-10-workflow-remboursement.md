# J-10 — Workflow remboursement

> 🔵 Priorité **V1** · Persona **ADMIN** · 3 écrans · 15 SP cumulés

---

## Séquence d'écrans

1. [SCR-215 — Liste factures](../by-category/17-facturation/SCR-215-liste-factures.md)
2. [SCR-216 — Détail facture (lecture)](../by-category/17-facturation/SCR-216-detail-facture-lecture.md)
3. [SCR-220 — Remboursements (refund)](../by-category/17-facturation/SCR-220-remboursements-refund.md)

---

## Représentation flow (Mermaid)

```mermaid
flowchart TD
    N0["SCR-215<br/>Liste factures"]
    N1["SCR-216<br/>Détail facture (lecture)"]
    N2["SCR-220<br/>Remboursements (refund)"]
    N0 --> N1
    N1 --> N2
```

---

## Notes

- Ce parcours doit être validé par un PO produit avant développement
- Chaque écran de la séquence est documenté individuellement (cf liens ci-dessus)
- Tests E2E Playwright recommandés sur le parcours complet (1 spec par parcours critique)
