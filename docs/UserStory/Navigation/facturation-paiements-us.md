# US-BILLING-001 — Facturation & Paiements (espace gestion) — **V4**

> **Périmètre :** contenu de l'espace **Gestion cabinet** (item « Facturation » / « Paiements » de US-NAV-BO-007). **Format B léger.**
> **Baselines :** `BASELINE-RBAC` · `BASELINE-AUDIT` · `BASELINE-DESIGN` · `BASELINE-I18N` (FR/AR + RTL).
> **Dépend de :** `US-ACCESS-001` (capacité Q2) · `US-TECH-SEC-001` (séparation PHI) · existant `invoice-admin` / `BillingCard`.
> **Roadmap : V4.**

## 👤 En tant que
`User` avec **capacité gestion cabinet (Q2)** — org-admin, secrétaire, gestionnaire — **sans** accès aux données de santé.

## 🎯 Je veux / Afin de
Gérer les **factures et paiements** de mon cabinet, **selon le marché** (France per-patient / Algérie abonnement), afin d'assurer la facturation **sans jamais accéder au dossier clinique**.

## 📌 Description fonctionnelle
- **Factures** : liste, détail, **génération PDF** (existant), statuts (brouillon/émise/payée/annulée/remboursée), filtres.
- **Paiements / encaissements** : suivi, modes de paiement, rapprochement.
- **Par marché** : **France = per-patient** (feuille de soins / tiers payant) · **Algérie = abonnement** ; l'écran s'adapte au marché du tenant, masque le non applicable.
- **Identité patient pour facturer** : uniquement **PII administrative** (identité, coordonnées de facturation) — **jamais** de donnée de santé.

## ✔️ Critères d'acceptation
- Accessible **si et seulement si Q2** (filtrage serveur ; absent du DOM sinon).
- **Aucune donnée de santé** exposée : **projection/DTO dédiés** (cf. F13) ; un user double-casquette ne récupère aucun champ clinique par cette voie.
- Affichage **adapté au marché** (FR per-patient / DZ abonnement) ; devises/formats locaux.
- Toute action sensible (émission, annulation, encaissement, génération PDF) → **`AuditLog`**.
- FR/AR + RTL.

## 🧩 Règles métier
- **Données financières ≠ données de santé** : régime, écrans et endpoints distincts.
- Facturation per-patient FR : l'**identité** suffit ; pas d'accès au dossier clinique.
- Le contenu réutilise l'existant (`invoice-admin`, `BillingCard`) en le **rattachant à la capacité Q2** et à l'espace gestion.

## ⚠️ Points ouverts
1. **Paiements** : intégration prestataire (Stripe FR ? autre DZ ?) — PCI/segregation financière.
2. **Modèle abonnement Algérie** : structure tarifaire, facturation récurrente.
3. Périmètre exact V4 vs existant à reprendre.

## 🔗 Dépendances
`US-NAV-BO-007` (item nav) · `US-ACCESS-001` (Q2) · `US-TECH-SEC-001` (séparation PHI) · `invoice-admin` existant · `AuditLog`.
