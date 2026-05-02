# Diabeo BackOffice — User Stories US-2001 → US-2213

Ce dossier contient **213 User Stories** générées à partir de l'inventaire fonctionnel
([Diabeo_Inventaire_Fonctionnalites.xlsx](../Diabeo_Inventaire_Fonctionnalites.xlsx)).

Chaque US suit le format complet : métadonnées, contexte métier, critères d'acceptation,
règles métier, modèle Prisma, routes API, scénarios d'erreur, plan de test 3 niveaux,
définition de Done, ressources.

## Convention

- **ID** : `US-2001` à `US-2213`
- **Numérotation alignée** sur l'inventaire (`FN-001` → `US-2001`)
- **Priorités** : MVP, V1, V2, V3, V4
- **Organisation** : un dossier par domaine (22 domaines)

## Statistiques

| Priorité | Nombre |
|----------|-------:|
| MVP | 53 |
| MVP/POC | 1 |
| V1 | 100 |
| V2 | 40 |
| V3 | 4 |
| V4 | 15 |
| **TOTAL** | **213** |


## Index par domaine

### 1. Auth & Sécurité (15 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2001](01-auth-securite/US-2001-login-jwt.md) | Login JWT | MVP | Universel | Non |
| [US-2002](01-auth-securite/US-2002-2fa-totp.md) | 2FA TOTP | MVP | Universel | Non |
| [US-2003](01-auth-securite/US-2003-reset-password-email.md) | Reset password email | MVP | Universel | Oui |
| [US-2004](01-auth-securite/US-2004-captcha-anti-bot.md) | Captcha anti-bot | V1 | Universel | Oui |
| [US-2005](01-auth-securite/US-2005-verrouillage-tentatives.md) | Verrouillage tentatives | MVP | Universel | Non |
| [US-2006](01-auth-securite/US-2006-politique-mot-de-passe.md) | Politique mot de passe | MVP | Universel | Non |
| [US-2007](01-auth-securite/US-2007-sessions-multiples.md) | Sessions multiples | V1 | Universel | Non |
| [US-2008](01-auth-securite/US-2008-pro-sante-connect-psc.md) | Pro Santé Connect (PSC) | V1 | FR | Oui |
| [US-2009](01-auth-securite/US-2009-carte-cps.md) | Carte CPS | V2 | FR | Oui |
| [US-2010](01-auth-securite/US-2010-e-cps.md) | e-CPS | V1 | FR | Oui |
| [US-2011](01-auth-securite/US-2011-audit-log-immuable.md) | Audit log immuable | MVP | Universel | Non |
| [US-2012](01-auth-securite/US-2012-rbac-4-roles.md) | RBAC 4 rôles | MVP | Universel | Non |
| [US-2013](01-auth-securite/US-2013-consentement-rgpd.md) | Consentement RGPD | MVP | Universel | Non |
| [US-2014](01-auth-securite/US-2014-notification-violation.md) | Notification violation | V2 | FR | Non |
| [US-2015](01-auth-securite/US-2015-chiffrement-aes-256-gcm.md) | Chiffrement AES-256-GCM | MVP | Universel | Non |

### 2. Patients (13 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2016](02-patients/US-2016-liste-patients-filtrable.md) | Liste patients filtrable | MVP | Universel | Non |
| [US-2017](02-patients/US-2017-creation-onboarding-patient.md) | Création / onboarding patient | MVP | Universel | Non |
| [US-2018](02-patients/US-2018-fiche-patient-complete.md) | Fiche patient complète | MVP | Universel | Non |
| [US-2019](02-patients/US-2019-recherche-full-text.md) | Recherche full-text | V1 | Universel | Non |
| [US-2020](02-patients/US-2020-archivage-soft-delete.md) | Archivage / soft delete | MVP | Universel | Non |
| [US-2021](02-patients/US-2021-transfert-patient-medecin.md) | Transfert patient médecin | V1 | Universel | Non |
| [US-2022](02-patients/US-2022-tags-categorisation.md) | Tags & catégorisation | V1 | Universel | Non |
| [US-2023](02-patients/US-2023-notes-cliniques.md) | Notes cliniques | MVP | Universel | Non |
| [US-2024](02-patients/US-2024-historique-modifications.md) | Historique modifications | V1 | Universel | Non |
| [US-2025](02-patients/US-2025-invitation-mobile-qr-code.md) | Invitation mobile QR code | MVP | Universel | Non |
| [US-2026](02-patients/US-2026-ins-identite-nationale-sante.md) | INS — Identité Nationale Santé | V1 | FR | Oui |
| [US-2027](02-patients/US-2027-import-export-cohorte.md) | Import / export cohorte | V2 | Universel | Non |
| [US-2028](02-patients/US-2028-dossier-multi-praticiens.md) | Dossier multi-praticiens | V1 | Universel | Non |

