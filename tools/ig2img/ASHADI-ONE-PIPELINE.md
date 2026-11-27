# Ashadi — the one pipeline (spec of 2026-11-22)

New document. It does **not** replace `ASHADI-PIPELINE.md` or `SEO AGENT/output/canva_fbt/PIPELINE-reference-to-canva.md`;
it is the single behaviour both now follow. Code backups from before this change are in `_backup-2026-11-22/`.

Ashadi is the graphic designer. Sithiji is the content manager. Ashadi works on one queue, one job at a time.

---

## 1. Four ways a job arrives — one queue

| # | Route | What the job carries | Product |
|---|---|---|---|
| 1 | **Telegram link, a photo, or a link pasted in the Ashadi front end** | Instagram or Pinterest link, or an image. Optional Kapruka product or category link. | Fetched if a link is given, or matched from what the reference advertises |
| 2 | **Sithiji "Send to Ashadi" button** | The card's own pictures and caption. Only cards Sithiji judges recreatable: a still image or carousel with a clear picture. No reels, no unrealistic ones. | Fetched if the card carries a product link, or matched from what the reference advertises |
| 3 | **Create form: Design / Persona promotion / Promote**, with references | Up to 3 references (Pinterest link, uploaded image, pasted image), each becomes its own design. Optional product or category link. | Fetched from the link, or matched from the promotion text |
| 4 | **Create form with no reference** (persona promotion, promote) | A persona or a thing to promote. | The strategist chooses; real product fetched from the text or link |

The tab that used to be called **Ideas** is now **Persona promotion**.

**Number of designs = number of references** you give. A job with no reference makes one design (or 1 to 4, if you ask for that many).

Every route creates the same job row, in the same queue, and shows in the same tracker.

---

## 2. Direct, indirect, or none

Decided by how the reference relates to **what is being promoted**, not by where the reference came from:

| Case | Mode | What Ashadi does |
|---|---|---|
| The reference advertises the same product or category as the promotion (a perfume reference for a perfume promotion) | **Direct** | Keep the composition, camera, lighting, layout and type hierarchy. Rebuild it for Kapruka with the real product, our copy, logo, palette and fonts. |
| The reference advertises something else (a watch reference for a perfume promotion) | **Indirect** | Keep only the look: composition feel, lighting, colour mood, type hierarchy. The hero becomes the promoted product, with new copy. |
| No reference | **None** | The creative strategist writes the angle and the brief; a built-in layout (purple-hero or light-split) carries it. The prompt goes to the image engine with the real product images attached. |

- **Auto by default.** Gemini looks at the reference and decides direct or indirect by comparing what it advertises with what you promote (`classifyRelation` in `lib/oneflow.mjs`). The Create form has a "Reference type" override: Auto, Direct, Indirect.
- **Nothing promoted named** (a bare Telegram link with no product): the reference is copied for Kapruka (direct), and the product is matched from what the reference advertises.
- A document of yours will later define the exact rules and scripts for direct and indirect. The switch is built so that document plugs in at the adapter and the picture prompt.

---

## 3. Decisions that settle the contradictions between the two older documents

| Point | Decision | Why |
|---|---|---|
| **Margins** | **100px on all four sides** for text, logo and objects. Logo's top edge within 110px of the top. | Your standing rule (2026-11-17). The 90px in the older canva_fbt document and its audit script are superseded. |
| **How products are drawn** | **The real product, from its real picture.** The product's packshot is cut out, put on a product sheet and attached to the image engine, with the printed label words spelled out. No blank packaging for real products. | Your rule: the product looks exactly like the original. The blank-packaging, text-free picture could never do that. |
| **Text in the picture** | None, except the words already printed on the real products. The picture checker does not count those as defects. | Packaging text belongs to the product. Headlines and logos stay editable layers in Canva. |
| **Reference given to the image engine** | Direct: attached as the composition reference. Indirect: attached as mood only (do not copy). None: not applicable. The layout sketch is attached too, so objects land inside the margins. | The older document's method, now applied here. |
| **Engines** | **Gemini only**, with Meta AI only as an automatic fallback if Gemini gives nothing usable. | Meta ignores uploaded layouts and product sheets (canva_fbt finding). |
| **Thinking steps** | **Gemini in your browser, no Claude CLI** (`ASHADI_AI` defaults to Gemini; set `cli` or `auto` to bring the CLI back). | Your route. No Claude limit, no sign-in to maintain. |
| **Outputs** | **One design per reference.** `FINAL.png` is written automatically. | Your decision. |
| **Another brand's creative** | The default stays direct, as you chose, with brand names and products swapped. Indirect is used when the reference is a different product. | Your decision. |

