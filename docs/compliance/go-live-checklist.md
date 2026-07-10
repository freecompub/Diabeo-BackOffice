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

1. **Signature de la DPIA** [`dpia-us2651-proposal-generator.md`](dpia-us2651-proposal-generator.md)
   par **DPO** (+ **RSSI** si requis) + **Direction Médicale** (contenu clinique : titration
   de dose, garde-fous, frontière dispositif médical). Sans DPIA signée : risque audit CNIL
   (Art. 35) / non-renouvellement HDS (cf. précédent bloqueur INS).
2. **Ops pose le flag** `PROPOSAL_CRON_ENABLED=true` (OVH Vault / secret manager) **+ restart**.
   Par défaut/absent → cron **désactivé** (fail-safe). Cf. runbook
   [`../runbook/cron-proposal-generator.md`](../runbook/cron-proposal-generator.md) **§0**
   (procédure pas-à-pas : DPO signe → flag → planification du cron).
3. **Vérification post-activation** (runbook) : 1er run observé (advisory lock, audit run-level,
   volumétrie des propositions `pending`), aucune proposition auto-appliquée (ADR #13 — tout
   reste doctor-gated).

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
| Signature DPIA générateur | 🔴 HARD | **DPO** | RSSI + Direction Médicale | ~1 réunion + itérations |
| Flip `PROPOSAL_CRON_ENABLED` + restart | 🔴 HARD | **Ops / DevOps** | — | ~30 min |
| Vérification 1er run | 🟠 CONDITIONAL | **Ops** | Backend (astreinte) | ~1 h observation |

**Références** : PR #666→#687 (générateur), #717 (dé-escalade US-2653) · runbook
`cron-proposal-generator.md` §0 · DPIA `dpia-us2651-proposal-generator.md` · ADR #13, #28.

---

## Autres gates par-feature

| Feature | Checklist détaillée | Statut |
|---|---|---|
| INS (Identité Nationale Santé, US-2026) | [`preprod-checklist-us2026.md`](preprod-checklist-us2026.md) | 🔴 gouvernance (DPIA + CGU + runbook HMAC) |

*(Ajouter ici toute nouvelle feature dont le go-live dépend d'un gate ops/DPO.)*