### 3. Glycémie & CGM (13 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2029](03-glycemie-cgm/US-2029-ingestion-cgm-dexcom.md) | Ingestion CGM Dexcom | MVP | FR+DZ | Oui |
| [US-2030](03-glycemie-cgm/US-2030-ingestion-freestyle-libre.md) | Ingestion FreeStyle Libre | MVP | FR+DZ | Oui |
| [US-2031](03-glycemie-cgm/US-2031-ingestion-medtronic-guardian.md) | Ingestion Medtronic Guardian | V1 | FR+DZ | Oui |
| [US-2032](03-glycemie-cgm/US-2032-glycemies-capillaires-bgm.md) | Glycémies capillaires (BGM) | V1 | FR+DZ | Partiel |
| [US-2033](03-glycemie-cgm/US-2033-temps-dans-la-cible-tir.md) | Temps dans la cible (TIR) | MVP | Universel | Non |
| [US-2034](03-glycemie-cgm/US-2034-profil-agp.md) | Profil AGP | MVP | Universel | Non |
| [US-2035](03-glycemie-cgm/US-2035-gmi-hba1c-estimee.md) | GMI / HbA1c estimée | MVP | Universel | Non |
| [US-2036](03-glycemie-cgm/US-2036-coefficient-de-variation.md) | Coefficient de variation | MVP | Universel | Non |
| [US-2037](03-glycemie-cgm/US-2037-detection-hypo-hyper.md) | Détection hypo/hyper | MVP | Universel | Non |
| [US-2038](03-glycemie-cgm/US-2038-heat-map-glycemique.md) | Heat-map glycémique | V1 | Universel | Non |
| [US-2039](03-glycemie-cgm/US-2039-comparaison-de-periodes.md) | Comparaison de périodes | V1 | Universel | Non |
| [US-2040](03-glycemie-cgm/US-2040-rapport-agp-exportable-pdf.md) | Rapport AGP exportable PDF | V1 | Universel | Non |
| [US-2041](03-glycemie-cgm/US-2041-detection-patterns-recurrents.md) | Détection patterns récurrents | V2 | Universel | Non |

### 4. Insulinothérapie (11 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2042](04-insulinotherapie/US-2042-schema-basal-bolus.md) | Schéma basal/bolus | MVP | Universel | Non |
| [US-2043](04-insulinotherapie/US-2043-donnees-pompe-a-insuline.md) | Données pompe à insuline | V1 | FR+DZ | Oui |
| [US-2044](04-insulinotherapie/US-2044-ratios-glucides-ic.md) | Ratios glucides (IC) | MVP | Universel | Non |
| [US-2045](04-insulinotherapie/US-2045-facteur-sensibilite-fs.md) | Facteur sensibilité (FS) | MVP | Universel | Non |
| [US-2046](04-insulinotherapie/US-2046-profils-basaux-pompe.md) | Profils basaux pompe | MVP | Universel | Non |
| [US-2047](04-insulinotherapie/US-2047-workflow-ajustement-3-etapes.md) | Workflow ajustement 3 étapes | MVP | Universel | Non |
| [US-2048](04-insulinotherapie/US-2048-bornes-securite-validation.md) | Bornes sécurité validation | MVP | Universel | Non |
| [US-2049](04-insulinotherapie/US-2049-calcul-de-bolus.md) | Calcul de bolus | MVP | Universel | Non |
| [US-2050](04-insulinotherapie/US-2050-templates-ajustement.md) | Templates ajustement | V1 | Universel | Non |
| [US-2051](04-insulinotherapie/US-2051-historique-modifications.md) | Historique modifications | MVP | Universel | Non |
| [US-2052](04-insulinotherapie/US-2052-comparaison-mdi-vs-pompe.md) | Comparaison MDI vs pompe | V2 | Universel | Non |

