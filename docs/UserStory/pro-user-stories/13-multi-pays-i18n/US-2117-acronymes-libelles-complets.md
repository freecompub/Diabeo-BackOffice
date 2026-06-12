# US-2117 — Acronymes explicités dans l'affichage client (jamais d'acronyme nu)

> Follow-up transverse de [US-2112c](./US-2112c-i18n-dashboard-medecin.md) (i18n dashboard,
> DONE). L'i18n a traduit le contenu, mais de nombreux **acronymes restaient nus** côté
> client (« TIR », « CGM », « RGPD », « RDV », « FSI »…), illisibles pour un utilisateur
> non initié et risqués en contexte médical (ambiguïté clinique). Cette US fige la règle
> « jamais d'acronyme nu » et l'outille.

---

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2117` |
| **Domaine** | 13. Multi-pays & i18n |
| **Priorité** | **V1** |
| **Pays cible** | Universel |
| **Statut** | 🟢 DONE |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | US-2112 (moteur i18n, DONE) |
| **Sprint cible** | 2026-06-12 |

---

## 📋 Contexte métier

Un acronyme nu (« TIR », « FSI », « RGPD ») n'est pas compréhensible par tous les
utilisateurs et, en contexte médical, crée un **risque d'ambiguïté clinique**. La règle
produit : **tout acronyme visible par le client doit être explicité**.

## ✅ Règle (critères d'acceptation)

1. **Aucun acronyme nu** dans l'affichage client (médical, réglementaire, métier).
2. Deux formats selon le contexte de rendu :
   - **Acronyme + infobulle** (préféré) quand rendu par un composant → `<Acronym code="…" />`
     (libellé issu du namespace i18n `glossary`, FR/EN/AR, source unique) ;
   - **« Libellé (ACRONYME) »** inline quand l'acronyme est dans une phrase (pas d'infobulle posable).
3. **Exceptions** :
   - `RDV` → toujours « Rendez-vous » (libellé seul) ;
   - `MAJ` → toujours « Mise à jour » (libellé seul) ;
   - acronymes **techniques universels** (`PDF`, `CSV`, `PNG/JPG`, `API`, `USB`, `JSON`)
     et **noms de produits** (`G7`…) laissés tels quels.
4. Règle appliquée sur **les 3 langues** (`messages/fr|en|ar.json`).
5. Tout nouvel acronyme affiché → ajouter son libellé au `glossary` **avant** usage.

## 🛠️ Implémentation

- Composant `src/components/diabeo/Acronym.tsx` (`<Acronym code>` → acronyme + `Tooltip` +
  `aria-label`, `TooltipProvider` intégré → autonome).
- Namespace `glossary` dans `messages/{fr,en,ar}.json` (médical, réglementaire, métier).
- Câblage des acronymes en dur (PatientCard `TIR`, page détail patient `TIR`/`ICR`/`ISF`,
  graphe AGP, registre violations RGPD) + explicitation inline des ~109 chaînes i18n.
- Règle documentée : `CLAUDE.md` §Acronymes, `docs/i18n.md`, `docs/design-system/components.md`.

## 🧪 Tests

`tests/unit/acronyms.test.ts` :
- complétude du `glossary` (chaque `AcronymCode` a une clé dans **les 3 langues**) ;
- garde anti-régression (pas d'acronyme nu réintroduit dans les valeurs i18n, hors exceptions) ;
- rendu `<Acronym>` (acronyme visible + libellé en `aria-label`/infobulle).
