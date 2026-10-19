// Donor records, gifts, consent history, letters, appeals, approvals and exact
// import originals are portable. Identity and credential material are excluded;
// a fresh installation claims its own owner.
export default {
 product:'nonprofit/coffer',
 excludeTables:['cf_research_connection','cf_access_events','cf_stewardship_setup','cf_agent_keys','cf_assert','cf_donor_tokens','cf_giving_limits','cf_email_connection','cf_move_in_parts','cf_move_in_issues'],
 replaceableTables:['cf_tax_report_settings','cf_settings','cf_agent_recovery_settings'],
 requiredConfiguration:['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM'],
};
