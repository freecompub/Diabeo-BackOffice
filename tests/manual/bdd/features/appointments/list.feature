# language: fr
# Source : docs/qa/04-appointments.md — liste RDV (contrat API)
# Pré-requis seed : le DOCTOR gère le service du membre 1
# (assertMemberServiceAccess s'exécute avant la plage → sinon 403, pas 200/422).
Fonctionnalité: Liste des rendez-vous

  Scénario: un DOCTOR liste les RDV de son cabinet
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/appointments?from=2026-06-01&to=2026-07-31&memberId=1"
    Alors le statut de la réponse est 200

  Scénario: plage de dates trop large refusée
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/appointments?from=2026-05-01&to=2026-08-01&memberId=1"
    Alors le statut de la réponse est 422
    Et le corps contient "rangeTooLarge"

  Scénario: paramètres de plage manquants
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/appointments"
    Alors le statut de la réponse est 400