Banned words, claims rules, Inter and the brand palette are unchanged.

---

## 4. The stages (one job)

1. **Intake and job record** — origin, description, references (max 3), product link, persona or promo, reference type.
2. **Reference ready** — Instagram slides saved, Pinterest picture downloaded, or the uploaded image copied.
3. **Real product** — the given page or category is read in the signed-in Chrome (waits out the shop's anti-bot page); the original images are downloaded, cut out (rembg), laid on `product-sheet.png`; Gemini reads the exact words printed on the packs. Saved in `products.json`.
4. **Reference type** — Auto/Direct/Indirect, or None.
5. **Strategist (None only)** — angle, audience, headline, supporting line, layout and picture prompt. Saved in `strategist-brief.json`.
6. **Measure and adapt (Direct/Indirect)** — reference layout measured on a grid; adapted to Kapruka with the target product.
7. **Picture** — Gemini receives the layout sketch, the reference (direct composition / indirect mood), and the real product sheet. Picture check, watermark crop, margin placement, colour correction.
8. **Layers** — Inter, editable text, logo, 100px margins.
9. **Canva** — layered file imported; preview exported.
10. **Review and repair** — art director check (Gemini) including product label spelling and margins, up to 3 fix rounds.
11. **Final output** — exported from Canva, `FINAL.png`, Canva link written to the tracker, and the result sent back to the origin (Telegram message, Sithiji card, or the web page).

---

## 5. The project tracker

A **Tracker** tab in the Ashadi front end. One row per job (so one per reference):

| Column | What it shows |
|---|---|
| **From** | Ashadi front end, Telegram or Sithiji, plus the kind (Reference, Persona promotion, Promote) |
| **Job** | Description, creative note, product link |
| **Status** | Updates itself from the pipeline's own progress lines: Queued (#n), Running with the current stage, Done, Failed, Stopped, Interrupted |
| **Final Canva project** | "Open in Canva" link and a link to the final picture; "pending" until then |

- Rows are saved to `web/data/tracker.json`, so they survive a restart. Jobs that were waiting or mid-run when the PC restarted are put back in the queue once, automatically.
- Only one job runs at a time; the rest wait in order.
- Telegram jobs are answered in Telegram when they finish (final picture + Canva link). Reply "final" after editing in Canva to get your edited version; "retry" re-sends to Canva.

---

## 6. Files

| File | Role |
|---|---|
| `lib/oneflow.mjs` | **New.** References, real products, direct/indirect, strategist, layout templates |
| `lib/cutout_sheet.py` | **New.** Cut-outs and the product sheet |
| `design.mjs` | The pipeline: new `relation`, `target`, `products`, `brief` inputs; Gemini-only default; Meta fallback; auto final |
| `lib/designer.mjs` | Gemini by default; adapter knows the promoted product and indirect mode; art director checks product labels |
| `web/server.mjs` | Job model, one job per reference, uploads, tracker file and API, Telegram hand-back |
| `web/job-runner.mjs` | Runs any job through the one pipeline |
| `web/public/*` | Persona promotion tab, references and product link fields, Tracker tab |
| `telegram-bot.mjs`, `lib/telegram.mjs` | Messages and photos become queue jobs; no classifier, no CLI |

## 7. Known limits

- **Product sheets can include cartons and imperfect cut-outs** on white-on-white glass. Check the product against the shop page before posting.
- **Gemini's review is looser than Claude's.** The art director still runs, with product-label and margin checks.
- **A reference whose hero runs off the edge** is placed whole inside the 100px margin, so it comes out smaller than the source.
- **Pinterest** links are read from the pin's public picture; if Pinterest blocks it, upload the image instead.
- **Direct/indirect rules** from your upcoming document are not in yet; the current rules are the ones in section 2.
