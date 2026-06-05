# language: fr
# Source : docs/qa/11-clinical.md — propositions d'ajustement (contrat API)
Fonctionnalité: Propositions d'ajustement

  Scénario: un DOCTOR liste les propositions d'un patient
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/adjustment-proposals?patientId=1"
    Alors le statut de la réponse est 200

  Scénario: patientId manquant
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/adjustment-proposals"
    Alors le statut de la réponse est 404
