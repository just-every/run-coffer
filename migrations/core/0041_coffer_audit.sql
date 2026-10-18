CREATE INDEX cf_event_actor ON cf_events(actor_id,id);
CREATE INDEX cf_event_action ON cf_events(action,id);
CREATE INDEX cf_event_time ON cf_events(at,id);

-- Keep the sign-in fact without copying a session ID, token or address.
CREATE TRIGGER cf_audit_signin AFTER INSERT ON oa_sessions BEGIN
 INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
 SELECT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at/1000.0,'unixepoch'),id,display_name,role,'auth.signin','operator',id,NULL,json_object('method',NEW.kind)
 FROM oa_operators WHERE id=NEW.operator_id;
END;
CREATE TRIGGER cf_audit_session_revoke AFTER UPDATE OF revoked_at ON oa_sessions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
 SELECT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.revoked_at/1000.0,'unixepoch'),id,display_name,role,'auth.sessionEnded','operator',id,NULL,'{}'
 FROM oa_operators WHERE id=NEW.operator_id;
END;
