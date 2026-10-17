# Fonts

Two families, each self-hosted under the SIL Open Font License 1.1 with its
licence beside the files:

| Family | Use | Files | Licence | Upstream |
| --- | --- | --- | --- | --- |
| Figtree | headings, the Coffer wordmark and body text (app and run site) | `figtree/` (Latin, Latin Extended; weights 300–900) | `figtree/LICENSE.txt` | https://github.com/erikdkennedy/figtree |
| JetBrains Mono | code and the terminal on the run site | `jetbrains-mono/` (Latin; weights 100–800) | `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono |

The variable WOFF2 subsets come from Fontsource's distributions
(`@fontsource-variable/figtree` and `@fontsource-variable/jetbrains-mono` 5.3.0).

Every page links `/fonts/fonts.css` once, outside the temporary dev SSR
stylesheet, and preloads only the primary Latin Figtree file. Do not import
this CSS from a component. Every body-font stack uses `--font-body`, including
the local `Figtree Fallback` before generic fallback fonts; controls inherit it.
A family is downloaded only by a page that uses it.

Fallback scales use Figtree/Arial advance-width ratios over A-Z, a-z and 0-9 at
weights 400, 500 and 700. Ascent, descent and line gap match Figtree's 950,
-250 and 0 per 1000 units, divided by each scale. Matching metrics reduces
layout movement; different glyph designs cannot have identical widths in every
piece of text. Recalculate the fallback and preload when changing the brand font.
