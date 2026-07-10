# Préparation delivery — Checklist go-live (gates ops/DPO transverses)

> Document opérationnel **gouvernance** : centralise les **bloqueurs de mise en
> production qui ne sont PAS du code** (signatures DPO/RSSI, flips de flags ops,
> sign-off runbooks). Le code correspondant est **merge-ready** ; ces actions sont
> de la **gouvernance / ops**, à réaliser par l'équipe Diabeo (non-dev) avant
> d'exposer la fonctionnalité à des **patients réels**.
>
> Les checklists **par-feature** détaillées vivent à côté (ex.
> [`preprod-checklist-us2026.md`](preprod-checklist-us2026.md) pour l'INS) ; ce
> fichier est l'**index consolidé** de ce qui reste à faire pour livrer.

---

## Légende sévérité

| Marqueur | Signification |
|---|---|
| 🔴 **HARD** | Ne PAS déployer/activer en prod tant que non-résolu. Risque CNIL/HDS/MDR direct. |
| 🟠 **CONDITIONAL** | Bloqueur SI périmètre de déploiement > X. Sinon acceptable, risque documenté. |
| 🟡 **SOFT** | Acceptable de différer avec risque documenté DPO. |

---

## 🔴 GATE #1 — Activation du cron générateur de propositions (US-2645 / US-2651)

**Statut code : ✅ merge-ready.** Le générateur multi-levier (ICR/basal/ISF/fixedDose +
dé-escalade active des hypos récurrentes) et le cron `generate-proposals` sont livrés,
testés et **inertes en prod** tant que le flag d'activation n'est pas posé.

### Ce qui reste (hors code)

1. 🔴 **Mettre à jour la DPIA au périmètre LIVRÉ, PUIS la faire signer.**
   ⚠️ **Pré-requis** : [`dpia-us2651-proposal-generator.md`](dpia-us2651-proposal-generator.md) est
   actuellement rédigée pour le **chemin ICR seul** (§ header « ISF/basal/fixedDose à venir »,
   « mean-vs-nadir US-2653 » listé en angle mort). Le moteur livré couvre **4 leviers (ICR + ISF +
   basal + fixedDose) + flags d'orientation mode-c + dé-escalade active US-2653**. Signer la DPIA
   en l'état ferait valider un périmètre **plus étroit** que ce qui tourne → non-conformité
   **RGPD Art. 35** (la DPIA doit décrire le traitement *réel*). Donc : (a) actualiser la DPIA au
   périmètre livré, puis (b) **signature** par **DPO + RSSI + Direction Médicale** (contenu clinique :
   titration multi-levier, garde-fous, frontière dispositif médical **MDR / IEC 62304**). Sans DPIA
   à jour signée : risque audit CNIL (Art. 35) / non-renouvellement **HDS** (cf. précédent bloqueur INS).
2. 🔴 **Information patient / transparence de l'aide algorithmique (Art. 13/14 RGPD).** Item laissé
   **ouvert par la DPIA elle-même** (§3.2 / §5 « Information patient — à intégrer aux CGU/politique de
   confidentialité », non coché). Activer une titration automatisée nocturne sur des patients réels
   **sans** mention de l'assistance algorithmique dans les CGU / la politique de confidentialité est
   une violation Art. 13/14 **indépendante** de la signature DPIA. Cadrage **Art. 22** : traitement
   **doctor-gated** (toute sortie `pending`, validée par un médecin) → décision automatisée à effet
   juridique **non strictement applicable** (position DPIA §3.2), mais à **documenter**. Owner : DPO
   (+ juriste pour les CGU), comme la ligne INS.
3. 🔴 **Ops pose le flag** `PROPOSAL_CRON_ENABLED=true` (OVH Vault / secret manager) **+ restart**.
   Par défaut/absent → cron **désactivé** (fail-safe). Cf. runbook
   [`../runbook/cron-proposal-generator.md`](../runbook/cron-proposal-generator.md) **§0**
   (procédure pas-à-pas : DPIA à jour + signée → flag → planification du cron).
4. 🔴 **Vérification post-activation OBLIGATOIRE** (runbook) : 1er run observé (advisory lock, audit
   run-level, volumétrie des propositions `pending`), **aucune proposition auto-appliquée** (ADR #13 —
   tout reste doctor-gated). C'est le moment unique où une auto-application inattendue ou une anomalie
   de volume serait détectée avant exposition aux patients réels.
5. 🟠 **Rétention** : confirmer la politique de conservation des `AdjustmentProposal` générées et de
   leur **piste d'audit immuable** (`audit_logs`, ~5 ans — traçabilité **HDS Art. L.1111-8 CSP**),
   ou la rattacher explicitement à la politique de rétention globale (RGPD Art. 5(1)(e)). La DPIA ne
   documente à ce jour que la fenêtre d'**entrée** glissante de 14 j, pas la rétention des **sorties**.

### Rappel de sûreté (déjà garanti par le code)

- **Aucune dose n'est jamais auto-appliquée** : toute sortie est une `AdjustmentProposal`
  `pending`, validée par un médecin (ADR #13). L'auto-application experte a été **retirée**
  (ADR #28, PR #714).
- **Frontière MDR** : un patient `nonInsulin` ne reçoit **aucune** proposition de dose
  (uniquement des `ClinicalReviewFlag` d'orientation), re-imposée par `createEngineProposal`.
- **Anti-cliquet** : dé-escalade bornée + cooldown moteur 72 h (US-2653).

### Owner / effort

| Action | Sévérité | Owner principal | Support | Effort |
|---|---|---|---|---|
| MàJ DPIA au périmètre livré + signature | 🔴 HARD | **DPO** | RSSI + Direction Médicale | ~1 réunion + itérations |
| Information patient CGU / politique (Art. 13/14) | 🔴 HARD | **DPO** | Juriste | ~2-5 j (cf. précédent CGU INS) |
| Flip `PROPOSAL_CRON_ENABLED` + restart | 🔴 HARD | **Ops / DevOps** | — | ~30 min |
| Vérification 1er run (obligatoire avant patients réels) | 🔴 HARD | **Ops** | Backend (astreinte) | ~1 h observation |
| Rétention sorties + audit trail | 🟠 CONDITIONAL | **DPO** | Backend | ~1 j (ou rattachement politique globale) |

**Références réglementaires** : RGPD **Art. 35** (DPIA), **Art. 22** (décision automatisée — doctor-gated
→ non strictement applicable, à documenter), **Art. 13/14** (transparence aide algorithmique),
**Art. 5(1)(e)** (rétention) · **HDS Art. L.1111-8 CSP** (traçabilité) · **MDR / IEC 62304** (frontière
dispositif médical). **Sources internes** : PR #666→#687 (générateur), #717 (dé-escalade US-2653) ·
runbook `cron-proposal-generator.md` §0 · DPIA `dpia-us2651-proposal-generator.md` · garde-fous cliniques
`docs/clinical-logic/algorithme-propositions-ajustement.md` · ADR #13 (jamais auto-appliqué), #28 (retrait auto-application).

---

## Autres gates par-feature

| Feature | Checklist détaillée | Statut |
|---|---|---|
| INS (Identité Nationale Santé, US-2026) | [`preprod-checklist-us2026.md`](preprod-checklist-us2026.md) | 🔴 gouvernance (DPIA + CGU + runbook HMAC) |

*(Ajouter ici toute nouvelle feature dont le go-live dépend d'un gate ops/DPO.)*
