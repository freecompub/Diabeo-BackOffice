# language: fr
# Source : docs/qa/04-appointments.md — annulation RDV (effet base UPDATE)
Fonctionnalité: Annulation d'un rendez-vous

  Scénario: un DOCTOR annule un RDV qu'il a créé
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je crée un RDV pour le patient 1 et le membre 1
    Alors le statut de la réponse est 201
    Quand j'annule le RDV créé en tant que "doctor"
    Alors le statut de la réponse est 200
    Et le RDV créé a le statut "cancelled" en base
    # Effet base: UPDATE appointments(status=cancelled, cancelledBy, cancelReasonEncrypted) + audit