### 5. Repas & glucides (6 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2053](05-repas-glucides/US-2053-saisie-repas-patient.md) | Saisie repas patient | V1 | Universel | Non |
| [US-2054](05-repas-glucides/US-2054-bibliotheque-aliments-france.md) | Bibliothèque aliments France | V1 | FR | Oui |
| [US-2055](05-repas-glucides/US-2055-bibliotheque-aliments-algerie.md) | Bibliothèque aliments Algérie | V2 | DZ | Partiel |
| [US-2056](05-repas-glucides/US-2056-comptage-glucides-assiste.md) | Comptage glucides assisté | V2 | Universel | Non |
| [US-2057](05-repas-glucides/US-2057-photos-repas.md) | Photos repas | V1 | Universel | Oui |
| [US-2058](05-repas-glucides/US-2058-reconnaissance-image-repas.md) | Reconnaissance image repas | V4 | Universel | Oui |

### 6. Activité physique (4 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2059](06-activite-physique/US-2059-journal-activite.md) | Journal activité | V1 | Universel | Non |
| [US-2060](06-activite-physique/US-2060-apple-healthkit.md) | Apple HealthKit | V1 | FR+DZ | Oui |
| [US-2061](06-activite-physique/US-2061-google-fit-health-connect.md) | Google Fit / Health Connect | V1 | FR+DZ | Oui |
| [US-2062](06-activite-physique/US-2062-impact-glycemique-effort.md) | Impact glycémique effort | V2 | Universel | Non |

### 7. Téléconsult & ajustements (10 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2063](07-teleconsult-ajustements/US-2063-creation-proposition-ajustement.md) | Création proposition ajustement | MVP | Universel | Non |
| [US-2064](07-teleconsult-ajustements/US-2064-notification-patient.md) | Notification patient | MVP | Universel | Oui |
| [US-2065](07-teleconsult-ajustements/US-2065-accuse-de-reception-patient.md) | Accusé de réception patient | V1 | Universel | Non |
| [US-2066](07-teleconsult-ajustements/US-2066-suivi-application-reelle.md) | Suivi application réelle | V1 | Universel | Non |
| [US-2067](07-teleconsult-ajustements/US-2067-visioconference-integree.md) | Visioconférence intégrée | V4 | FR | Oui |
| [US-2068](07-teleconsult-ajustements/US-2068-notes-consultation.md) | Notes consultation | V1 | Universel | Non |
| [US-2069](07-teleconsult-ajustements/US-2069-generation-ordonnance-numerique.md) | Génération ordonnance numérique | V4 | FR | Oui |
| [US-2070](07-teleconsult-ajustements/US-2070-planification-suivi.md) | Planification suivi | V1 | Universel | Non |
| [US-2071](07-teleconsult-ajustements/US-2071-templates-consultation.md) | Templates consultation | V1 | Universel | Non |
| [US-2072](07-teleconsult-ajustements/US-2072-facturation-acte-teleconsult.md) | Facturation acte téléconsult | V1 | FR | Non |

### 8. Messagerie & notifs (8 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2073](08-messagerie-notifs/US-2073-push-notifications-mobile.md) | Push notifications mobile | MVP | Universel | Oui |
| [US-2074](08-messagerie-notifs/US-2074-email-transactionnel.md) | Email transactionnel | MVP | Universel | Oui |
| [US-2075](08-messagerie-notifs/US-2075-sms-d-alerte-critique.md) | SMS d'alerte critique | V4 | FR+DZ | Oui |
| [US-2076](08-messagerie-notifs/US-2076-messagerie-securisee-patient-ps.md) | Messagerie sécurisée patient↔PS | V1 | Universel | Non |
| [US-2077](08-messagerie-notifs/US-2077-mssante.md) | MSSanté | V1 | FR | Oui |
| [US-2078](08-messagerie-notifs/US-2078-templates-de-messages.md) | Templates de messages | V1 | Universel | Non |
| [US-2079](08-messagerie-notifs/US-2079-preferences-notification.md) | Préférences notification | MVP | Universel | Non |
| [US-2080](08-messagerie-notifs/US-2080-accuses-de-lecture.md) | Accusés de lecture | V1 | Universel | Non |

