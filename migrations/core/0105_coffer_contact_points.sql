CREATE TABLE cf_contact_points(
 id TEXT PRIMARY KEY,donor_id TEXT NOT NULL REFERENCES cf_donors(id),kind TEXT NOT NULL CHECK(kind IN ('email','phone','address')),
 type TEXT NOT NULL,value TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,is_primary INTEGER NOT NULL CHECK(is_primary IN(0,1)),
 starts_on TEXT,ends_on TEXT,version INTEGER NOT NULL,source TEXT NOT NULL,source_on TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX cf_contact_primary ON cf_contact_points(donor_id,kind) WHERE is_primary=1 AND active=1;
CREATE INDEX cf_contact_value ON cf_contact_points(kind,value) WHERE active=1;
CREATE TABLE cf_contact_history(point_id TEXT NOT NULL,donor_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot TEXT NOT NULL,source TEXT NOT NULL,source_on TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(point_id,version));
CREATE TABLE cf_contact_edit(id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER cf_contact_history_insert AFTER INSERT ON cf_contact_points BEGIN INSERT INTO cf_contact_history VALUES(NEW.id,NEW.donor_id,NEW.version,json_object('id',NEW.id,'donor_id',NEW.donor_id,'kind',NEW.kind,'type',NEW.type,'value',NEW.value,'active',NEW.active,'is_primary',NEW.is_primary,'starts_on',NEW.starts_on,'ends_on',NEW.ends_on,'version',NEW.version,'source',NEW.source,'source_on',NEW.source_on,'updated_at',NEW.updated_at),NEW.source,NEW.source_on,NEW.updated_at); END;
CREATE TRIGGER cf_contact_history_update AFTER UPDATE ON cf_contact_points WHEN NEW.version<>OLD.version BEGIN INSERT INTO cf_contact_history VALUES(NEW.id,NEW.donor_id,NEW.version,json_object('id',NEW.id,'donor_id',NEW.donor_id,'kind',NEW.kind,'type',NEW.type,'value',NEW.value,'active',NEW.active,'is_primary',NEW.is_primary,'starts_on',NEW.starts_on,'ends_on',NEW.ends_on,'version',NEW.version,'source',NEW.source,'source_on',NEW.source_on,'updated_at',NEW.updated_at),NEW.source,NEW.source_on,NEW.updated_at); END;
INSERT INTO cf_contact_points SELECT 'contact-email-'||d.id,d.id,'email','other',d.email,1,1,NULL,NULL,1,d.source,substr(d.created_at,1,10),d.created_at FROM cf_donors d WHERE d.email IS NOT NULL AND d.erased_at IS NULL;
CREATE TRIGGER cf_contact_donor_insert_email AFTER INSERT ON cf_donors WHEN NEW.email IS NOT NULL AND NEW.erased_at IS NULL BEGIN INSERT INTO cf_contact_points VALUES('contact-email-'||NEW.id,NEW.id,'email','other',NEW.email,1,1,NULL,NULL,1,NEW.source,substr(NEW.created_at,1,10),NEW.created_at); END;
CREATE TRIGGER cf_contact_donor_update_email AFTER UPDATE ON cf_donors
 WHEN NEW.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_contact_edit) AND NEW.email IS NOT OLD.email
 BEGIN
 UPDATE cf_contact_points SET value=COALESCE(NEW.email,value),active=CASE WHEN NEW.email IS NULL THEN 0 ELSE 1 END,is_primary=CASE WHEN NEW.email IS NULL THEN 0 ELSE 1 END,version=version+1,source='primary record edit',source_on=date('now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE donor_id=NEW.id AND kind='email' AND is_primary=1 AND active=1;
 INSERT INTO cf_contact_points SELECT 'contact-email-'||lower(hex(randomblob(16))),NEW.id,'email','other',NEW.email,1,1,NULL,NULL,1,'primary record edit',date('now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NEW.email IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_contact_points WHERE donor_id=NEW.id AND kind='email' AND active=1 AND is_primary=1);
 END;
INSERT INTO cf_contact_points SELECT 'contact-phone-'||d.id,d.id,'phone','mobile',d.phone,1,1,NULL,NULL,1,d.source,substr(d.created_at,1,10),d.created_at FROM cf_donors d WHERE d.phone IS NOT NULL AND d.erased_at IS NULL;
CREATE TRIGGER cf_contact_donor_insert_phone AFTER INSERT ON cf_donors WHEN NEW.phone IS NOT NULL AND NEW.erased_at IS NULL BEGIN INSERT INTO cf_contact_points VALUES('contact-phone-'||NEW.id,NEW.id,'phone','mobile',NEW.phone,1,1,NULL,NULL,1,NEW.source,substr(NEW.created_at,1,10),NEW.created_at); END;
CREATE TRIGGER cf_contact_donor_update_phone AFTER UPDATE ON cf_donors
 WHEN NEW.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_contact_edit) AND NEW.phone IS NOT OLD.phone
 BEGIN
 UPDATE cf_contact_points SET value=COALESCE(NEW.phone,value),active=CASE WHEN NEW.phone IS NULL THEN 0 ELSE 1 END,is_primary=CASE WHEN NEW.phone IS NULL THEN 0 ELSE 1 END,version=version+1,source='primary record edit',source_on=date('now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE donor_id=NEW.id AND kind='phone' AND is_primary=1 AND active=1;
 INSERT INTO cf_contact_points SELECT 'contact-phone-'||lower(hex(randomblob(16))),NEW.id,'phone','mobile',NEW.phone,1,1,NULL,NULL,1,'primary record edit',date('now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NEW.phone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_contact_points WHERE donor_id=NEW.id AND kind='phone' AND active=1 AND is_primary=1);
 END;
INSERT INTO cf_contact_points SELECT 'contact-address-'||d.id,d.id,'address','home',json_object('line1',d.address_line1,'line2',d.address_line2,'city',d.city,'region',d.region,'postalCode',d.postal_code,'country',d.country),1,1,NULL,NULL,1,d.source,substr(d.created_at,1,10),d.created_at FROM cf_donors d WHERE d.address_line1 IS NOT NULL AND d.erased_at IS NULL;
CREATE TRIGGER cf_contact_donor_insert_address AFTER INSERT ON cf_donors WHEN NEW.address_line1 IS NOT NULL AND NEW.erased_at IS NULL BEGIN INSERT INTO cf_contact_points VALUES('contact-address-'||NEW.id,NEW.id,'address','home',json_object('line1',NEW.address_line1,'line2',NEW.address_line2,'city',NEW.city,'region',NEW.region,'postalCode',NEW.postal_code,'country',NEW.country),1,1,NULL,NULL,1,NEW.source,substr(NEW.created_at,1,10),NEW.created_at); END;
CREATE TRIGGER cf_contact_donor_update_address AFTER UPDATE ON cf_donors
 WHEN NEW.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_contact_edit) AND json_object('line1',NEW.address_line1,'line2',NEW.address_line2,'city',NEW.city,'region',NEW.region,'postalCode',NEW.postal_code,'country',NEW.country) IS NOT json_object('line1',OLD.address_line1,'line2',OLD.address_line2,'city',OLD.city,'region',OLD.region,'postalCode',OLD.postal_code,'country',OLD.country)
 BEGIN
 UPDATE cf_contact_points SET value=COALESCE(json_object('line1',NEW.address_line1,'line2',NEW.address_line2,'city',NEW.city,'region',NEW.region,'postalCode',NEW.postal_code,'country',NEW.country),value),active=CASE WHEN NEW.address_line1 IS NULL THEN 0 ELSE 1 END,is_primary=CASE WHEN NEW.address_line1 IS NULL THEN 0 ELSE 1 END,version=version+1,source='primary record edit',source_on=date('now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE donor_id=NEW.id AND kind='address' AND is_primary=1 AND active=1;
 INSERT INTO cf_contact_points SELECT 'contact-address-'||lower(hex(randomblob(16))),NEW.id,'address','home',json_object('line1',NEW.address_line1,'line2',NEW.address_line2,'city',NEW.city,'region',NEW.region,'postalCode',NEW.postal_code,'country',NEW.country),1,1,NULL,NULL,1,'primary record edit',date('now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NEW.address_line1 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_contact_points WHERE donor_id=NEW.id AND kind='address' AND active=1 AND is_primary=1);
 END;
CREATE TRIGGER cf_contact_erasure AFTER UPDATE OF erased_at ON cf_donors WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN DELETE FROM cf_contact_history WHERE donor_id=NEW.id; DELETE FROM cf_contact_points WHERE donor_id=NEW.id; END;

ALTER TABLE cf_gift_tributes ADD COLUMN notification_donor_id TEXT REFERENCES cf_donors(id);
ALTER TABLE cf_tribute_notifications ADD COLUMN contact_snapshot TEXT;
CREATE TRIGGER cf_notification_contact_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN
 UPDATE cf_tribute_notifications SET recipient_name='',recipient_email=NULL,recipient_address=NULL,body='',contact_snapshot=NULL,version=version+1 WHERE gift_id IN(SELECT gift_id FROM cf_gift_tributes WHERE notification_donor_id=NEW.id);
 UPDATE cf_gift_tributes SET notification_donor_id=NULL,notified_name=NULL,notified_email=NULL,notified_address=NULL,version=version+1 WHERE notification_donor_id=NEW.id;
END;
