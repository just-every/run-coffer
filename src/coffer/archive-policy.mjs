// Donor records, gifts, consent history, letters, appeals, approvals and exact
// import originals are portable. Identity and credential material are excluded;
// a fresh installation claims its own owner.
export default {
 product:'nonprofit/coffer',
 excludeTables:['cf_agent_keys','cf_assert'],
 replaceableTables:['cf_settings'],
 requiredConfiguration:['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM'],
};