### 9. Équipe & cabinet (8 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2081](09-equipe-cabinet/US-2081-cabinet-multi-utilisateurs.md) | Cabinet multi-utilisateurs | MVP | Universel | Non |
| [US-2082](09-equipe-cabinet/US-2082-affectation-soignant-referent.md) | Affectation soignant référent | MVP | Universel | Non |
| [US-2083](09-equipe-cabinet/US-2083-delegation-medecin-ide.md) | Délégation médecin → IDE | V1 | Universel | Non |
| [US-2084](09-equipe-cabinet/US-2084-remplacement-conges.md) | Remplacement / congés | V1 | Universel | Non |
| [US-2085](09-equipe-cabinet/US-2085-astreinte-rotation.md) | Astreinte / rotation | V2 | Universel | Non |
| [US-2086](09-equipe-cabinet/US-2086-handoff-entre-soignants.md) | Handoff entre soignants | V1 | Universel | Non |
| [US-2087](09-equipe-cabinet/US-2087-chat-interne-equipe.md) | Chat interne équipe | V2 | Universel | Partiel |
| [US-2088](09-equipe-cabinet/US-2088-groupes-patients-par-equipe.md) | Groupes patients par équipe | V1 | Universel | Non |

### 10. Dispositifs (5 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2089](10-dispositifs/US-2089-pairing-device.md) | Pairing device | MVP | FR+DZ | Oui |
| [US-2090](10-dispositifs/US-2090-statut-synchronisation.md) | Statut synchronisation | MVP | Universel | Non |
| [US-2091](10-dispositifs/US-2091-compatibilite-materielle.md) | Compatibilité matérielle | V1 | Universel | Non |
| [US-2092](10-dispositifs/US-2092-desactivation-revocation.md) | Désactivation / révocation | V1 | Universel | Non |
| [US-2093](10-dispositifs/US-2093-historique-des-dispositifs.md) | Historique des dispositifs | V1 | Universel | Non |

### 11. Analytics & reporting (7 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2094](11-analytics-reporting/US-2094-tableau-de-bord-population.md) | Tableau de bord population | V1 | Universel | Non |
| [US-2095](11-analytics-reporting/US-2095-indicateurs-qualite.md) | Indicateurs qualité | V1 | Universel | Non |
| [US-2096](11-analytics-reporting/US-2096-cohorte-par-pathologie.md) | Cohorte par pathologie | V1 | Universel | Non |
| [US-2097](11-analytics-reporting/US-2097-comparaison-cabinet-reseau.md) | Comparaison cabinet/réseau | V2 | Universel | Non |
| [US-2098](11-analytics-reporting/US-2098-export-csv-excel.md) | Export CSV / Excel | V1 | Universel | Non |
| [US-2099](11-analytics-reporting/US-2099-rapports-personnalisables.md) | Rapports personnalisables | V2 | Universel | Partiel |
| [US-2100](11-analytics-reporting/US-2100-indicateurs-charge-soignant.md) | Indicateurs charge soignant | V2 | Universel | Non |

### 12. Facturation (11 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2101](12-facturation/US-2101-stripe-paiement-en-ligne.md) | Stripe paiement en ligne | V4 | FR+DZ | Oui |
| [US-2102](12-facturation/US-2102-virement-bancaire-facture-pdf.md) | Virement bancaire + facture PDF | V1 | FR+DZ | Partiel |
| [US-2103](12-facturation/US-2103-facturation-au-patient-fr.md) | Facturation au patient (FR) | V1 | FR | Non |
| [US-2104](12-facturation/US-2104-abonnement-dz.md) | Abonnement (DZ) | V1 | DZ | Non |
| [US-2105](12-facturation/US-2105-numerotation-sequentielle-pays.md) | Numérotation séquentielle pays | V1 | FR+DZ | Non |
| [US-2106](12-facturation/US-2106-webhooks-idempotents-stripe.md) | Webhooks idempotents Stripe | V1 | Universel | Non |
| [US-2107](12-facturation/US-2107-versioning-facture-immuable.md) | Versioning facture immuable | V1 | Universel | Non |
| [US-2108](12-facturation/US-2108-relances-automatiques.md) | Relances automatiques | V1 | Universel | Non |
| [US-2109](12-facturation/US-2109-remboursements.md) | Remboursements | V1 | Universel | Oui |
| [US-2110](12-facturation/US-2110-tva-multi-pays.md) | TVA multi-pays | V1 | FR+DZ | Partiel |
| [US-2111](12-facturation/US-2111-comptabilite-export.md) | Comptabilité export | V2 | FR | Non |

