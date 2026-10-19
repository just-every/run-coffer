-- REPORT-003: targets are explicitly recorded for an exact fiscal year.
CREATE TABLE cf_dashboard_goals (
 year INTEGER NOT NULL,
 fiscal_start TEXT NOT NULL,
 dimension TEXT NOT NULL CHECK(dimension IN ('organization','fund','campaign','appeal','form','channel','month')),
 dimension_key TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>=0),
 version INTEGER NOT NULL CHECK(version>0),
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 PRIMARY KEY(year,fiscal_start,dimension,dimension_key)
);
-- Attribution is written only by the actual online checkout/charge path.
CREATE TABLE cf_dashboard_gift_forms (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 form_id TEXT NOT NULL REFERENCES cf_campaigns(id)
);
INSERT OR IGNORE INTO cf_dashboard_gift_forms(gift_id,form_id)
 SELECT g.id,c.id FROM cf_events e JOIN cf_gifts g ON g.id=e.subject_id
 JOIN cf_campaigns c ON c.id=json_extract(e.detail,'$.campaignId')
 WHERE e.action='giving.paid' AND g.source='stripe' AND g.kind='gift';
