-- Receipts contain no donor facts. Recompute current findings from original custody.
CREATE TABLE cf_migration_analysis_clock (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO cf_migration_analysis_clock VALUES(1,0);
CREATE TABLE cf_migration_analyses (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('crm','stripe')),
 job_id TEXT NOT NULL, native_version INTEGER NOT NULL, fingerprint TEXT NOT NULL,
 created_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE TRIGGER cf_migration_cf_move_in_jobs_insert AFTER INSERT ON cf_move_in_jobs
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_move_in_jobs_update AFTER UPDATE ON cf_move_in_jobs
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_move_in_jobs_delete AFTER DELETE ON cf_move_in_jobs
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_move_in_records_insert AFTER INSERT ON cf_move_in_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_move_in_records_update AFTER UPDATE ON cf_move_in_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_move_in_records_delete AFTER DELETE ON cf_move_in_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_move_in_source_records_insert AFTER INSERT ON cf_move_in_source_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_move_in_source_records_update AFTER UPDATE ON cf_move_in_source_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_move_in_source_records_delete AFTER DELETE ON cf_move_in_source_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_ik_jobs_insert AFTER INSERT ON ik_jobs
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_ik_jobs_update AFTER UPDATE ON ik_jobs
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_ik_jobs_delete AFTER DELETE ON ik_jobs
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_ik_d1_plan_chunks_insert AFTER INSERT ON ik_d1_plan_chunks
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_ik_d1_plan_chunks_update AFTER UPDATE ON ik_d1_plan_chunks
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_ik_d1_plan_chunks_delete AFTER DELETE ON ik_d1_plan_chunks
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donors_insert AFTER INSERT ON cf_donors
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donors_update AFTER UPDATE ON cf_donors
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donors_delete AFTER DELETE ON cf_donors
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donor_merges_insert AFTER INSERT ON cf_donor_merges
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donor_merges_update AFTER UPDATE ON cf_donor_merges
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donor_merges_delete AFTER DELETE ON cf_donor_merges
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donor_aliases_insert AFTER INSERT ON cf_donor_aliases
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donor_aliases_update AFTER UPDATE ON cf_donor_aliases
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_donor_aliases_delete AFTER DELETE ON cf_donor_aliases
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_contact_points_insert AFTER INSERT ON cf_contact_points
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_contact_points_update AFTER UPDATE ON cf_contact_points
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_contact_points_delete AFTER DELETE ON cf_contact_points
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_gifts_insert AFTER INSERT ON cf_gifts
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_gifts_update AFTER UPDATE ON cf_gifts
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_gifts_delete AFTER DELETE ON cf_gifts
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_gift_acknowledgments_insert AFTER INSERT ON cf_gift_acknowledgments
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_gift_acknowledgments_update AFTER UPDATE ON cf_gift_acknowledgments
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_gift_acknowledgments_delete AFTER DELETE ON cf_gift_acknowledgments
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_soft_credits_insert AFTER INSERT ON cf_soft_credits
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_soft_credits_update AFTER UPDATE ON cf_soft_credits
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_soft_credits_delete AFTER DELETE ON cf_soft_credits
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_soft_credit_acknowledgments_insert AFTER INSERT ON cf_soft_credit_acknowledgments
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_soft_credit_acknowledgments_update AFTER UPDATE ON cf_soft_credit_acknowledgments
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_soft_credit_acknowledgments_delete AFTER DELETE ON cf_soft_credit_acknowledgments
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_consents_insert AFTER INSERT ON cf_consents
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_consents_update AFTER UPDATE ON cf_consents
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_consents_delete AFTER DELETE ON cf_consents
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_solicitation_insert AFTER INSERT ON cf_solicitation
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_solicitation_update AFTER UPDATE ON cf_solicitation
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_solicitation_delete AFTER DELETE ON cf_solicitation
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_receipt_autonomy_insert AFTER INSERT ON cf_receipt_autonomy
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_receipt_autonomy_update AFTER UPDATE ON cf_receipt_autonomy
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_receipt_autonomy_delete AFTER DELETE ON cf_receipt_autonomy
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_prior_acknowledgements_insert AFTER INSERT ON cf_prior_acknowledgements
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_prior_acknowledgements_update AFTER UPDATE ON cf_prior_acknowledgements
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_prior_acknowledgements_delete AFTER DELETE ON cf_prior_acknowledgements
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_acks_insert AFTER INSERT ON cf_acks
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_acks_update AFTER UPDATE ON cf_acks
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_acks_delete AFTER DELETE ON cf_acks
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_settings_insert AFTER INSERT ON cf_settings
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_settings_update AFTER UPDATE ON cf_settings
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_settings_delete AFTER DELETE ON cf_settings
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_subscriptions_insert AFTER INSERT ON cf_subscriptions
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_subscriptions_update AFTER UPDATE ON cf_subscriptions
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_subscriptions_delete AFTER DELETE ON cf_subscriptions
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_giving_customers_insert AFTER INSERT ON cf_giving_customers
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_giving_customers_update AFTER UPDATE ON cf_giving_customers
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_giving_customers_delete AFTER DELETE ON cf_giving_customers
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_households_insert AFTER INSERT ON cf_households
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_households_update AFTER UPDATE ON cf_households
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_cf_households_delete AFTER DELETE ON cf_households
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
