# ADR #32 — Normalisation des unités glycémiques : **g/L canonique**

> **Statut** : Accepté (2026-07-14)
> **Épic** : normalisation unités glycémie CGM/BGM
> **Remplace** : la décision initiale « mg/dL canonique » (2026-07-08), **inversée** (voir § Contexte)
> **Source d'état des lieux** : [`docs/clinical-logic/inventaire-unites-glycemie-cgm-bgm.md`](../clinical-logic/inventaire-unites-glycemie-cgm-bgm.md)
> **Catalogue clinique** : [`docs/clinical-logic/regles-et-constantes-diabete.md`](../clinical-logic/regles-et-constantes-diabete.md) §3

---

## 1. Contexte

Le backoffice manipule la glycémie (CGM continu + BGM capillaire) dans **deux unités**
mélangées à travers les couches — g/L au cœur clinique, mg/dL aux frontières (ingestion,
affichage, alertes). L'inventaire exhaustif (~35 fichiers) a révélé **une fragilité
structurelle** et non un simple désordre cosmétique :

- **Double-stockage BGM sans garde de cohérence** : `glycemia_entries` porte **deux
  colonnes** nullables `glycemia_gl` (g/L) **et** `glycemia_mgdl` (mg/dL). `POST …/glycemia`
  accepte l'une **OU** l'autre **sans dériver ni vérifier la seconde** ; la lecture privilégie
  g/L, repli mg/dL. → risque *fail-open* (une entrée mg/dL-only a déjà provoqué un fail-open
  C6, corrigé au coup par coup par `COALESCE` en #706).
- **CHECK de bornes absents ou en drift** : le `CHECK value_gl BETWEEN 0.20 AND 6.00` (CGM)
  ne vit que dans `prisma/sql/cgm_partitioning.sql` (fichier de **référence**, **non appliqué**
  par les migrations versionnées) ; **aucun** CHECK sur les colonnes BGM.
- **Conversion `×100` dupliquée** : `round(valueGl*100)` est ré-implémenté dans 4 fichiers
  front + 2 helpers `glToMgdl` distincts (`statistics.ts`, `mydiabby-mapper`).

### Pourquoi la cible passe de mg/dL à g/L

La décision d'épic initiale (2026-07-08) visait **mg/dL canonique**. Deux faits ont conduit
à **l'inverser** le 2026-07-14 :

1. **L'application iOS n'existe pas encore.** Le seul coût réel qui justifiait mg/dL
   (rupture de contrat API + coordination release Swift, alignement iOS) **tombe à zéro** :
   il n'existe aucun consommateur externe réclamant du mg/dL entier.
2. **Le cœur du code est déjà en g/L.** Stockage CGM (`value_gl`), algorithme de proposition,
   statistiques (TIR/AGP/GMI/nadir), objectifs, seuils cliniques (~30 constantes), **et la
   source externe réelle MyDiabby** envoient/manipulent du **g/L**.

**Le vrai bug n'est pas l'unité choisie, c'est le DOUBLE-stockage.** Choisir **une** unité
canonique le corrige — quelle qu'elle soit. Le « standard international mg/dL / mmol/L » est
un fait **d'affichage** (déjà couvert par `UserUnitPreferences.unitGlycemia`), **pas de
stockage**. Retenir g/L comme unité canonique **supprime la fragilité** au coût le plus bas
(pas de migration de la table CGM partitionnée, seuils cliniques inchangés, contrat API
inchangé).

---

## 2. Décision

**g/L est l'unité canonique de stockage ET de contrat API** pour toute mesure de glycémie
CGM/BGM. La convention de conversion reste **`1 g/L = 100 mg/dL`** (jamais ×18 ; le facteur
molaire ÷18,0182 n'apparaît **que** pour l'affichage mmol/L).

| Couche | Décision |
|---|---|
| **Stockage CGM** | `CgmEntry.value_gl` `Decimal(6,4)` **inchangé** + `CHECK value_gl BETWEEN 0.20 AND 6.00` posé en **migration versionnée**. |
| **Stockage BGM** | **une seule colonne** `glycemia_gl` `Decimal(6,4)` `NOT NULL` + `CHECK BETWEEN 0.20 AND 6.00`. Colonne `glycemia_mgdl` **supprimée** (backfill `glycemia_gl = COALESCE(glycemia_gl, glycemia_mgdl/100)` avant `DROP`). |
| **Conversion** | **module unique** `src/lib/glucose/units.ts` (pur, sans dépendance Prisma/Redis → importable client + serveur). Toute conversion `g/L↔mg/dL↔mmol/L` y transite. |
| **Logique clinique** | **inchangée** (déjà g/L). Aucun seuil clinique touché. |
| **Emergency** | conserve sa décision en mg/dL (seul décideur mg/dL) via le module de conversion — inchangé fonctionnellement. |
| **API** | contrat **g/L inchangé** en sortie CGM (`valueGl`). `POST …/glycemia` **n'accepte plus que `glycemiaGl`** (Zod 0,20–6,00) ; `GET …/glycemia` renvoie `glycemiaGl` seul. |
| **Affichage** | conversion à la **présentation** selon `UserUnitPreferences.unitGlycemia` (3=g/L, 4=mg/dL, 5=mmol/L) via `formatGlucose()`. Fin des `round(valueGl*100)` dupliqués. |
| **Export RGPD** | valeurs g/L **avec libellé d'unité explicite** (`"g/L"`). |

### Objectifs / cibles / ISF

Restent en **g/L** (faible volume, non concernés par le bug dual-unité). `GlucoseTarget.targetGlucose`,
`DiabetesEvent`, `EmergencyAlert` restent en **mg/dL** (tables de décision/événement, hors flux de
mesure) — îlots assumés, convertis à la frontière via le module.

---

## 3. Conséquences

**Positives**
- Élimine le double-stockage BGM (racine du fail-open) et pose enfin les CHECK de bornes.
- **Zéro migration** sur la table CGM partitionnée (gros volume) ; **zéro rupture de contrat API**.
- Les ~30 seuils cliniques g/L restent **inchangés** → risque clinique minimal.
- Conversion centralisée et testée (round-trip *lossless* verrouillé par test).
- Affichage multi-unités (g/L / mg/dL / mmol/L) propre, piloté par la préférence patient.

**Négatives / limites**
- Persistance de 3 îlots mg/dL (`GlucoseTarget`/`DiabetesEvent`/`EmergencyAlert`) — assumé.
- `DROP COLUMN glycemia_mgdl` est **destructif** — acceptable car **backoffice pas encore en
  production** (aucune donnée patient réelle ; cf. ADR #31).
- Le round-trip `g/L → mg/dL → g/L` reste sans perte (`Decimal(6,4)` ↔ `Decimal(6,2)` via ×100).

---

## 4. Séquencement (slices)

| Slice | Contenu | Cassant |
|---|---|---|
| **S0** | Module `glucose/units.ts` + refactor des 6 sites de conversion + tests. | non |
| **S1** | Migration : `CHECK` CGM (versionné) + backfill `glycemia_gl`. Réconcilie le drift `cgm_partitioning.sql`. | non |
| **S2** | `POST /glycemia` g/L-only + lecture BGM g/L-only (route, `meal-trends`, `analytics`, `glycemia.service`, `mydiabby-sync`). | non |
| **S3** | Affichage : `formatGlucose(gl, unitGlycemia)` sur la préférence patient ; suppression des `round(valueGl*100)`. | non |
| **S4** | Migration destructive : `NOT NULL` + `CHECK` `glycemia_gl`, `DROP glycemia_mgdl` ; export g/L labellisé. | **oui (destructif)** |

---

## 5. Alternatives écartées

- **mg/dL canonique** (décision initiale) : migration lourde de la table CGM partitionnée,
  frontière de conversion sur ~30 seuils, rupture API — coût injustifié une fois l'iOS hors
  périmètre.
- **Conserver le dual-unité + garde de cohérence applicative** : ne supprime pas la classe de
  bug (deux sources de vérité), complexité pérenne.

---

*ADR lié : #21 (fiche patient unifiée — transports), #31 (grouped-only ; « pas encore en
production »). Voir aussi US-3248 (préférence d'affichage patient, couche présentation).*
