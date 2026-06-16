# DPIA — `Treatment.name` / `Treatment.posology` en clair (Art. 9)

**Statut** : Brouillon — risque à arbitrer/signer DPO + RSSI.
**Périmètre** : la table `Treatment` (`prisma/schema.prisma`, `@@map("treatments")`),
champs `name` (`VarChar(100)`) et `posology` (`Text`), affichés dans l'onglet
Traitements du dossier patient (`PatientDetailClient`).
**Lié à** : `dpia-patient-detail-dossier.md` (où le risque est listé ⚠️).

## 1. Constat

`Treatment.name` / `Treatment.posology` sont des **données de santé (Art. 9)** —
nom de médicament et posologie — stockées **en clair** en base, alors que les
autres PII/santé sensibles (identité, `PatientMedicalData.history*`,
`diabetDiscovery`, notes device) sont chiffrées at-rest (AES-256-GCM, base64).

## 2. Pourquoi le chiffrement n'est PAS appliqué unilatéralement ici

Le chiffrement applicatif suppose un **point d'écriture unique** qui chiffre
avant insertion et un point de lecture qui déchiffre. Or :

- **Aucun chemin d'écriture `Treatment` n'existe dans ce dépôt (backoffice)** —
  vérifié : zéro `prisma.treatment.create/update/upsert`. Les lignes `Treatment`
  sont écrites **exclusivement par l'app iOS** (dépôt séparé), qui partage la
  même base.
- Chiffrer at-rest côté backoffice **seul** casserait la cohérence : iOS
  continuerait d'écrire en clair → le déchiffrement backoffice échouerait /
  corromprait l'affichage, et inversement.
- CLAUDE.md : « Les modèles de données doivent rester alignés entre les deux
  dépôts » et « on ne développe pas les applications android et iOS ».

Le chiffrement effectif est donc un **prérequis de coordination iOS** (les deux
dépôts doivent chiffrer/déchiffrer avec la même clé/format), hors périmètre d'une
PR backoffice isolée.

## 3. Risque résiduel accepté (en attendant la coordination iOS)

| Menace | Exposition | Mesures compensatoires en place |
|---|---|---|
| Compromission BDD (dump) | `name`/`posology` lisibles en clair | Chiffrement at-rest disque (pgcrypto/infra), accès BDD restreint, audit |
| Accès applicatif non autorisé | — | RBAC + `canAccessPatient` + `patientShareConsent` (fail-closed) + audit `READ` |
| Exfiltration via API | `Treatment` n'est exposé que derrière la garde accès+consentement du dossier, jamais en liste cohorte |

**Gravité** : modérée (nom de traitement = sensible mais moins ré-identifiant que
identité/INS, déjà chiffrés). **Vraisemblance** : faible (défense en profondeur).

## 4. Décision demandée (DPO/RSSI)

1. **Accepter** le risque résiduel à court terme (statu quo documenté), OU
2. **Planifier** le chiffrement coordonné backoffice ↔ iOS (ticket inter-dépôts) :
   - format `base64(AES-256-GCM)` dans les colonnes `String` existantes (pas de
     migration de schéma destructive),
   - migration de données one-shot des lignes existantes,
   - bascule synchronisée des deux dépôts.

> Tant que (2) n'est pas coordonné, ne PAS chiffrer côté backoffice seul
> (romprait la lecture/écriture iOS).
