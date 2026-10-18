-- Access belongs to this installation. Like its identity/session tables, it
-- stays here across donor-data restore; product history remains portable.
CREATE TABLE cf_access_events (
 id INTEGER PRIMARY KEY,
 at TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 actor_name TEXT NOT NULL,
 actor_role TEXT NOT NULL,
 action TEXT NOT NULL,
 subject_kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 donor_id TEXT,
 detail TEXT NOT NULL CHECK(json_valid(detail))
);
CREATE INDEX cf_access_actor ON cf_access_events(actor_id,id);
CREATE INDEX cf_access_action ON cf_access_events(action,id);
CREATE INDEX cf_access_time ON cf_access_events(at,id);

INSERT INTO cf_access_events SELECT * FROM cf_events
WHERE action IN ('request.change','export.download','agent.read') OR action LIKE 'auth.%';
DELETE FROM cf_events WHERE action IN ('request.change','export.download','agent.read') OR action LIKE 'auth.%';

DROP TRIGGER cf_audit_signin;
DROP TRIGGER cf_audit_session_revoke;
CREATE TRIGGER cf_audit_signin AFTER INSERT ON oa_sessions BEGIN
 INSERT INTO cf_access_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
 SELECT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at/1000.0,'unixepoch'),id,display_name,role,'auth.signin','operator',id,NULL,json_object('method',NEW.kind)
 FROM oa_operators WHERE id=NEW.operator_id;
END;
CREATE TRIGGER cf_audit_session_revoke AFTER UPDATE OF revoked_at ON oa_sessions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 INSERT INTO cf_access_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
 SELECT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.revoked_at/1000.0,'unixepoch'),id,display_name,role,'auth.sessionEnded','operator',id,NULL,'{}'
 FROM oa_operators WHERE id=NEW.operator_id;
END;
