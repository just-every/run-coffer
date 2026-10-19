-- Campaign planning dates keep their existing meaning; closing only affects
-- new checkout requests, never the recording of an earlier payment or refund.
ALTER TABLE cf_campaigns ADD COLUMN closes_on TEXT;
CREATE TABLE cf_campaign_media (
 campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('image','video')),
 media_type TEXT NOT NULL CHECK(media_type IN ('image/png','image/jpeg','image/webp','video/mp4')),
 description TEXT NOT NULL,
 content_base64 TEXT,
 object_key TEXT UNIQUE,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
 PRIMARY KEY(campaign_id,kind),
 CHECK((kind='image' AND media_type IN ('image/png','image/jpeg','image/webp') AND content_base64 IS NOT NULL AND object_key IS NULL)
  OR (kind='video' AND media_type='video/mp4' AND content_base64 IS NULL AND object_key IS NOT NULL))
);
-- In-flight upload ownership is installation-local, excluded from archives.
-- A failed request removes its own unpublished object and reservation.
CREATE TABLE cf_campaign_video_uploads (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL UNIQUE REFERENCES cf_campaigns(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL UNIQUE,
 started_at TEXT NOT NULL,
 discarded_at TEXT
);
