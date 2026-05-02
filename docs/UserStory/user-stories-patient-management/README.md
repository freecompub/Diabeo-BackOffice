# Diabeo BackOffice — User Stories miroir patient management (US-2214 → US-2264)

**51 User Stories** complétant l'inventaire backoffice (US-2001 → US-2213) avec les fonctionnalités côté professionnel permettant de **configurer / superviser / orchestrer** ce que fait le patient dans son app mobile/web.

## Lien avec l'app patient

Ces US sont le **pendant côté pro** des fonctionnalités de l'app patient. Pour 47 d'entre elles, une référence directe vers l'US patient miroir est indiquée. Pour 4 US, il s'agit de fonctions purement organisationnelles côté pro (templates, coordination, exports).

## Statistiques

### Par priorité

| Priorité | Nombre |
|----------|-------:|
| MVP | 9 |
| V1 | 20 |
| V2 | 18 |
| V3 | 4 |
| **TOTAL** | **51** |

### Par catégorie

| Catégorie | Nombre |
|---|---:|
| 23. Configuration seuils & alertes patient | 10 |
| 24. Supervision urgences déclenchées | 8 |
| 25. Gestion modes contextuels (grossesse / pédiatrie / Ramadan / voyage) | 6 |
| 26. Gestion aidants & partages | 5 |
| 27. Gestion dispositifs patient (vue pro) | 5 |
| 28. Supervision repas & adhésion thérapeutique | 6 |
| 29. Programmes ETP supervisés | 6 |
| 30. Communication & messagerie pro → patient | 5 |

### Par archétype technique

| Archétype | Nombre | Sens |
|---|---:|------|
| monitoring | 17 | Vue de supervision côté médecin (cohortes, métriques, fraîcheur données) |
| config | 14 | Configuration médicale d'un paramètre patient (versioning, validation médicale) |
| workflow | 9 | Workflow métier multi-étapes (machine à états, transitions auditées) |
| orchestration | 7 | Orchestration automatisée (notifications, déclenchements, idempotence) |
| audit | 4 | Fonctionnalité d'audit / conformité (immuabilité, exports certifiés) |

## Index complet


### 23. Configuration seuils & alertes patient (10)

| ID | Titre | Priorité | SP | Archétype | US miroir patient |
|----|-------|---------:|---:|-----------|-------------------|
| [US-2214](23-config-seuils-alertes/US-2214-configuration-cibles-glycemiques-par-patient.md) | Configuration cibles glycémiques par patient | MVP | 5 | config | US-3174 (cibles glycémiques perso) |
| [US-2215](23-config-seuils-alertes/US-2215-configuration-seuils-alerte-hypo-hyper.md) | Configuration seuils alerte hypo/hyper | MVP | 5 | config | US-3280, US-3281 (détection seuils hypo) |
| [US-2216](23-config-seuils-alertes/US-2216-configuration-seuil-cetones.md) | Configuration seuil cétones | MVP | 3 | config | US-3303 (détection cétones) |
| [US-2217](23-config-seuils-alertes/US-2217-validation-protocole-resucrage-personnalise.md) | Validation protocole resucrage personnalisé | MVP | 3 | config | US-3286 (choix resucrage perso) |
| [US-2218](23-config-seuils-alertes/US-2218-configuration-contacts-d-urgence-patient.md) | Configuration contacts d'urgence patient | V1 | 3 | config | US-3331 (perso contacts urgence) |
| [US-2219](23-config-seuils-alertes/US-2219-definition-regles-d-escalade-urgence.md) | Définition règles d'escalade urgence | V1 | 5 | config | US-3291 (alerte auto contacts) |
| [US-2220](23-config-seuils-alertes/US-2220-templates-de-seuils-par-profil.md) | Templates de seuils par profil | V1 | 3 | config | — |
| [US-2221](23-config-seuils-alertes/US-2221-historique-versionne-des-configurations.md) | Historique versionné des configurations | V1 | 5 | audit | — |
| [US-2222](23-config-seuils-alertes/US-2222-workflow-d-approbation-modifications.md) | Workflow d'approbation modifications | V2 | 5 | workflow | — |
| [US-2223](23-config-seuils-alertes/US-2223-comparaison-configurations-patient.md) | Comparaison configurations patient | V2 | 3 | monitoring | — |

