# language: fr
# Source : docs/qa/07-dashboards-analytics.md — analytics glycémiques (contrat API)
# Précondition seed : le DOCTOR appelant a un consentement RGPD (requireGdprConsent
# porte sur l'appelant) ET le patient 1 lui est accessible (canAccessPatient).
Fonctionnalité: Analytics glycémiques

  Scénario: un DOCTOR consulte le profil glycémique d'un patient
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/analytics/glycemic-profile?period=7d&patientId=1"
    Alors le statut de la réponse est 200

  Scénario: un DOCTOR consulte le temps dans la cible
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/analytics/time-in-range?period=7d&patientId=1"
    Alors le statut de la réponse est 200

  Scénario: période hors bornes (> 90 jours)
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/analytics/glycemic-profile?period=999d&patientId=1"
    Alors le statut de la réponse est 400

  Scénario: patient non résolu (patientId manquant pour un PS)
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/analytics/glycemic-profile?period=7d"
    Alors le statut de la réponse est 404
