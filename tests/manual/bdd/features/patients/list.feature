# language: fr
# Source : docs/qa/03-patients.md — Liste patients (contrat API + RBAC)
Fonctionnalité: Liste des patients

  Scénario: un NURSE peut lister les patients
    Étant donné que je suis connecté en tant que "NURSE"
    Quand j'appelle GET "/api/patients"
    Alors le statut de la réponse est 200

  Scénario: un VIEWER ne peut pas lister les patients
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand j'appelle GET "/api/patients"
    Alors le statut de la réponse est 403

  Scénario: la recherche par nom (match HMAC exact) renvoie le patient
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/patients/search?search=Durand"
    Alors le statut de la réponse est 200
    Et le corps contient "Durand"