### 24. Supervision urgences déclenchées (8)

| ID | Titre | Priorité | SP | Archétype | US miroir patient |
|----|-------|---------:|---:|-----------|-------------------|
| [US-2224](24-supervision-urgences/US-2224-inbox-alertes-urgences-patient.md) | Inbox alertes urgences patient | MVP | 5 | monitoring | US-3334 (CR auto au médecin) |
| [US-2225](24-supervision-urgences/US-2225-detail-timeline-d-une-urgence.md) | Détail timeline d'une urgence | MVP | 5 | monitoring | US-3333 (journal urgences) |
| [US-2226](24-supervision-urgences/US-2226-workflow-reaction-medecin-post-urgence.md) | Workflow réaction médecin post-urgence | MVP | 5 | workflow | — |
| [US-2227](24-supervision-urgences/US-2227-bilan-trimestriel-urgences-par-patient.md) | Bilan trimestriel urgences par patient | V1 | 5 | monitoring | US-3336 (bilan trimestriel) |
| [US-2228](24-supervision-urgences/US-2228-statistiques-cohorte-urgences.md) | Statistiques cohorte urgences | V1 | 5 | monitoring | — |
| [US-2229](24-supervision-urgences/US-2229-detection-patterns-a-risque.md) | Détection patterns à risque | V1 | 8 | monitoring | US-3308, US-3309 (détection répétée) |
| [US-2230](24-supervision-urgences/US-2230-notification-temps-reel-urgence-patient.md) | Notification temps réel urgence patient | MVP | 3 | orchestration | — |
| [US-2231](24-supervision-urgences/US-2231-export-donnees-urgences-pour-audit.md) | Export données urgences pour audit | V2 | 3 | audit | — |

### 25. Gestion modes contextuels (grossesse / pédiatrie / Ramadan / voyage) (6)

| ID | Titre | Priorité | SP | Archétype | US miroir patient |
|----|-------|---------:|---:|-----------|-------------------|
| [US-2232](25-modes-contextuels/US-2232-activation-mode-grossesse.md) | Activation mode grossesse | MVP | 5 | config | US-3193 (config mode grossesse patient) |
| [US-2233](25-modes-contextuels/US-2233-activation-mode-pediatrique-multi-aidants.md) | Activation mode pédiatrique multi-aidants | V1 | 8 | config | US-3201 (compte enfant multi-aidants) |
| [US-2234](25-modes-contextuels/US-2234-configuration-mode-ramadan.md) | Configuration mode Ramadan | V1 | 5 | config | US-3260 (conseils saisonniers Ramadan) |
| [US-2235](25-modes-contextuels/US-2235-mode-voyage-fuseau-horaire.md) | Mode voyage / fuseau horaire | V1 | 3 | config | US-3255 (mode voyage patient) |
| [US-2236](25-modes-contextuels/US-2236-workflow-transition-adulte-16-18-ans.md) | Workflow transition adulte 16-18 ans | V2 | 5 | workflow | US-3206 (transition adulte) |
| [US-2237](25-modes-contextuels/US-2237-pai-numerique-enfant-scolaire.md) | PAI numérique enfant scolaire | V2 | 8 | workflow | US-3203 (PAI patient) |

### 26. Gestion aidants & partages (5)

