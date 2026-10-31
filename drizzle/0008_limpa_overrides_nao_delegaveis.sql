-- Capabilities de escopo tenant deixaram de ser delegáveis; remove os overrides que já estavam gravados.
DELETE FROM "role_capabilities" WHERE "capability" IN ('tenant.configure', 'team.manage', 'audit.read', 'pipeline.configure');
