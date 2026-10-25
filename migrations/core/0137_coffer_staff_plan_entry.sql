ALTER TABLE cf_giving_intents ADD COLUMN staff_actor_id TEXT;
ALTER TABLE cf_giving_intents ADD COLUMN staff_actor_name TEXT;
ALTER TABLE cf_giving_intents ADD COLUMN staff_channel TEXT CHECK(staff_channel IN ('phone','mail'));

CREATE TABLE cf_gift_channels_next (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('form','event','mail','email','text','phone'))
);
INSERT INTO cf_gift_channels_next SELECT * FROM cf_gift_channels;
DROP TABLE cf_gift_channels;
ALTER TABLE cf_gift_channels_next RENAME TO cf_gift_channels;
