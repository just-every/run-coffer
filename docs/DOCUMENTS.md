# Documents on records

Open a constituent’s page and use Documents. Choose the constituent, a gift, a pledge or an opportunity; give the document a title and select the file. The installation stores the bytes in its own FILES bucket. PDF, plain text, PNG and JPEG uploads accept 1–256,000 bytes. Titles open the protected browser preview; Download saves the original file. The existing staff document roles (owner, admin and member) apply; an agent key cannot upload or read a document.

The full archive includes file metadata, record bindings and original R2 bytes. A donor’s requested data file includes only that donor’s documents, with their original bytes encoded as base64. Merge moves the documents with their records; undo restores their ownership. A document added after a move-in prevents undo from removing its imported parent.

Erasure removes the documents and their R2 objects while retaining other constituents’ files. Object deletion is queued in the same database transaction, so an interrupted storage cleanup remains available for the next cleanup. Unpublished uploads are reclaimed after one hour. A missing stored object is reported as an incomplete file rather than returned as an empty document.

The clause-named journey is `tests/documents.test.mjs`; its browser portion uses bundled Chromium’s native PDF viewer at 1440 and 390 pixels. It is included in push Verify’s record-documents shard. Native PDF preview requires full bundled Chromium, while the other journeys continue using the headless shell.
