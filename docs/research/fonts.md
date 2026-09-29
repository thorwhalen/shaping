# Open fonts for the text source: sources, files, parser

The question: let a text source be set in any open font, with the font's variable axes and several fonts in one text, without shipping fonts and without an API key. The choice is at the end; the evidence, measured on 2026-09-29, comes first.

## What the text source needs from a font

- A catalogue: every family, with category, licence and, for variable fonts, the axes with their real ranges (so the picker can search, and a dial can be drawn before the font is loaded).
- A file per family that carries real glyph outlines and, for variable fonts, the variation tables (`fvar`, `gvar`, `avar`, `HVAR`).
- A cheap way to draw each family's NAME in its own face, so a list of two thousand families is usable.
- A parser that returns outlines with a variation instance applied, in a browser worker and in Node (the command line), under a permissive licence.

## The catalogue

- **Fontsource API** ([api.fontsource.org](https://api.fontsource.org/v1/fonts), [docs](https://fontsource.org/docs/api)). No key. `/v1/fonts` is one JSON list of 2100 families (539 KB uncompressed): id, family, category, weights, styles, subsets, default subset, licence, and `type` (`google` for 1980 families, `other` for 120). `/v1/variable` is a second document (89 KB) with the axes of the 570 variable families: tag, default, min, max, step (Roboto Flex has thirteen). Licences: 2056 OFL-1.1, 36 Apache-2.0, 5 UFL-1.0, a few others. Eight families are in an `icons` category (symbols, not letters); the loader leaves them out. Both documents are served with permissive CORS.
- **google/fonts repository via jsDelivr** ([github.com/google/fonts](https://github.com/google/fonts)). The repository is the source of truth for the Google families, and jsDelivr serves the full TTFs with CORS, variable ones included (`.../ofl/roboto/Roboto[wdth,wght].ttf` answers 200). But there is no catalogue index to fetch: metadata lives in one `METADATA.pb` per family, file names must be read from it, and a directory listing needs the GitHub API (60 requests an hour without a key) or jsDelivr's flat listing of tens of thousands of files. Good as a fallback for the files; poor as a catalogue.
- **Google Fonts CSS2 API** ([developers.google.com/fonts/docs/css2](https://developers.google.com/fonts/docs/css2)). No key for CSS, but the list of families (the Developer API) needs one. It has no axes table. What it does well is the `text=` parameter, below.

## The files

- **Fontsource on jsDelivr** (`cdn.jsdelivr.net/fontsource/fonts/<id>@latest/<subset>-<weight>-normal.ttf`). Static families come as TTF (and WOFF2, WOFF): no decoder needed. Variable families come only as WOFF2, as `<id>:vf@latest/<subset>-<axes>-normal.woff2`, and which file exists differs per family: `full` (all axes), `standard`, `wght`, `wdth`, `opsz`, or none at all (some Playwrite families are listed as variable and have no variable file). The subset is Latin by default (13 families have no Latin subset and use their default). So the loader tries the candidates in order, treats a 404 as "next", and falls back to the static TTF nearest to regular weight. Roboto Flex `full` is 326 KB as WOFF2 and 653 KB decoded, with all thirteen axes and their `gvar` deltas intact.
- The alternative to decoding WOFF2 is the google/fonts TTFs above, at the price of the naming problem. Decoding is the smaller cost: one dependency, 305 KB in the bundle, loaded only when a WOFF2 file arrives.

## The name of each family in its own face

- **Google origin (1980 of 2100 families): the CSS2 API with `text=`.** `https://fonts.googleapis.com/css2?family=Lobster&text=Lobster&display=swap` returns a stylesheet that points to a font containing only those letters, a few hundred bytes to a couple of kilobytes, instead of the family (tens of kilobytes per subset). One `<link>` per row that scrolls into view; the list is windowed, so only the rows in view exist. The request carries only the family name.
- **Other origin (120 families):** the Fontsource Latin 400 WOFF2 through the `FontFace` API, on the same trigger.
- Not done: batching several families into one request. `text=` is shared by all families of a request, so batching would send every name's letters for every family; one request per visible row is simpler and small.

## The parser

| | Licence | Variable fonts | Kerning | WOFF2 | Size | Notes |
|---|---|---|---|---|---|---|
| [opentype.js 2.0.0](https://github.com/opentypejs/opentype.js) | MIT | Yes: `fvar`, `gvar`, `avar`, `cvar`, `HVAR`; `getTransform(glyph, coords)` returns the glyph with the instance applied (tested: bounding box and outline change with `wght`) | `GPOS` and `kern` | No (needs a decoder) | 245 KB minified, no dependencies | Runs in Node and browsers. `GSUB` (ligatures) is parsed but not applied by `getPath`. Its `getAdvanceWidth` with variation is unreliable; the module reads the advance from `getTransform` instead. |
| [fontkit 2.0.4](https://github.com/foliojs/fontkit) | MIT | Yes (`getVariation`) | `GPOS` | Yes, built in | 5.6 MB unpacked; several dependencies (`restructure`, `brotli`, `dfa`, ...) | More complete layout, heavier, Node-first packaging. |
| [harfbuzzjs 1.6.2](https://github.com/harfbuzz/harfbuzzjs) | MIT | Yes, and the most faithful: HarfBuzz applies `GSUB` and `GPOS`, variations, and draws glyphs with `hb-draw` | Full | No | 1.3 MB unpacked, WebAssembly | The right engine if ligatures and complex scripts matter. Not tried here beyond reading its documentation. |

WOFF2 decoder: [wawoff2 2.0.1](https://github.com/fontello/wawoff2), MIT, Google's woff2 decoder and Brotli compiled to WebAssembly, the wasm embedded in the script (305 KB). Nothing GPL, LGPL or AGPL is bundled.

## Choice

- **Catalogue and files: Fontsource** (API and the jsDelivr mirror). It is the only source that gives, without a key and in two requests, the whole catalogue with the variable axes, and static TTFs directly. Cost: variable files are WOFF2 only, so a decoder is bundled; and the file name has to be guessed from a short candidate list.
- **Parser: opentype.js 2.** It applies variation instances, reads kerning, is the smallest, and has no dependencies. Cost: no ligatures or contextual substitutions, and colour and complex-script shaping are out of reach. The module hides it behind `OutlineFont` (axes, `glyph`, `kerning`), so harfbuzzjs can replace it later without touching the layout code.
- **Names in their own face: the Google CSS2 `text=` subset**, with the `FontFace` API for the 120 non-Google families.
- **Caching in the browser:** the catalogue is saved in IndexedDB for a week; font files are saved in IndexedDB the first time they are used, least-recently-used out beyond 64 MB or 150 files, with the common families evicted last. Nothing is prefetched, which keeps the first load light; the "common" families are the ones the picker lists first and the cache keeps longest.

## What is loaded, and what geometry we get

- The outlines are the fonts' own: every contour of every glyph, curves flattened adaptively to 0.0004 em, with the instance's `gvar` deltas applied. Variable fonts draw overlapping contours on purpose; the fill rule is non-zero, so the kernel's union settles them.
- Axes: whatever the font declares, with its own range and default. The editor draws a dial per axis from the font file itself (the catalogue's table is only a preview).
- A static family has no axes; the editor says so.

## Privacy and licence

- The app asks the network only for the catalogue, font files and, for the name previews, the family name. Nothing of the design leaves the browser.
- The fonts are not bundled or committed. The catalogue's `license` field is on each entry; OFL and Apache fonts allow turning their letters into an object you print or sell, the Ubuntu Font Licence likewise, but a user shipping a product should check the licence of the family they chose.

## References

[1] Fontsource, API documentation. https://fontsource.org/docs/api
[2] Fontsource API, font list. https://api.fontsource.org/v1/fonts and variable axes https://api.fontsource.org/v1/variable
[3] jsDelivr, Fontsource mirror. https://cdn.jsdelivr.net/fontsource/fonts/
[4] google/fonts repository. https://github.com/google/fonts
[5] Google Fonts CSS2 API. https://developers.google.com/fonts/docs/css2
[6] opentype.js. https://github.com/opentypejs/opentype.js
[7] fontkit. https://github.com/foliojs/fontkit
[8] harfbuzzjs. https://github.com/harfbuzz/harfbuzzjs
[9] wawoff2. https://github.com/fontello/wawoff2
[10] SIL Open Font License 1.1. https://openfontlicense.org