### 13. Multi-pays & i18n (5 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2112](13-multi-pays-i18n/US-2112-internationalisation-fr-ar.md) | Internationalisation FR/AR | MVP | FR+DZ | Non |
| [US-2113](13-multi-pays-i18n/US-2113-devises-eur-dzd.md) | Devises EUR / DZD | V1 | FR+DZ | Non |
| [US-2114](13-multi-pays-i18n/US-2114-regles-fiscales-par-pays.md) | Règles fiscales par pays | V1 | FR+DZ | Non |
| [US-2115](13-multi-pays-i18n/US-2115-formats-date-nombre-localises.md) | Formats date/nombre localisés | MVP | FR+DZ | Non |
| [US-2116](13-multi-pays-i18n/US-2116-reglementation-sante-par-pays.md) | Réglementation santé par pays | V1 | FR+DZ | Non |

### 14. Entités orga (6 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2117](14-entites-orga/US-2117-cabinets-medicaux.md) | Cabinets médicaux | MVP | Universel | Non |
| [US-2118](14-entites-orga/US-2118-medecins-liberaux.md) | Médecins libéraux | MVP | Universel | Non |
| [US-2119](14-entites-orga/US-2119-reseaux-de-soins.md) | Réseaux de soins | V1 | FR | Non |
| [US-2120](14-entites-orga/US-2120-mutuelles-assurances.md) | Mutuelles / assurances | V2 | FR+DZ | Non |
| [US-2121](14-entites-orga/US-2121-hopitaux-unites-hospi.md) | Hôpitaux / unités hospi | V2 | Universel | Non |
| [US-2122](14-entites-orga/US-2122-multi-sites-pour-groupes.md) | Multi-sites pour groupes | V2 | Universel | Non |

### 15. Interopérabilité (9 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2123](15-interoperabilite/US-2123-hl7-fhir-r4.md) | HL7 FHIR R4 | V1 | Universel | Oui |
| [US-2124](15-interoperabilite/US-2124-dmp-mon-espace-sante.md) | DMP / Mon Espace Santé | V1 | FR | Oui |
| [US-2125](15-interoperabilite/US-2125-mssante.md) | MSSanté | V4 | FR | Oui |
| [US-2126](15-interoperabilite/US-2126-ins-identifiant-national.md) | INS — Identifiant National | V1 | FR | Oui |
| [US-2127](15-interoperabilite/US-2127-pro-sante-connect.md) | Pro Santé Connect | V1 | FR | Oui |
| [US-2128](15-interoperabilite/US-2128-e-prescription-nationale-sep.md) | e-prescription nationale (SeP) | V2 | FR | Oui |
| [US-2129](15-interoperabilite/US-2129-hprim-resultats-labo.md) | HPRIM / résultats labo | V2 | FR | Oui |
| [US-2130](15-interoperabilite/US-2130-referencement-segur.md) | Référencement Ségur | V2 | FR | Oui |
| [US-2131](15-interoperabilite/US-2131-api-publique-partenaires.md) | API publique partenaires | V2 | Universel | Non |

