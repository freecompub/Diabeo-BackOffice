# J-P-02 — Saisie repas + calcul bolus + injection

> 🟢 Priorité **MVP** · Persona **Patient quotidien** · 7 écrans · 132 SP cumulés (×plat)

---

## Séquence d'écrans

1. [SCR-P-325 — Tableau de bord journalier ⭐](../by-category/15-suivi/SCR-P-325-tableau-de-bord-journalier.md)
2. [SCR-P-261 — Saisie repas (entrée principale)](../by-category/06-repas/SCR-P-261-saisie-repas-entree-principale.md)
3. [SCR-P-263 — Recherche aliments (bibliothèque)](../by-category/06-repas/SCR-P-263-recherche-aliments-bibliotheque.md)
4. [SCR-P-266 — Détail aliment (avant ajout)](../by-category/06-repas/SCR-P-266-detail-aliment-avant-ajout.md)
5. [SCR-P-267 — Composition repas en cours](../by-category/06-repas/SCR-P-267-composition-repas-en-cours.md)
6. [SCR-P-254 — Calculateur bolus](../by-category/05-insuline/SCR-P-254-calculateur-bolus.md)
7. [SCR-P-256 — Saisie manuelle injection](../by-category/05-insuline/SCR-P-256-saisie-manuelle-injection.md)

---

## Représentation flow (Mermaid)

```mermaid
flowchart TD
    N0["SCR-P-325<br/>Tableau de bord journalier ⭐"]
    N1["SCR-P-261<br/>Saisie repas (entrée principale)"]
    N2["SCR-P-263<br/>Recherche aliments (bibliothèque)"]
    N3["SCR-P-266<br/>Détail aliment (avant ajout)"]
    N4["SCR-P-267<br/>Composition repas en cours"]
    N5["SCR-P-254<br/>Calculateur bolus"]
    N6["SCR-P-256<br/>Saisie manuelle injection"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
    N4 --> N5
    N5 --> N6
```

---

## Notes

- Ce parcours doit être validé par un PO produit avant développement
- Tests E2E recommandés sur le parcours complet (1 spec par parcours critique)
- Le SP cumulé tient compte du multiplicateur plateformes (×3 pour 'all', ×2 pour 'mobile')
