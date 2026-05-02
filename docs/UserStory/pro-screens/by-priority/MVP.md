# Priorité 🟢 MVP — 75 écrans/composants

**Story points cumulés** : 376 (10 sprints à 40 SP, 7 sprints à 60 SP)

## Répartition par catégorie

- **01-Auth** : 6 items
- **02-Layout** : 4 items
- **03-Dashboard** : 4 items
- **04-Patients** : 8 items
- **05-FichePatient** : 8 items
- **06-AjustementProposition** : 4 items
- **08-Urgences** : 3 items
- **09-ConfigSeuils** : 4 items
- **10-ModesContextuels** : 1 items
- **18-Admin** : 3 items
- **19-AuditRgpd** : 2 items
- **20-Documents** : 2 items
- **22-Profil** : 2 items
- **25-System** : 3 items
- **26-Composants** : 21 items

## Liste complète

| ID | Catégorie | Type | Nom | SP | Route |
|----|-----------|------|-----|---:|-------|
| [SCR-100](../by-category/01-auth/SCR-100-page-de-connexion.md) | 01-Auth | 📄 PAGE | Page de connexion | 5 | `/login` |
| [SCR-101](../by-category/01-auth/SCR-101-saisie-code-2fa-totp.md) | 01-Auth | 💬 MODAL | Saisie code 2FA TOTP | 3 | `/login (modal)` |
| [SCR-102](../by-category/01-auth/SCR-102-recuperation-mot-de-passe-demande.md) | 01-Auth | 📄 PAGE | Récupération mot de passe — Demande | 2 | `/forgot-password` |
| [SCR-103](../by-category/01-auth/SCR-103-recuperation-mot-de-passe-definition-nouveau.md) | 01-Auth | 📄 PAGE | Récupération mot de passe — Définition nouveau | 3 | `/reset-password/[token]` |
| [SCR-104](../by-category/01-auth/SCR-104-setup-2fa-initial.md) | 01-Auth | 🧙 WIZARD_STEP | Setup 2FA initial | 5 | `/setup/2fa` |
| [SCR-105](../by-category/01-auth/SCR-105-codes-de-recuperation-2fa.md) | 01-Auth | 🧙 WIZARD_STEP | Codes de récupération 2FA | 2 | `/setup/2fa/recovery` |
| [SCR-109](../by-category/02-layout/SCR-109-layout-principal-authentifie.md) | 02-Layout | 🏗️ LAYOUT | Layout principal authentifié | 5 | `(layout)` |
| [SCR-110](../by-category/02-layout/SCR-110-topbar-global.md) | 02-Layout | 🧩 COMPONENT | Topbar global | 3 | `(component)` |
| [SCR-111](../by-category/02-layout/SCR-111-navigation-laterale-sidebar.md) | 02-Layout | 🧩 COMPONENT | Navigation latérale (Sidebar) | 3 | `(component)` |
| [SCR-114](../by-category/02-layout/SCR-114-menu-utilisateur-avatar.md) | 02-Layout | 📋 DRAWER | Menu utilisateur (avatar) | 2 | `(dropdown)` |
| [SCR-116](../by-category/03-dashboard/SCR-116-dashboard-medecin-accueil.md) | 03-Dashboard | 📄 PAGE | Dashboard médecin (accueil) | 8 | `/dashboard` |
| [SCR-117](../by-category/03-dashboard/SCR-117-card-urgences-en-cours.md) | 03-Dashboard | 🧩 COMPONENT | Card 'Urgences en cours' | 3 | `(component)` |
| [SCR-118](../by-category/03-dashboard/SCR-118-card-rdv-du-jour.md) | 03-Dashboard | 🧩 COMPONENT | Card 'RDV du jour' | 3 | `(component)` |
| [SCR-119](../by-category/03-dashboard/SCR-119-card-patients-a-suivre.md) | 03-Dashboard | 🧩 COMPONENT | Card 'Patients à suivre' | 5 | `(component)` |
| [SCR-121](../by-category/04-patients/SCR-121-liste-patients-vue-principale.md) | 04-Patients | 📄 PAGE | Liste patients (vue principale) | 8 | `/patients` |
| [SCR-122](../by-category/04-patients/SCR-122-filtres-avances-patients.md) | 04-Patients | 📋 DRAWER | Filtres avancés patients | 5 | `(drawer)` |
| [SCR-123](../by-category/04-patients/SCR-123-recherche-patient-type-ahead.md) | 04-Patients | 🧩 COMPONENT | Recherche patient (Type-ahead) | 5 | `(component)` |
| [SCR-124](../by-category/04-patients/SCR-124-creation-patient-wizard-etape-1-demographie.md) | 04-Patients | 🧙 WIZARD_STEP | Création patient — Wizard étape 1 démographie | 5 | `/patients/new/identity` |
| [SCR-125](../by-category/04-patients/SCR-125-creation-patient-wizard-etape-2-medical.md) | 04-Patients | 🧙 WIZARD_STEP | Création patient — Wizard étape 2 médical | 5 | `/patients/new/medical` |
| [SCR-126](../by-category/04-patients/SCR-126-creation-patient-wizard-etape-3-traitement.md) | 04-Patients | 🧙 WIZARD_STEP | Création patient — Wizard étape 3 traitement | 8 | `/patients/new/therapy` |
| [SCR-127](../by-category/04-patients/SCR-127-creation-patient-wizard-etape-4-invitation-app.md) | 04-Patients | 🧙 WIZARD_STEP | Création patient — Wizard étape 4 invitation app | 5 | `/patients/new/invitation` |
| [SCR-128](../by-category/04-patients/SCR-128-creation-patient-confirmation-finale.md) | 04-Patients | 🧙 WIZARD_STEP | Création patient — Confirmation finale | 3 | `/patients/new/confirm` |
| [SCR-132](../by-category/05-fichepatient/SCR-132-fiche-patient-vue-d-ensemble.md) | 05-FichePatient | 📄 PAGE | Fiche patient — Vue d'ensemble | 8 | `/patients/[id]` |
| [SCR-133](../by-category/05-fichepatient/SCR-133-header-fiche-patient.md) | 05-FichePatient | 🧩 COMPONENT | Header fiche patient | 5 | `(component)` |
| [SCR-134](../by-category/05-fichepatient/SCR-134-tab-synthese-vue-360.md) | 05-FichePatient | 📑 TAB | Tab — Synthèse / Vue 360° | 5 | `/patients/[id]/overview` |
| [SCR-135](../by-category/05-fichepatient/SCR-135-tab-donnees-demographiques-edition.md) | 05-FichePatient | 📑 TAB | Tab — Données démographiques (édition) | 5 | `/patients/[id]/identity` |
| [SCR-136](../by-category/05-fichepatient/SCR-136-tab-antecedents-medicaux.md) | 05-FichePatient | 📑 TAB | Tab — Antécédents médicaux | 5 | `/patients/[id]/medical-history` |
| [SCR-137](../by-category/05-fichepatient/SCR-137-tab-glycemie-cgm.md) | 05-FichePatient | 📑 TAB | Tab — Glycémie / CGM | 13 | `/patients/[id]/cgm` |
| [SCR-139](../by-category/05-fichepatient/SCR-139-tab-insulinotherapie.md) | 05-FichePatient | 📑 TAB | Tab — Insulinothérapie | 13 | `/patients/[id]/insulin` |
| [SCR-140](../by-category/05-fichepatient/SCR-140-editor-ratios-ic-fs-par-tranche-horaire.md) | 05-FichePatient | 💬 MODAL | Editor — Ratios IC/FS par tranche horaire | 8 | `(modal full-page)` |
| [SCR-146](../by-category/06-ajustementproposition/SCR-146-wizard-ajustement-etape-1-analyse.md) | 06-AjustementProposition | 🧙 WIZARD_STEP | Wizard ajustement — Étape 1 Analyse | 8 | `/patients/[id]/proposals/new/analysis` |
| [SCR-147](../by-category/06-ajustementproposition/SCR-147-wizard-ajustement-etape-2-parametrage.md) | 06-AjustementProposition | 🧙 WIZARD_STEP | Wizard ajustement — Étape 2 Paramétrage | 13 | `/patients/[id]/proposals/new/configure` |
| [SCR-148](../by-category/06-ajustementproposition/SCR-148-wizard-ajustement-etape-3-confirmation.md) | 06-AjustementProposition | 🧙 WIZARD_STEP | Wizard ajustement — Étape 3 Confirmation | 8 | `/patients/[id]/proposals/new/confirm` |
| [SCR-149](../by-category/06-ajustementproposition/SCR-149-liste-propositions-du-patient.md) | 06-AjustementProposition | 🗂️ PANEL | Liste propositions du patient | 5 | `(panel)` |
| [SCR-156](../by-category/08-urgences/SCR-156-inbox-urgences-globale-cabinet.md) | 08-Urgences | 📄 PAGE | Inbox urgences globale (cabinet) | 8 | `/emergencies` |
| [SCR-157](../by-category/08-urgences/SCR-157-detail-urgence-timeline.md) | 08-Urgences | 📄 PAGE | Détail urgence — Timeline | 13 | `/emergencies/[id]` |
| [SCR-158](../by-category/08-urgences/SCR-158-reaction-post-urgence-workflow.md) | 08-Urgences | 💬 MODAL | Réaction post-urgence (workflow) | 5 | `(modal)` |
| [SCR-162](../by-category/09-configseuils/SCR-162-configuration-cibles-glycemiques-par-patient.md) | 09-ConfigSeuils | 💬 MODAL | Configuration cibles glycémiques (par patient) | 8 | `(modal)` |
| [SCR-163](../by-category/09-configseuils/SCR-163-configuration-seuils-alertes-hypo-hyper.md) | 09-ConfigSeuils | 💬 MODAL | Configuration seuils alertes hypo/hyper | 5 | `(modal)` |
| [SCR-164](../by-category/09-configseuils/SCR-164-configuration-seuils-cetones.md) | 09-ConfigSeuils | 💬 MODAL | Configuration seuils cétones | 5 | `(modal)` |
| [SCR-165](../by-category/09-configseuils/SCR-165-validation-protocole-resucrage.md) | 09-ConfigSeuils | 💬 MODAL | Validation protocole resucrage | 5 | `(modal)` |
| [SCR-171](../by-category/10-modescontextuels/SCR-171-activation-mode-grossesse.md) | 10-ModesContextuels | 💬 MODAL | Activation mode grossesse | 5 | `(modal)` |
| [SCR-224](../by-category/18-admin/SCR-224-gestion-utilisateurs.md) | 18-Admin | 📄 PAGE | Gestion utilisateurs | 5 | `/admin/users` |
| [SCR-225](../by-category/18-admin/SCR-225-creation-edition-utilisateur.md) | 18-Admin | 💬 MODAL | Création / édition utilisateur | 5 | `(modal)` |
| [SCR-228](../by-category/18-admin/SCR-228-gestion-backups.md) | 18-Admin | 📄 PAGE | Gestion backups | 5 | `/admin/backups` |
| [SCR-231](../by-category/19-auditrgpd/SCR-231-audit-log-global-admin.md) | 19-AuditRgpd | 📄 PAGE | Audit log global (admin) | 8 | `/admin/audit-logs` |
| [SCR-236](../by-category/19-auditrgpd/SCR-236-workflow-effacement-rgpd.md) | 19-AuditRgpd | 💬 MODAL | Workflow effacement RGPD | 8 | `(modal)` |
| [SCR-238](../by-category/20-documents/SCR-238-upload-document-drag-drop.md) | 20-Documents | 💬 MODAL | Upload document (drag-drop) | 5 | `(modal)` |
| [SCR-239](../by-category/20-documents/SCR-239-visualisation-document-pdf-image.md) | 20-Documents | 💬 MODAL | Visualisation document (PDF/image) | 5 | `(modal full-page)` |
| [SCR-248](../by-category/22-profil/SCR-248-mon-profil-utilisateur.md) | 22-Profil | 📄 PAGE | Mon profil utilisateur | 3 | `/account/profile` |
| [SCR-250](../by-category/22-profil/SCR-250-securite-du-compte.md) | 22-Profil | 📄 PAGE | Sécurité du compte | 5 | `/account/security` |
| [SCR-256](../by-category/25-system/SCR-256-erreur-404.md) | 25-System | 📄 PAGE | Erreur 404 | 1 | `/404` |
| [SCR-257](../by-category/25-system/SCR-257-erreur-500-erreur-applicative.md) | 25-System | 📄 PAGE | Erreur 500 / Erreur applicative | 2 | `/500` |
| [SCR-259](../by-category/25-system/SCR-259-page-acces-refuse-403.md) | 25-System | 📄 PAGE | Page accès refusé (403) | 1 | `/403` |
| [SCR-260](../by-category/26-composants/SCR-260-bouton-primaire-secondaire-destructif.md) | 26-Composants | 🧩 COMPONENT | Bouton primaire / secondaire / destructif | 1 | `(component)` |
| [SCR-261](../by-category/26-composants/SCR-261-card-container.md) | 26-Composants | 🧩 COMPONENT | Card / Container | 1 | `(component)` |
| [SCR-262](../by-category/26-composants/SCR-262-table-de-donnees-avec-tri-pagination.md) | 26-Composants | 🧩 COMPONENT | Table de données (avec tri/pagination) | 8 | `(component)` |
| [SCR-263](../by-category/26-composants/SCR-263-formulaire-de-saisie-form.md) | 26-Composants | 🧩 COMPONENT | Formulaire de saisie (Form) | 5 | `(component)` |
| [SCR-264](../by-category/26-composants/SCR-264-champ-de-saisie-input.md) | 26-Composants | 🧩 COMPONENT | Champ de saisie (Input) | 2 | `(component)` |
| [SCR-265](../by-category/26-composants/SCR-265-selecteur-select-combobox.md) | 26-Composants | 🧩 COMPONENT | Sélecteur (Select / Combobox) | 3 | `(component)` |
| [SCR-266](../by-category/26-composants/SCR-266-date-picker-time-picker.md) | 26-Composants | 🧩 COMPONENT | Date picker / Time picker | 5 | `(component)` |
| [SCR-267](../by-category/26-composants/SCR-267-tabs-onglets.md) | 26-Composants | 🧩 COMPONENT | Tabs (onglets) | 2 | `(component)` |
| [SCR-268](../by-category/26-composants/SCR-268-toast-notification-flash.md) | 26-Composants | 🧩 COMPONENT | Toast / Notification flash | 3 | `(component)` |
| [SCR-269](../by-category/26-composants/SCR-269-confirmation-dialog.md) | 26-Composants | 🧩 COMPONENT | Confirmation dialog | 2 | `(component)` |
| [SCR-270](../by-category/26-composants/SCR-270-loading-skeleton.md) | 26-Composants | 🧩 COMPONENT | Loading skeleton | 2 | `(component)` |
| [SCR-271](../by-category/26-composants/SCR-271-empty-state-pedagogique.md) | 26-Composants | 🧩 COMPONENT | Empty state pédagogique | 2 | `(component)` |
| [SCR-272](../by-category/26-composants/SCR-272-error-boundary.md) | 26-Composants | 🧩 COMPONENT | Error boundary | 3 | `(component)` |
| [SCR-273](../by-category/26-composants/SCR-273-glucose-chart-composant.md) | 26-Composants | 🧩 COMPONENT | Glucose chart (composant) | 13 | `(component)` |
| [SCR-275](../by-category/26-composants/SCR-275-insulin-schedule-editor-composant.md) | 26-Composants | 🧩 COMPONENT | Insulin schedule editor (composant) | 13 | `(component)` |
| [SCR-276](../by-category/26-composants/SCR-276-patient-avatar-identifier.md) | 26-Composants | 🧩 COMPONENT | Patient avatar / identifier | 2 | `(component)` |
| [SCR-278](../by-category/26-composants/SCR-278-rbac-gate-hoc-ou-hook.md) | 26-Composants | 🧩 COMPONENT | RBAC gate (HOC ou hook) | 2 | `(component)` |
| [SCR-280](../by-category/26-composants/SCR-280-notification-badge-avec-count.md) | 26-Composants | 🧩 COMPONENT | Notification badge (avec count) | 1 | `(component)` |
| [SCR-282](../by-category/26-composants/SCR-282-glucose-value-with-unit-conversion.md) | 26-Composants | 🧩 COMPONENT | Glucose value with unit conversion | 2 | `(component)` |
| [SCR-283](../by-category/26-composants/SCR-283-global-emergency-banner.md) | 26-Composants | 🧩 COMPONENT | Global emergency banner | 3 | `(component)` |
| [SCR-284](../by-category/26-composants/SCR-284-multi-step-progress.md) | 26-Composants | 🧩 COMPONENT | Multi-step progress | 2 | `(component)` |