### 16. Conformité & RGPD (8 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2132](16-conformite-rgpd/US-2132-audit-log-immuable.md) | Audit log immuable | MVP | Universel | Non |
| [US-2133](16-conformite-rgpd/US-2133-retention-6-ans-logs.md) | Rétention 6 ans logs | MVP | FR | Non |
| [US-2134](16-conformite-rgpd/US-2134-export-rgpd-article-15.md) | Export RGPD Article 15 | MVP | FR | Non |
| [US-2135](16-conformite-rgpd/US-2135-effacement-rgpd-article-17.md) | Effacement RGPD Article 17 | MVP | FR | Non |
| [US-2136](16-conformite-rgpd/US-2136-pseudonymisation.md) | Pseudonymisation | MVP | Universel | Non |
| [US-2137](16-conformite-rgpd/US-2137-notification-violation-cnil.md) | Notification violation CNIL | V1 | FR | Non |
| [US-2138](16-conformite-rgpd/US-2138-hebergement-hds-certifie.md) | Hébergement HDS certifié | MVP | FR | Oui |
| [US-2139](16-conformite-rgpd/US-2139-certification-hds-editeur.md) | Certification HDS éditeur | V4 | FR | Oui |

### 17. Documents & fichiers (7 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2140](17-documents-fichiers/US-2140-upload-via-s3-compatible.md) | Upload via S3-compatible | MVP | Universel | Oui |
| [US-2141](17-documents-fichiers/US-2141-categorisation-typee.md) | Catégorisation typée | MVP | Universel | Non |
| [US-2142](17-documents-fichiers/US-2142-versioning-fichiers.md) | Versioning fichiers | V1 | Universel | Non |
| [US-2143](17-documents-fichiers/US-2143-signature-electronique-qualifiee-eidas.md) | Signature électronique qualifiée eIDAS | V4 | FR | Oui |
| [US-2144](17-documents-fichiers/US-2144-ocr-documents-scannes.md) | OCR documents scannés | V2 | Universel | Oui |
| [US-2145](17-documents-fichiers/US-2145-generation-pdf-a-3.md) | Génération PDF/A-3 | V1 | Universel | Non |
| [US-2146](17-documents-fichiers/US-2146-partage-temporaire-securise.md) | Partage temporaire sécurisé | V1 | Universel | Non |

### 18. Admin système (7 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2147](18-admin-systeme/US-2147-parametres-cabinet.md) | Paramètres cabinet | V1 | Universel | Non |
| [US-2148](18-admin-systeme/US-2148-gestion-users-rbac.md) | Gestion users RBAC | MVP | Universel | Non |
| [US-2149](18-admin-systeme/US-2149-customisation-branding.md) | Customisation branding | V2 | Universel | Non |
| [US-2150](18-admin-systeme/US-2150-dashboard-sante-systeme.md) | Dashboard santé système | V1 | Universel | Non |
| [US-2151](18-admin-systeme/US-2151-gestion-backups.md) | Gestion backups | MVP | Universel | Non |
| [US-2152](18-admin-systeme/US-2152-statut-services-public.md) | Statut services public | V2 | Universel | Oui |
| [US-2153](18-admin-systeme/US-2153-logs-applicatifs-centralises.md) | Logs applicatifs centralisés | V1 | Universel | Oui |

### 19. IA & aide décision (6 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2154](19-ia-aide-decision/US-2154-reconnaissance-patterns-cgm.md) | Reconnaissance patterns CGM | V2 | Universel | Non |
| [US-2155](19-ia-aide-decision/US-2155-prediction-risque-hypo.md) | Prédiction risque hypo | V3 | Universel | Non |
| [US-2156](19-ia-aide-decision/US-2156-stratification-patients.md) | Stratification patients | V2 | Universel | Non |
| [US-2157](19-ia-aide-decision/US-2157-suggestion-ajustement-ia.md) | Suggestion ajustement IA | V3 | Universel | Partiel |
| [US-2158](19-ia-aide-decision/US-2158-detection-anomalies-port-capteur.md) | Détection anomalies port capteur | V2 | Universel | Non |
| [US-2159](19-ia-aide-decision/US-2159-resume-periode-teleconsult.md) | Résumé période téléconsult | V2 | Universel | Oui |

### 20. Éducation thérapeutique (4 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2160](20-education-therapeutique/US-2160-bibliotheque-ressources-patients.md) | Bibliothèque ressources patients | V2 | FR+DZ | Non |
| [US-2161](20-education-therapeutique/US-2161-contenus-personnalises-profil.md) | Contenus personnalisés profil | V2 | Universel | Non |
| [US-2162](20-education-therapeutique/US-2162-quiz-educatifs.md) | Quiz éducatifs | V3 | Universel | Non |
| [US-2163](20-education-therapeutique/US-2163-suivi-programme-etp.md) | Suivi programme ETP | V3 | FR | Non |

