-- January preparation is an explicit revocable grant, never owner authority.
-- One action is one preparation run, with human approval and sending unchanged.
INSERT INTO cf_automation_grants(id,name,commands,daily_limit)
VALUES('statements','January annual statement preparation','["statement.prepare"]',1);
