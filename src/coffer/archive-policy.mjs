// Donor records, gifts, consent history, letters, appeals, approvals and exact
// import originals are portable. Identity and credential material are excluded;
// a fresh installation claims its own owner.
export default {
 product:'nonprofit/coffer',
 // Calendar authorization and donor booking links must be re-approved after restore.
 excludeTables:['cf_qbo_connection','cf_qbo_oauth','cf_sms_registration','cf_calendar_oauth','cf_meeting_links','cf_api_keys','cf_api_rate_windows','cf_api_idempotency','cf_development_report_schedule','cf_development_report_clock','cf_webhook_subscriptions','cf_webhook_events','cf_webhook_deliveries','cf_webhook_attempts','cf_giving_connections','cf_recovery_notice_policy','cf_identity_ingest','cf_score_clock','cf_contact_edit','cf_address_processing','cf_person_name_clock','cf_research_connection','cf_access_events','cf_stewardship_setup','cf_agent_keys','cf_agent_grants','cf_agent_grant_control','cf_agent_grant_usage','cf_agent_grant_dispatches','cf_agent_preparation_grants','cf_agent_preparation_usage','cf_automation_grants','cf_automation_usage','cf_assert','cf_donor_tokens','cf_giving_limits','cf_email_connection','cf_move_in_parts','cf_move_in_issues','cf_campaign_video_uploads','cf_document_purges','cf_document_uploads'],
 buckets:{FILES:{objectReferences:{table:'cf_file_objects',keyColumn:'object_key'}}},
 replaceableTables:['cf_journey_policy','cf_pledge_template','cf_household_defaults','cf_tax_report_settings','cf_settings','cf_agent_recovery_settings','cf_receipt_autonomy'],
 requiredConfiguration:['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM'],
};