### 21. Ops & monitoring (5 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2164](21-ops-monitoring/US-2164-apm-monitoring.md) | APM monitoring | V1 | Universel | Oui |
| [US-2165](21-ops-monitoring/US-2165-tracking-erreurs.md) | Tracking erreurs | V1 | Universel | Oui |
| [US-2166](21-ops-monitoring/US-2166-background-jobs.md) | Background jobs | V1 | Universel | Non |
| [US-2167](21-ops-monitoring/US-2167-disaster-recovery.md) | Disaster recovery | V1 | FR | Oui |
| [US-2168](21-ops-monitoring/US-2168-metrics-business-temps-reel.md) | Metrics business temps réel | V1 | Universel | Oui |

### 22. Prescription & ordonnances (45 US)

| ID | Titre | Priorité | Pays | Externe |
|----|-------|---------:|------|---------|
| [US-2169](22-prescription-ordonnances/US-2169-editeur-ordonnance-structuree.md) | Éditeur ordonnance structurée | V1 | FR+DZ | Non |
| [US-2170](22-prescription-ordonnances/US-2170-base-medicamenteuse-certifiee-has.md) | Base médicamenteuse certifiée HAS | V4 | FR | Oui |
| [US-2171](22-prescription-ordonnances/US-2171-base-medic-publique-gratuite.md) | Base médic. publique gratuite | MVP/POC | FR | Oui |
| [US-2172](22-prescription-ordonnances/US-2172-lap-certifie-has-turnkey.md) | LAP certifié HAS turnkey | V4 | FR | Oui |
| [US-2173](22-prescription-ordonnances/US-2173-certification-has-lap-propre.md) | Certification HAS LAP propre | V4 | FR | Oui |
| [US-2174](22-prescription-ordonnances/US-2174-templates-prescription-recurrents.md) | Templates prescription récurrents | V1 | Universel | Non |
| [US-2175](22-prescription-ordonnances/US-2175-renouvellement-1-clic.md) | Renouvellement 1 clic | V1 | Universel | Non |
| [US-2176](22-prescription-ordonnances/US-2176-alertes-interactions-medic.md) | Alertes interactions médic. | V1 | FR | Oui |
| [US-2177](22-prescription-ordonnances/US-2177-alertes-contre-indications.md) | Alertes contre-indications | V1 | FR | Oui |
| [US-2178](22-prescription-ordonnances/US-2178-alertes-allergies-patient.md) | Alertes allergies patient | V1 | Universel | Non |
| [US-2179](22-prescription-ordonnances/US-2179-prescription-insuline.md) | Prescription insuline | V1 | FR+DZ | Non |
| [US-2180](22-prescription-ordonnances/US-2180-prescription-cgm-remboursable.md) | Prescription CGM remboursable | V1 | FR | Partiel |
| [US-2181](22-prescription-ordonnances/US-2181-prescription-pompe-consommables.md) | Prescription pompe + consommables | V1 | FR | Non |
| [US-2182](22-prescription-ordonnances/US-2182-prescription-bandelettes-aiguilles.md) | Prescription bandelettes / aiguilles | V1 | FR+DZ | Non |
| [US-2183](22-prescription-ordonnances/US-2183-prescription-glucagon-urgence.md) | Prescription glucagon urgence | V1 | Universel | Non |
| [US-2184](22-prescription-ordonnances/US-2184-prescription-etp.md) | Prescription ETP | V2 | FR | Non |
| [US-2185](22-prescription-ordonnances/US-2185-prescription-auto-surveillance.md) | Prescription auto-surveillance | V1 | FR | Non |
| [US-2186](22-prescription-ordonnances/US-2186-prescription-examens-bio.md) | Prescription examens bio | V1 | Universel | Non |
| [US-2187](22-prescription-ordonnances/US-2187-prescription-ide-a-domicile.md) | Prescription IDE à domicile | V1 | FR | Non |
| [US-2188](22-prescription-ordonnances/US-2188-prescription-consult-diet-podo.md) | Prescription consult diét/podo | V2 | FR | Non |
| [US-2189](22-prescription-ordonnances/US-2189-bon-de-transport-medicalise.md) | Bon de transport médicalisé | V2 | FR | Non |
| [US-2190](22-prescription-ordonnances/US-2190-signature-eidas-qualifiee.md) | Signature eIDAS qualifiée | V4 | FR | Oui |
| [US-2191](22-prescription-ordonnances/US-2191-signature-carte-cps.md) | Signature carte CPS | V2 | FR | Oui |
| [US-2192](22-prescription-ordonnances/US-2192-signature-e-cps.md) | Signature e-CPS | V1 | FR | Oui |
| [US-2193](22-prescription-ordonnances/US-2193-cachet-electronique-cabinet.md) | Cachet électronique cabinet | V4 | FR | Oui |
| [US-2194](22-prescription-ordonnances/US-2194-horodatage-qualifie.md) | Horodatage qualifié | V4 | FR | Oui |
| [US-2195](22-prescription-ordonnances/US-2195-qr-code-verif-authenticite.md) | QR code vérif authenticité | V1 | Universel | Non |
| [US-2196](22-prescription-ordonnances/US-2196-datamatrix-2d-doc-ants.md) | DataMatrix 2D-Doc ANTS | V1 | FR | Oui |
| [US-2197](22-prescription-ordonnances/US-2197-generation-pdf-a-3-ordonnance.md) | Génération PDF/A-3 ordonnance | V1 | Universel | Non |
| [US-2198](22-prescription-ordonnances/US-2198-verrouillage-post-signature.md) | Verrouillage post-signature | V1 | Universel | Non |
| [US-2199](22-prescription-ordonnances/US-2199-format-cerfa-bizone-ald.md) | Format CERFA bizone ALD | V1 | FR | Non |
| [US-2200](22-prescription-ordonnances/US-2200-mention-non-substituable.md) | Mention non substituable | V1 | FR | Non |
| [US-2201](22-prescription-ordonnances/US-2201-numerotation-sequentielle-anti-fraude.md) | Numérotation séquentielle anti-fraude | V1 | FR | Non |
| [US-2202](22-prescription-ordonnances/US-2202-transmission-e-prescription-nationale.md) | Transmission e-prescription nationale | V1 | FR | Oui |
| [US-2203](22-prescription-ordonnances/US-2203-envoi-via-mon-espace-sante.md) | Envoi via Mon Espace Santé | V1 | FR | Oui |
| [US-2204](22-prescription-ordonnances/US-2204-envoi-via-mssante.md) | Envoi via MSSanté | V4 | FR | Oui |
| [US-2205](22-prescription-ordonnances/US-2205-tracking-dispensation-officine.md) | Tracking dispensation officine | V2 | FR | Oui |
| [US-2206](22-prescription-ordonnances/US-2206-renouvellement-programme.md) | Renouvellement programmé | V1 | Universel | Non |
| [US-2207](22-prescription-ordonnances/US-2207-annulation-revocation-urgence.md) | Annulation / révocation urgence | V1 | Universel | Non |
| [US-2208](22-prescription-ordonnances/US-2208-audit-immuable-prescriptions.md) | Audit immuable prescriptions | V1 | FR | Non |
| [US-2209](22-prescription-ordonnances/US-2209-format-ordonnance-algerie.md) | Format ordonnance Algérie | V2 | DZ | Partiel |
| [US-2210](22-prescription-ordonnances/US-2210-bilingue-fr-ar-rtl.md) | Bilingue FR/AR (RTL) | V2 | DZ | Non |
| [US-2211](22-prescription-ordonnances/US-2211-pharmacovigilance-ansm.md) | Pharmacovigilance ANSM | V2 | FR | Oui |
| [US-2212](22-prescription-ordonnances/US-2212-statistiques-prescriptions.md) | Statistiques prescriptions | V2 | Universel | Non |
| [US-2213](22-prescription-ordonnances/US-2213-co-signature-obligatoire.md) | Co-signature obligatoire | V2 | Universel | Non |