| ID | Titre | Priorité | SP | Archétype | US miroir patient |
|----|-------|---------:|---:|-----------|-------------------|
| [US-2238](26-aidants-partages/US-2238-vue-aidants-declares-par-patient.md) | Vue aidants déclarés par patient | V1 | 3 | monitoring | US-3220 (invitation aidant) |
| [US-2239](26-aidants-partages/US-2239-audit-partages-temporaires.md) | Audit partages temporaires | V1 | 3 | audit | US-3036 (partage temporaire courbe) |
| [US-2240](26-aidants-partages/US-2240-validation-medicale-partage-tiers.md) | Validation médicale partage tiers | V2 | 5 | workflow | — |
| [US-2241](26-aidants-partages/US-2241-revocation-forcee-partage.md) | Révocation forcée partage | V2 | 3 | workflow | — |
| [US-2242](26-aidants-partages/US-2242-notifications-partagees-multi-aidants.md) | Notifications partagées multi-aidants | V1 | 3 | config | US-3222 (notifs partagées) |

### 27. Gestion dispositifs patient (vue pro) (5)

| ID | Titre | Priorité | SP | Archétype | US miroir patient |
|----|-------|---------:|---:|-----------|-------------------|
| [US-2243](27-dispositifs-patient/US-2243-vue-dispositifs-cgm-pompe-lecteur-patient.md) | Vue dispositifs CGM/pompe/lecteur patient | V1 | 3 | monitoring | US-3110 (statut dispositif patient) |
| [US-2244](27-dispositifs-patient/US-2244-statut-synchronisation-temps-reel.md) | Statut synchronisation temps réel | V1 | 5 | monitoring | — |
| [US-2245](27-dispositifs-patient/US-2245-detection-dispositifs-defaillants.md) | Détection dispositifs défaillants | V2 | 5 | monitoring | US-3043 (alerte capteur défaillant) |
| [US-2246](27-dispositifs-patient/US-2246-detection-sous-port-de-capteur.md) | Détection sous-port de capteur | V2 | 5 | monitoring | — |
| [US-2247](27-dispositifs-patient/US-2247-recommandations-changement-materiel.md) | Recommandations changement matériel | V2 | 3 | orchestration | — |

### 28. Supervision repas & adhésion thérapeutique (6)

| ID | Titre | Priorité | SP | Archétype | US miroir patient |
|----|-------|---------:|---:|-----------|-------------------|
| [US-2248](28-repas-adhesion/US-2248-vue-journal-alimentaire-patient.md) | Vue journal alimentaire patient | V1 | 5 | monitoring | US-3072 (saisie repas) |
| [US-2249](28-repas-adhesion/US-2249-detection-patterns-alimentaires-problematiques.md) | Détection patterns alimentaires problématiques | V2 | 5 | monitoring | — |
| [US-2250](28-repas-adhesion/US-2250-validation-comptage-glucides-patient.md) | Validation comptage glucides patient | V1 | 5 | workflow | US-3075 (comptage glucides assisté) |
| [US-2251](28-repas-adhesion/US-2251-suivi-adhesion-therapeutique.md) | Suivi adhésion thérapeutique | V1 | 5 | monitoring | — |
| [US-2252](28-repas-adhesion/US-2252-alerte-non-saisie-depuis-x-jours.md) | Alerte non-saisie depuis X jours | V1 | 3 | orchestration | — |
| [US-2253](28-repas-adhesion/US-2253-contextualisation-glycemie-repas.md) | Contextualisation glycémie ↔ repas | V1 | 5 | monitoring | — |

### 29. Programmes ETP supervisés (6)

