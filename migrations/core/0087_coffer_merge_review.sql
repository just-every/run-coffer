-- RCPT-010: field keys only, frozen with the rendered letter. NULL means an older unchecked document.
ALTER TABLE cf_acks ADD COLUMN merge_blanks TEXT CHECK(merge_blanks IS NULL OR (json_valid(merge_blanks) AND json_type(merge_blanks)='array'));
