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
| **Stockage BGM** | **une seule colonne** `glycemia_gl` `Decimal(6,4)`, **nullable** (la glycémie est une mesure *optionnelle* d'une entrée BGM — poids / HbA1c / tension seuls possibles) + `CHECK (glycemia_gl IS NULL OR glycemia_gl BETWEEN 0.20 AND 6.00)`. Colonne `glycemia_mgdl` **supprimée** (backfill `glycemia_gl = COALESCE(glycemia_gl, glycemia_mgdl/100)` avant `DROP`). |
| **Conversion** | **module unique** `src/lib/glucose/units.ts` (pur, sans dépendance Prisma/Redis → importable client + serveur). Toute conversion `g/L↔mg/dL↔mmol/L` y transite. |
| **Logique clinique** | **inchangée** (déjà g/L). Aucun seuil clinique touché. |
| **Emergency** | conserve sa décision en mg/dL (seul décideur mg/dL) — inchangé fonctionnellement. Sa conversion `×100` utilise aujourd'hui une constante locale (`GL_TO_MGDL`) équivalente au module ; migration vers `glucose/units` = follow-up (logique clinique-interne, hors périmètre strict). |
| **API** | contrat **g/L inchangé** en sortie CGM (`valueGl`). `POST …/glycemia` **n'accepte plus que `glycemiaGl`** (Zod 0,20–6,00) ; `GET …/glycemia` renvoie `glycemiaGl` seul. |
| **Affichage** | conversion à la **présentation** selon `UserUnitPreferences.unitGlycemia` (3=g/L, 4=mg/dL, 5=mmol/L) via `formatGlucose()`. Fin des `round(valueGl*100)` dupliqués. |
| **Export RGPD** | valeurs g/L **avec libellé d'unité explicite** (`"g/L"`). |

### Objectifs / cibles / ISF

Restent en **g/L** (faible volume, non concernés par le bug dual-unité). `GlucoseTarget.targetGlucose`,
`DiabetesEvent`, `EmergencyAlert` restent en **mg/dL** (tables de décision/événement, hors flux de
mesure) — îlots assumés, convertis à la frontière (via le module ou une constante
locale équivalente `×100`).

---

## 3. Conséquences

**Positives**
- Élimine le double-stockage BGM (racine du fail-open) et pose enfin les CHECK de bornes.
- **Zéro réécriture / repartitionnement de données** sur la table CGM partitionnée (gros volume) — S1 n'y ajoute qu'un `CHECK` (pas de rewrite de lignes) ; **zéro rupture de contrat API**.
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
| **S4** | Migration destructive : `CHECK` (NULL-toléré) sur `glycemia_gl`, `DROP glycemia_mgdl` ; export g/L labellisé. | **oui (destructif)** |

---

## 5. Alternatives écartées

- **mg/dL canonique** (décision initiale) : migration lourde de la table CGM partitionnée,
  frontière de conversion sur ~30 seuils, rupture API — coût injustifié une fois l'iOS hors
  périmètre.
- **Conserver le dual-unité + garde de cohérence applicative** : ne supprime pas la classe de
  bug (deux sources de vérité), complexité pérenne.

---

## 6. Follow-ups (tracés, non bloquants pour cette PR)

Issus de la review multi-agents (médical / sécurité HDS / a11y / code / archi) de la PR :

- **`useGlucoseUnit` = 1 fetch par composant + flash mg/dL→g/L** (jusqu'à 4 fetchs parallèles
  sur la fiche patient). Remonter la préférence dans un **Context/provider hydraté serveur**
  (ou dédup SWR/React Query) — perf + cohérence d'affichage. **Rattacher à US-3248.** *(priorité la plus haute)*
- **Îlots mg/dL non routés par le module** : `emergency.service` (`GL_TO_MGDL` local),
  `insulin.service`, `adjustment.service`, `proposal-generator`, `overview-targets.ts` — conversions
  clinique-interne au niveau des seuils/décisions. Migration optionnelle vers `glucose/units`.
- **Composants `GlucoseBadge`/`GlucoseCard`** : leur `convertValue` duplique `formatGlucose`
  (`/100`, `/18.0182`) — actuellement **non utilisés** (à nettoyer ou migrer si réactivés).
- **`GlycemiaValue.convertValue`** : dédupliquer la table de précision + rendre locale-aware
  (routage `Intl` comme le reste de l'app) au lieu de `toFixed`.
- **Dashboard médecin** : `profile.hba1c`/`profile.cv` lus au niveau racine alors que l'API
  `glycemic-profile` expose `metrics.coefficientOfVariation` et pas de `hba1c` top-level —
  **bug pré-existant** (KPI potentiellement vides), hors périmètre unité.
- **Audit RTL arabe** (traducteur natif / test lecteur d'écran) sur les libellés paramétrés
  `{unit}`, et **tests SR** (NVDA/JAWS/VoiceOver) de l'annonce d'unité dynamique.
- **Export RGPD** : décrypter `glycemiaEntries.mealDescription` (aligné sur les messages) —
  lacune de portabilité pré-existante.

---

*ADR lié : #21 (fiche patient unifiée — transports), #31 (grouped-only ; « pas encore en
production »). Voir aussi US-3248 (préférence d'affichage patient, couche présentation).*