| ID | Titre | Priorité | SP | Archétype | US miroir patient |
|----|-------|---------:|---:|-----------|-------------------|
| [US-2254](29-etp-supervises/US-2254-bibliotheque-programmes-etp.md) | Bibliothèque programmes ETP | V2 | 5 | config | US-3243 (programmes ETP patient) |
| [US-2255](29-etp-supervises/US-2255-prescription-programme-etp-au-patient.md) | Prescription programme ETP au patient | V2 | 5 | workflow | — |
| [US-2256](29-etp-supervises/US-2256-suivi-progression-patient-dans-programme.md) | Suivi progression patient dans programme | V2 | 5 | monitoring | US-3244 (suivi progression) |
| [US-2257](29-etp-supervises/US-2257-evaluation-acquis-post-programme.md) | Évaluation acquis post-programme | V3 | 5 | workflow | — |
| [US-2258](29-etp-supervises/US-2258-certificat-de-completion-has.md) | Certificat de complétion HAS | V3 | 3 | audit | US-3245 (certificat patient) |
| [US-2259](29-etp-supervises/US-2259-rapport-d-activite-etp-cabinet.md) | Rapport d'activité ETP cabinet | V3 | 5 | monitoring | — |

### 30. Communication & messagerie pro → patient (5)

| ID | Titre | Priorité | SP | Archétype | US miroir patient |
|----|-------|---------:|---:|-----------|-------------------|
| [US-2260](30-messagerie-pro-patient/US-2260-templates-messages-par-pathologie.md) | Templates messages par pathologie | V2 | 3 | config | — |
| [US-2261](30-messagerie-pro-patient/US-2261-messages-programmes-au-patient.md) | Messages programmés au patient | V2 | 5 | orchestration | — |
| [US-2262](30-messagerie-pro-patient/US-2262-notifications-proactives-non-saisie.md) | Notifications proactives non-saisie | V2 | 3 | orchestration | — |
| [US-2263](30-messagerie-pro-patient/US-2263-coordination-multi-soignants-sur-patient.md) | Coordination multi-soignants sur patient | V2 | 5 | orchestration | — |
| [US-2264](30-messagerie-pro-patient/US-2264-diffusion-message-a-cohorte.md) | Diffusion message à cohorte | V3 | 5 | orchestration | — |


## Format de chaque US

Chaque fichier .md contient :
1. Métadonnées (priorité, archétype, dépendances, story points, US miroir)
2. Contexte métier + lien explicite avec l'app patient + persona pro
3. Critères d'acceptation Gherkin (adaptés à l'archétype)
4. Règles métier (RBAC, périmètre patient, audit, archétype-spécifiques)
5. Modèle de données (extensions Prisma indicatives selon archétype)
6. API & contrats (endpoints REST esquissés selon archétype)
7. Scénarios d'erreur
8. Sécurité & conformité HDS
9. Plan de test 3 niveaux + tests sécurité + tests conformité
10. Définition de Done complète
11. Ressources

## 5 archétypes techniques

| Archétype | Pattern | Exemple |
|-----------|---------|---------|
| **config** | Versionnement, validation médicale obligatoire, sync vers app patient | Cibles glycémiques, seuils alertes, contacts urgence |
| **monitoring** | Cohortes 100s patients, fraîcheur données, cache Redis | Inbox urgences, statut dispositifs, indicateurs adhésion |
| **workflow** | Machine à états, transitions auditées, notifications patient | Validation modes contextuels, transition adulte 16-18, prescription ETP |
| **audit** | Immuabilité PostgreSQL, exports signés, rétention HDS | Audit partages, audit configurations, exports certif |
| **orchestration** | Idempotence, retry backoff, préférences patient, queue async | Templates messages programmés, notifications proactives, escalade urgences |

## Convention

- **ID** : `US-2214` à `US-2{214+len(us_index)-1}` (continuation US-2xxx backoffice)
- **US-3xxx** : app patient (cf inventaire séparé)
- Numérotation continue dans la série backoffice pour bien marquer que c'est du pro

## Limites assumées

- **Modèles Prisma indicatifs** : extensions à confirmer en design technique
- **Endpoints REST esquissés** : à finaliser en contract design
- **Story points heuristiques** : recalibrer en planning poker équipe
- **Cohérence avec app patient** : les US miroir référencent les US-3xxx existantes ; à valider avant développement croisé
