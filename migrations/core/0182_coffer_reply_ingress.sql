-- Opaque replay receipts survive erasure without retaining a donor identity,
-- sender address, subject or excerpt. Deleting the private task leaves only
-- its one-way ingress hash, so an old capture cannot move to a new identity.
CREATE TABLE cf_reply_ingress (
 id TEXT PRIMARY KEY CHECK(length(id)=64),
 task_id TEXT REFERENCES cf_reply_tasks(id) ON DELETE SET NULL
);
CREATE INDEX cf_reply_ingress_task ON cf_reply_ingress(task_id);
