# language: fr
# Source : docs/qa/09-admin-compliance-billing.md — factures (contrat API)
# Précondition seed : cabinetId=1 = le service du DOCTOR seed (cf. me-memberships
# serviceId=1) → membre → 200. Sur un autre ordre d'insertion, résoudre l'id.
Fonctionnalité: Factures

  Scénario: un DOCTOR liste les factures d'un cabinet
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/billing/invoices?cabinetId=1"
    Alors le statut de la réponse est 200

  Scénario: scope manquant (ni cabinetId ni patientId)
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/billing/invoices?status=issued"
    Alors le statut de la réponse est 400

  Scénario: un VIEWER ne peut pas lister les factures cabinet
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand j'appelle GET "/api/billing/invoices?cabinetId=1"
    Alors le statut de la réponse est 403
