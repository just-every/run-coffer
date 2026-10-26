ALTER TABLE cf_task_team ADD COLUMN weekly_call_capacity INTEGER NOT NULL DEFAULT 10
 CHECK(weekly_call_capacity >= 0 AND weekly_call_capacity <= 1000);
