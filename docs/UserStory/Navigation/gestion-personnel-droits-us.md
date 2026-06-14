# US-ACCESS-001 — Gestion du personnel & des droits (cabinet / équipe)

> **Périmètre :** Diabeo BackOffice — **socle d'accès** dont dépend la sous-série « Gestion cabinet » (US-NAV-BO-007 / 008). **Format B léger.**
> **Baselines :** `BASELINE-RBAC` · `BASELINE-AUDIT` (immuable) · `BASELINE-DESIGN` · `BASELINE-I18N` (FR/AR + RTL).
>
> **Modèle d'accès — 2 axes indépendants, portés par le `User`, scopés organisation :**
> - **Q1 — Capacité clinique** (voir les **données de santé**, Art. 9 RGPD) : `DOCTOR`/`NURSE`/`VIEWER`. **Gated sur une « qualité PS vérifiée »** — capacité **abstraite**, dont la **méthode de vérification dépend du pays** (FR : RPPS/ADELI ; autres : vérification manuelle). **Jamais octroyable par un admin** (ni auto-octroyable).
> - **Q2 — Capacité de gestion cabinet** : gérer le **personnel + les droits** et la **facturation/paiements**. **N'ouvre AUCUN accès aux données de santé.**
>
> **Distinguer 3 « admins » :** `SYSTEM_ADMIN` (ops Diabeo, hors cabinet) ≠ **org-admin** (Q2, gère son cabinet) ≠ rôle clinique.

---

## 👤 En tant que
`User` titulaire de la **capacité de gestion cabinet (Q2)** dans son périmètre — **médecin libéral** (son cabinet), **gestionnaire de cabinet** non-soignant, ou **org-admin** d'un établissement.

## 🎯 Je veux / Afin de
Gérer **les membres de mon cabinet/équipe et leurs droits** (qui peut soigner, qui peut gérer), afin que chacun ait **le minimum d'accès nécessaire**, en sécurité et de façon traçable.

## 📌 Description fonctionnelle
- **Liste des membres** de mon **périmètre** (cabinet/équipe) : nom, statut (*actif / invité / révoqué*), **capacités** (rôle clinique Q1 + gestion Q2), qualité PS vérifiée (oui/non).
- **Inviter / ajouter un membre** : par e-mail → crée ou rattache un `User` ; affecte au **scope** (cabinet/équipe).
- **Attribuer les capacités** :
  - **Q2 (gestion)** : octroyable **uniquement par un admin principal** (voir ci-dessous), **dans son scope**.
  - **Deux niveaux de Q2** : **admin principal** (Q2 + droit de **déléguer** Q2) vs **admin délégué** (Q2 **opérationnel** : gère équipe/facturation, mais **ne peut pas créer d'autres admins**). Le **propriétaire** du cabinet (bootstrap libéral) est admin **principal** par défaut.
  - **Q1 (clinique)** : **pas un simple interrupteur** — n'est attribuable **que** si le membre a une **qualité PS vérifiée (RPPS/ADELI)**. Sinon : attribution **bloquée** (état « vérification requise »), **aucun accès aux données de santé** entre-temps.
- **Révoquer** un membre ou une capacité : **effet immédiat** (accès coupé, sessions invalidées). Les données déjà créées par le membre restent (append-only / audit).
- Chaque action sensible est **journalisée** (qui, quoi, sur qui, quand, scope).

## 🔒 Qui peut faire quoi
| Action | org-admin (Q2) dans son scope | Médecin sans Q2 | Secrétaire (Q2 seul) | SYSTEM_ADMIN |
|---|---|---|---|---|
| Voir la liste des membres | ✅ (son scope) | ❌ | ✅ (son scope) | ✅ |
| Inviter / révoquer un membre | ✅ | ❌ | ✅ | ✅ |
| Octroyer **Q2 (gestion)** | ✅ **si admin principal** · ❌ si délégué | ❌ | ❌ (délégué par défaut) | ✅ |
| Octroyer **Q1 (clinique)** | ✅ **uniquement à un PS vérifié** | ❌ | ✅ **uniquement à un PS vérifié** | ✅ (idem) |
| S'auto-octroyer Q1 | ❌ **interdit** | — | ❌ | ❌ |

## ✔️ Critères d'acceptation
- La gestion n'est accessible **qu'avec Q2** (filtrage **serveur**) ; un membre sans Q2 n'y accède pas.
- L'org-admin ne voit/gère **que les membres de son scope** (cabinet/équipe) — jamais au-delà.
- **Attribuer un rôle clinique (Q1) est refusé** si la qualité PS n'est pas vérifiée → état « vérification requise », **zéro accès aux données de santé** tant que non vérifié.
- **Aucune auto-élévation** : un org-admin **ne peut pas** s'attribuer Q1 (ni à lui-même via un compte qu'il contrôle sans qualité PS).
- **Révocation immédiate** : un membre révoqué perd l'accès aussitôt (sessions invalidées) ; ses données passées subsistent.
- **Audit** (BASELINE-AUDIT) : invitation, octroi, révocation, changement de capacité, changement de scope → entrée `AuditLog` immuable (acteur, cible, capacité, scope, horodatage).
- L'écran expose de la **PII des membres** (nom, e-mail, RPPS) → accès lui-même contrôlé + audité ; **aucune donnée de santé** ici.
- FR/AR + RTL.

