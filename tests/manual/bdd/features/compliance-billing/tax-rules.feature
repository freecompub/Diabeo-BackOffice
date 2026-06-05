# language: fr
# Source : docs/qa/09-admin-compliance-billing.md — règles fiscales (contrat API, NURSE+)
# Précondition seed : aucun CountryTaxRule FR/VAT n'est seedé → 404 noActiveRule
# (si US-2110 ajoute un seed de taux FR, ce scénario passera à 200).
Fonctionnalité: Règles fiscales (TVA)

  Scénario: aucun taux actif pour le pays/type demandé
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/config/tax-rules/active?countryCode=FR&taxType=VAT&date=2026-06-05"
    Alors le statut de la réponse est 404
    Et le corps contient "noActiveRule"

  Scénario: code pays invalide
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/config/tax-rules/active?countryCode=Z&taxType=VAT"
    Alors le statut de la réponse est 400

  Scénario: type de taxe invalide
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/config/tax-rules/active?countryCode=FR&taxType=BOGUS"
    Alors le statut de la réponse est 400
