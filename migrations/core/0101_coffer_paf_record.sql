-- A legacy unchecked reference cannot authorize processing under ct's ruling.
ALTER TABLE cf_address_processing ADD COLUMN paf_signer TEXT;
ALTER TABLE cf_address_processing ADD COLUMN paf_signed_on TEXT;
ALTER TABLE cf_address_processing ADD COLUMN paf_licensee TEXT;
UPDATE cf_address_processing SET enabled=0,version=version+1 WHERE enabled=1;
UPDATE cf_ncoa_runs SET state='cancelled',reason='Record the PAF signer, signing date and licensee before processing.' WHERE state IN('queued','processing');
