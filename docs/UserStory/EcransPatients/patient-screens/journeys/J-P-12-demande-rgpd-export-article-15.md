# J-P-12 — Demande RGPD export Article 15

> 🟢 Priorité **MVP** · Persona **Patient** · 3 écrans · 39 SP cumulés (×plat)

---

## Séquence d'écrans

1. [SCR-P-225 — Mon profil (vue principale)](../by-category/03-profil/SCR-P-225-mon-profil-vue-principale.md)
2. [SCR-P-371 — Liste consentements](../by-category/24-rgpd/SCR-P-371-liste-consentements.md)
3. [SCR-P-374 — Export données personnelles (Art. 15)](../by-category/24-rgpd/SCR-P-374-export-donnees-personnelles-art-15.md)

---

## Représentation flow (Mermaid)

```mermaid
flowchart TD
    N0["SCR-P-225<br/>Mon profil (vue principale)"]
    N1["SCR-P-371<br/>Liste consentements"]
    N2["SCR-P-374<br/>Export données personnelles (Art. 15)"]
    N0 --> N1
    N1 --> N2
```

---

## Notes

- Ce parcours doit être validé par un PO produit avant développement
- Tests E2E recommandés sur le parcours complet (1 spec par parcours critique)
- Le SP cumulé tient compte du multiplicateur plateformes (×3 pour 'all', ×2 pour 'mobile')
