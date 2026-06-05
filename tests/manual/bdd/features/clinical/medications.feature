# language: fr
# Source : docs/qa/11-clinical.md — recherche médicaments BDPM (contrat API)
Fonctionnalité: Recherche de médicaments
# Note : référentiel BDPM possiblement vide (import cron) → liste vide mais 200.

  Scénario: recherche par nom renvoie une réponse BDPM
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/medications/search?q=paracetamol"
    Alors le statut de la réponse est 200
    Et le corps contient "BDPM"
