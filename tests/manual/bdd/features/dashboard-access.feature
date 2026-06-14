# language: fr
# Source : docs/qa/02-dashboards.md — Dashboard médecin (RBAC)
Fonctionnalité: Accès au tableau de bord médecin selon le rôle

  Scénario: un DOCTOR accède à son tableau de bord
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je vais sur "/medecin"
    Alors je vois le titre "Ma journée"
    # Effet base attendu : AUCUN (écran en lecture seule)

  Scénario: un VIEWER est redirigé hors du tableau de bord médecin
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand je vais sur "/medecin"
    Alors je suis redirigé vers "/patient/dashboard"
