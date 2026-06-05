# language: fr
# Source : docs/qa/08-admin-ops.md — Santé système (/admin/system-health)
# Dette (itération ultérieure) : le scénario QA « alerte tentatives élevées »
# (highlight UI quand unauthorizedAttempts24h > 100) n'est pas porté ici — c'est
# une assertion d'affichage + un état difficile à seeder. On porte le snapshot
# (présence des sections) et le RBAC, robustes et sans état.
Fonctionnalité: Santé système

  Scénario: snapshot santé pour un ADMIN
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/system-health"
    Alors le statut de la réponse est 200
    Et le corps contient "components"
    Et le corps contient "unauthorizedAttempts24h"

  Scénario: un non-ADMIN ne voit pas la santé système
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/admin/system-health"
    Alors le statut de la réponse est 403
