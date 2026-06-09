# Rapport d'exécution QA — {{NN-domaine}}.md

**Date** : {{YYYY-MM-DD}} · **Environnement** : `http://localhost:3000` (local) · **Exécution** : navigateur interactif · **Référence** : [`{{NN-domaine}}.md`]({{NN-domaine}}.md)

## Synthèse

| Scénario | Résultat |
|---|---|
| {{scénario 1}} | ✅ OK |
| {{scénario 2}} | ⚠️ Écart |
| {{scénario 3}} | ⏭️ N/A |
| … | … |

**{{X}} OK · {{Y}} écart · {{Z}} N/A · {{W}} KO** — {{anomalies connues confirmées}}.

## Détail

### Écran `{{/route}}`

- **{{Scénario / état}}** : {{observation}}. {{Conforme / écart / KO}}.
  - {{Référence réseau : POST /api/... → 200/401/403/429}}.
  - ⚠️ {{écart éventuel + correctif proposé}}.

## Non couvert dans cette session

- {{ex. effets base (audit_logs) — nécessite accès DB ou écran /audit}}
- {{ex. scénario MFA — pas de compte seed}}

## Annexe — captures d'écran

| Fichier | État capturé |
|---|---|
| `{{domaine}}_{{ecran}}_{{etat}}.jpg` | {{description}} |

## Recommandations

1. {{action}}
2. {{action}}
