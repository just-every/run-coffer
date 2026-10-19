-- Definitions are immutable: changing a fund's purpose must not rewrite accounting history.
CREATE TABLE cf_funds (
 name TEXT PRIMARY KEY,
 restriction TEXT NOT NULL CHECK(restriction IN ('unrestricted','purpose','time')),
 detail TEXT,
 release_on TEXT,
 created_at TEXT NOT NULL,
 CHECK((restriction='unrestricted' AND detail IS NULL AND release_on IS NULL) OR
       (restriction='purpose' AND detail IS NOT NULL AND release_on IS NULL) OR
       (restriction='time' AND detail IS NOT NULL AND release_on IS NOT NULL))
);
CREATE TABLE cf_fund_spends (
 id TEXT PRIMARY KEY,
 fund TEXT NOT NULL REFERENCES cf_funds(name),
 spent_on TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reference TEXT NOT NULL,
 note TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(fund,reference)
);
