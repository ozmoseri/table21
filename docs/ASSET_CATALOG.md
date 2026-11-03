# Asset catalog fields

`assets/manifest.json` is the single catalog of every runtime image under `apps/web/public` (art, icons, favicon).
It is checked by `tests/unit/contracts.test.ts` and measured by `scripts/asset-check.mjs`.

```bash
node scripts/asset-check.mjs           # table of every entry; exit 1 when a recorded value differs from the file
node scripts/asset-check.mjs --write   # re-measure and rewrite the measured fields
```

| Field | Written by | Meaning |
|---|---|---|
| `id` | human | Stable id, `<group>.<name>`: `avatar.amber`, `back.classic`, `club.felt-portrait`, `gift.tea`, `icon.pwa-192`. Gift, reaction, avatar and back ids must match the protocol / server lists. |
| `file`, `role`, `source`, `provider`, `license`, `prompt`, `fallback`, `status`, `sourceFile` | human | As before. `license` and `source` must be non-empty. |
| `version` | human | Integer, 1 until the file is replaced by a new render; bump it then. |
| `status` | human | `active` (file exists and is used), `pending_manual` (planned, file must not exist yet, measured fields are null), `deprecated`. |
| `anchor` | human | Where the code places it: `center`, `top-center` (room and felt: `center top / cover`), and so on. |
| `alphaRequired` | human | Whether the role needs transparency. True: avatars, dealer, vector card backs, the old `club.cardback` (rounded corners), chips, coffee and other gift or reaction icons. False: room and felt backgrounds, `club.cardback-simple` (full bleed, the CSS gives it the 8 px radius), app icons (opaque on purpose for apple-touch and maskable). |
| `bytes`, `format`, `width`, `height` | `--write` | Read from the file. SVG size is the viewBox. |
| `alphaPresent` | `--write` | Read from the header, not decoded: PNG color type 4/6 or tRNS; WebP VP8X alpha flag or VP8L alpha bit; lossy WebP and JPEG false; SVG true. A set flag does not prove a pixel is transparent, so alpha is still reviewed visually. |

Rules enforced by the test: ids and files unique; every active file exists and matches its recorded measurements;
`alphaRequired` implies `alphaPresent`; every image file under `apps/web/public` is in the manifest; every `/art/...`,
`/icons/...` or favicon path used in `apps/web/src`, `index.html`, `boot.js` or the web manifest is in the manifest
(template strings are expanded from the avatar and card-back id lists); no UI text is baked into images (reviewed by eye,
never rejected automatically).
