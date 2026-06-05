# language: fr
# Source : docs/qa/03-patients.md — Détail patient (contrat API + RBAC)
Fonctionnalité: Détail d'un patient

  Scénario: un DOCTOR accède à un patient de son portefeuille
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/patients/1"
    Alors le statut de la réponse est 200
    Et le corps contient "DT1"

  Scénario: accès refusé à un patient hors portefeuille / inexistant
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/patients/99999"
    Alors le statut de la réponse est 403

  Scénario: identifiant patient invalide
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/patients/abc"
    Alors le statut de la réponse est 400
