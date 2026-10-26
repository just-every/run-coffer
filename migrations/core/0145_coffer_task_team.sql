CREATE TABLE cf_task_team (
 operator_id TEXT PRIMARY KEY,
 manager_id TEXT,
 version INTEGER NOT NULL CHECK(version >= 1),
 updated_at TEXT NOT NULL,
 CHECK(manager_id IS NULL OR manager_id <> operator_id)
);
CREATE INDEX cf_task_team_manager ON cf_task_team(manager_id);
