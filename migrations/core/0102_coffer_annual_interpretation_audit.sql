-- Record the ruled annual interpretation as a successor, without editing an
-- immutable original answer or a later staff choice. Fence prepared audiences
-- by advancing the restriction version. Fresh installations have no such rows.
INSERT INTO cf_solicitation_history(donor_id,version,answer)
 SELECT s.donor_id,s.version+1,json_object(
  'type',s.type,'startsOn',s.starts_on,'endsOn',s.ends_on,'channels',json(s.channels),
  'maxAsks',s.max_asks,'period','rolling-12-months','source',s.source,
  'sourceRef',s.source_ref,'sourceOn',s.source_on,'actorId','coffer-schema',
  'actorName','Coffer schema upgrade','at',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  'migration','0102','reason','ct 22 Oct: annual default means rolling 12 months')
 FROM cf_solicitation s JOIN cf_solicitation_history h ON h.donor_id=s.donor_id AND h.version=s.version
 WHERE s.type='limit' AND s.legacy_calendar_period='calendar-year' AND s.period='rolling-12-months'
  AND json_extract(h.answer,'$.period')='calendar-year';
INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
 SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'),'coffer-schema','Coffer schema upgrade','owner',
  'solicitation.periodRuling','donor',s.donor_id,s.donor_id,
  json_object('version',s.version+1,'from','calendar-year','period','rolling-12-months','ruling','ct 22 Oct')
 FROM cf_solicitation s JOIN cf_solicitation_history h ON h.donor_id=s.donor_id AND h.version=s.version+1
 WHERE json_extract(h.answer,'$.migration')='0102';
UPDATE cf_solicitation SET version=version+1,recorded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 recorded_by_id='coffer-schema',recorded_by_name='Coffer schema upgrade'
 WHERE EXISTS(SELECT 1 FROM cf_solicitation_history h WHERE h.donor_id=cf_solicitation.donor_id
  AND h.version=cf_solicitation.version+1 AND json_extract(h.answer,'$.migration')='0102');