## 🧩 Règles métier
- **2 axes orthogonaux** : Q1 (clinique, PHI) et Q2 (gestion) s'attribuent **indépendamment**.
- **Délégation de Q2 contrôlée** : seul un **admin principal** (ou `SYSTEM_ADMIN`) peut octroyer Q2 ; un **admin délégué** n'a **pas** le droit de re-déléguer → limite la prolifération d'admins et le rayon d'impact d'un compte compromis.
- **Q2 n'ouvre jamais les données de santé.** Q1 est **gated RPPS** et **jamais octroyable par la voie admin** (la gestion *associe* une qualité PS vérifiée, elle ne la *crée* pas).
- **Séparation des pouvoirs / non-auto-élévation** : impossible de se donner à soi-même un accès clinique.
- **Scope obligatoire** : tout grant est rattaché à un périmètre (cabinet / équipe) ; pas de droit « global » via cet écran (le global = `SYSTEM_ADMIN`, hors périmètre).
- **Bootstrap libéral** : à la création de compte, le libéral **auto-crée son cabinet** et devient **org-admin (Q2)** de ce cabinet ; son **accès clinique (Q1)** est débloqué par sa **vérification RPPS**, pas par le grant admin.
- **Cabinet de groupe** : isolation par défaut — un membre clinique ne voit que **ses** patients ; une **secrétaire partagée** est scopée (par médecin ou par service) et **sans** données de santé.
- Données **membres/financières ≠ données de santé** (régime distinct).

## 🌍 Vérification de la « qualité PS » — par pays (multi-marché FR / DZ)
La porte d'accès clinique (Q1) repose sur une capacité **abstraite « qualité PS vérifiée »**, **indépendante du pays**. La **méthode** pour l'obtenir est **pluggable** :

| Pays | Méthode | Statut |
|---|---|---|
| **France** | Manuelle (justificatif) en V1 → **API RPPS / Annuaire Santé gratuite** en V2 | optimisable |
| **Algérie** | **Manuelle** (inscription à l'Ordre des médecins algérien / diplôme) | pas d'API équivalente |
| Autres | Manuelle par défaut | — |

- ⚠️ Le RPPS est **franco-français** : il ne valide **que** les soignants enregistrés en France. La **vérification manuelle est le socle permanent** ; l'API RPPS est une **optimisation FR** branchée par-dessus.
- On ne stocke **pas** un « champ RPPS » mais une **preuve d'enregistrement générique** : `{ pays, type (RPPS/Ordre/diplôme…), numéro, méthode, vérifié_par, date }`, **auditée**.

## 🚦 Mode d'application de la vérification (politique fail-secure)
La vérification de la qualité PS peut être **assouplie** pour démarrer (pilote, marché sans process), mais **jamais par défaut ouverte**.

- **Deux modes** : `requis` (porte ON) · `provisoire` (accès clinique autorisé sans preuve, le temps du ramp-up).
- **Résolution serveur, fail-secure** : `tenant > pays > environnement`, **défaut = `requis`** partout (si rien n'est posé → requis). La **prod est `requis`** par défaut quoi qu'il arrive.
- **Réglé par `SYSTEM_ADMIN` (Diabeo), par tenant/pays — JAMAIS par l'org-admin** (sinon auto-bypass de la porte clinique, cf. règle de non-auto-élévation). **Audité et borné dans le temps.**
- **États distincts** : un compte passé en mode provisoire est marqué **`provisoire`**, **jamais `vérifié`** → on peut resserrer plus tard et savoir qui doit encore fournir une preuve.
- **« Forcer la vérification »** = `SYSTEM_ADMIN` repasse un tenant en `requis` : les comptes `provisoire` doivent obtenir une vraie preuve pour conserver l'accès clinique.
- ⚠️ Le mode `provisoire` sur de **vraies** données patients doit être couvert (pilote documenté / DPIA) — ce n'est pas un contournement de conformité en prod réelle.

## 🧱 Impacts modèle (note, à cadrer avec prisma-specialist)
- Aujourd'hui : `Role` global plat (`ADMIN/DOCTOR/NURSE/VIEWER`) ; `HealthcareService.managerId` = simple pointeur ; `HealthcareMember` sans rôle/permission.
- Cible : **appartenance scopée avec capacités** (ex. `HealthcareMembership { userId, scope(serviceId/équipe), clinicalRole?, canManage: bool }`) + **preuve d'enregistrement PS générique** (ex. `ProfessionalRegistration { userId, country, scheme(RPPS/ADELI/Ordre/diplôme…), number, method, verifiedBy, verifiedAt }`) — **pas** un champ « RPPS » en dur (multi-pays). Renommer `ADMIN` → `SYSTEM_ADMIN` pour lever l'ambiguïté.

## ⚠️ Points ouverts
1. **Vérification de la qualité PS** — **décidé** : manuelle (justificatif) comme **socle permanent multi-pays** ; **API RPPS gratuite branchée en V2 pour la France uniquement** (l'Algérie et les autres restent en manuel, faute d'API équivalente).
2. **Bootstrap établissement** (hôpital) : qui crée le **tout premier** org-admin (vs self-serve libéral) ?
3. **Délégation de Q2** — **décidé (option C)** : deux niveaux — **admin principal** (peut déléguer Q2) vs **admin délégué** (Q2 opérationnel, **sans** re-délégation). Le propriétaire/bootstrap est principal. *(Reste à préciser : un principal peut-il nommer un autre principal, ou seulement des délégués ?)*
4. **Secrétaire partagée en cabinet de groupe** : scope **par médecin** ou **par service** ? (impacte l'isolation patient).
5. **Responsable de traitement (RGPD)** : libéral/cabinet de groupe = contrôleurs distincts ; hôpital = établissement contrôleur — formaliser pour le partage par défaut.

## 🔗 Dépendances
Socle de **US-NAV-BO-007** (bloc gestion, V1) et **US-NAV-BO-008** (bascule mode, V3) · `User`/`Role` · `HealthcareService`/`HealthcareMember` · `AuditLog` · baselines en tête.
