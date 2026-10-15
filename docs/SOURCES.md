# Source provenance

Coffer was generated from the Base foundation at [`ada9f574d8a7247edc3a1180b593ad182b1fbb37`](https://github.com/runeditrun/base/tree/ada9f574d8a7247edc3a1180b593ad182b1fbb37) (`node foundation/cli.mjs`), composed with Base's modules at that revision, converted to the pinned `@runeditrun/rer` **0.2.22** package with Base's `scripts/export-cli.mjs --to-package`, and given Base's import kit (`modules/import-kit/src`, with `modules/d1-transport`) at the same revision. `migrations/core/0015_import_kit.sql` is the kit's exported D1 schema at that revision. The foundation supplies native owner/operator auth, the Worker and D1 runtime, setup, owner-account deployment and portability.

The donor direction comes from the 16 October 2026 FOURTH-TEN decision, section 9. Sibling seeds were read as patterns at these pins; Coffer's code is its own adaptation, not a fork of their modules.

| Source | Pinned file | Coffer use |
| --- | --- | --- |
| Orbit | [`records/repository.ts`, `57e577b`](https://github.com/just-every/run-orbit/blob/57e577bd6b7468c8715c4453055809533257cfee/src/core/features/records/repository.ts) | Versioned records keyed by normalised email; donors and households. |
| Terrace | [`ledger.ts`, `a3bbec6`](https://github.com/just-every/run-terrace/blob/a3bbec676327a5f4c6e4a727cb2ad7fb7b7363a8/src/terrace/ledger.ts) | Integer-cent ledger lines with guards in the same batch; gifts and reversals. |
| Nectar | [`collections.ts`, `2182ef9`](https://github.com/just-every/run-nectar/blob/2182ef96d5a42ed5f717790935693eb6e3d4e8f8/src/nectar/collections.ts) | Drafts a person approves while their basis still holds, exported for the charity's own mail; acknowledgement letters. |
| Mango | [`consent-metadata.ts`, `a2b40f5`](https://github.com/just-every/run-mango/blob/a2b40f5344ca99950fdf9ca4678a2e2ce40477ad/src/core/features/audience/consent-metadata.ts) | Consent capture facts kept with each answer. |
| Mallet | [`049aa5f`](https://github.com/just-every/run-mallet/tree/049aa5f5c8eaa8f6dba475d5364278d06e5b8525) | Package-mode layout, session-authority fences, agent keys and the import-kit adapter shape. |

The Stripe fixture shapes follow Stripe's published API reference (see [MOVE-IN.md](MOVE-IN.md)). Market notes and build evidence stay outside this repository.
