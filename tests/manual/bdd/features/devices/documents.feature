# language: fr
# Source : docs/qa/10-devices-documents-events.md — documents médicaux (contrat API)
Fonctionnalité: Documents médicaux

  Scénario: un patient liste ses documents
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand j'appelle GET "/api/documents"
    Alors le statut de la réponse est 200
