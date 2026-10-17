-- The owner connects Mango or Mailchimp from the Appeals page. Read at request time.
CREATE TABLE cf_email_connection (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 provider TEXT NOT NULL CHECK(provider IN ('mango','mailchimp')),
 origin TEXT,
 credential TEXT NOT NULL,
 list_id TEXT,
 list_name TEXT,
 from_name TEXT,
 from_email TEXT,
 checked_at TEXT,
 check_note TEXT,
 saved_at TEXT NOT NULL,
 saved_by TEXT NOT NULL
);
