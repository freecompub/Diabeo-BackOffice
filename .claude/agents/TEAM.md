# Team Diabeo BackOffice — Agents Claude Code

Composition de l'équipe d'agents pour le développement du backoffice Diabeo.
Chaque agent est défini dans un fichier `.md` dans ce répertoire.

---

## Équipe principale (développement quotidien)

| Agent | Modèle | Rôle |
|---|---|---|
| [nextjs-developer](nextjs-developer.md) | sonnet | Développeur principal — pages, API routes, server components, NextAuth |
| [typescript-pro](typescript-pro.md) | sonnet | Type safety strict, branded types, Zod schemas, zero `any` |
| [sql-pro](sql-pro.md) | sonnet | PostgreSQL — schéma, indexes, optimisation requêtes, JSONB |
| [code-reviewer](code-reviewer.md) | opus | Gate de sécurité PR — auth, chiffrement, Zod, OWASP |
| [test-automator](test-automator.md) | — | Tests unitaires Jest + E2E Playwright |
| [accessibility-tester](accessibility-tester.md) | haiku | Conformité WCAG 2.1 / ARIA sur les composants |
| [architect-reviewer](architect-reviewer.md) | opus | Validation des décisions architecturales (ADR) |

## Équipe compliance & domaine médical

| Agent | Modèle | Rôle |
|---|---|---|
| [healthcare-security-auditor](healthcare-security-auditor.md) | opus | Audit HDS, RGPD Article 9, ANSSI — chiffrement, MFA, audit logs, clés |
| [medical-domain-validator](medical-domain-validator.md) | opus | Validation métier insuline — bornes cliniques, formules bolus, sécurité patient |

## Équipe infrastructure

| Agent | Modèle | Rôle |
|---|---|---|
| [prisma-specialist](prisma-specialist.md) | sonnet | ORM Prisma — migrations, JSONB typing, soft-delete middleware, transactions |
| [devops-engineer](devops-engineer.md) | sonnet | Docker Compose, deploy.sh, CI/CD, backups PostgreSQL, secrets OVH |

## Équipe à la demande

| Agent | Modèle | Rôle |
|---|---|---|
| [designer](designer.md) | — | UI/UX composants `diabeo/` avec palette "Sérénité Active" |
| [swift-expert](swift-expert.md) | — | Alignement modèles de données avec l'app iOS |
| [documentation-engineer](documentation-engineer.md) | haiku | Documentation API, runbooks, mise à jour CLAUDE.md |

---

## Collaboration par module

```
Patient CRUD        → nextjs-developer + typescript-pro + prisma-specialist + healthcare-security-auditor
Insulin Config      → nextjs-developer + medical-domain-validator + test-automator + designer
Auth / MFA          → nextjs-developer + healthcare-security-auditor + code-reviewer
Audit               → sql-pro + prisma-specialist + nextjs-developer + architect-reviewer
Infrastructure      → devops-engineer + sql-pro
iOS alignment       → swift-expert + typescript-pro + architect-reviewer
Chaque PR           → code-reviewer + accessibility-tester
```

## Workflow type pour une feature

```
1. architect-reviewer       → Valide que la feature s'inscrit dans l'architecture (ADR)
2. medical-domain-validator → Définit les bornes cliniques si logique médicale
3. prisma-specialist        → Migration et requêtes si changement de schéma
4. swift-expert             → Vérifie l'alignement iOS si modèle de données touché
5. typescript-pro           → Définit les types et schemas Zod
6. nextjs-developer         → Implémente API routes et composants
7. designer                 → Spécifications UI si nouvelle interface
8. healthcare-security-auditor → Audit sécurité HDS/RGPD
9. code-reviewer            → Review PR finale
10. test-automator          → Tests unitaires + E2E
11. accessibility-tester    → Validation ARIA/WCAG
12. documentation-engineer  → Mise à jour docs si nécessaire
```

---

*14 agents — Team Diabeo BackOffice*
