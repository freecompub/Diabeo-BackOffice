-- Groupe 10 Batch D — partages tiers + notifications multi-aidants
-- (US-2240 + US-2242). Extend ConfigVersionType enum with 2 values.
--
-- US-2239 (audit partages) et US-2261 (messages programmés) ne
-- requièrent aucune migration : query pure sur AuditLog et reuse
-- PushScheduledNotification existant.

ALTER TYPE config_version_type ADD VALUE IF NOT EXISTS 'third_party_share';
ALTER TYPE config_version_type ADD VALUE IF NOT EXISTS 'shared_notifications';
