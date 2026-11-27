# Ashadi — pipeline from reference to final output

Ashadi (Telegram bot @Ashadiabot, web UI at http://127.0.0.1:5041) takes a reference creative — an Instagram post or a
Sithiji card — and rebuilds it for Kapruka as an **editable Canva design**, then exports a **final PNG**.
Everything runs on this PC, one job at a time.

Code: `tools/ig2img/` — `design.mjs` (pipeline), `lib/designer.mjs` (the AI steps), `lib/gemini.mjs`, `lib/meta.mjs`,
`lib/canva.mjs`, `lib/layered.mjs`, `web/server.mjs`, `web/job-runner.mjs`.

---

## 1. The pipeline

| # | Stage | What happens | Who does it |
|---|---|---|---|
| 1 | **Reference** | Open the post, save every slide image and the caption. For Sithiji, the card's images arrive base64 and are saved to the inbox. | Playwright on the signed-in automation Chrome (port 9222) |
| 2 | **Reverse-engineer** | Measure the layout on a 5% grid: canvas, every text block (words, box, font, size, colour), logos, ornaments, the picture area, lighting, palette. Writes `reference-spec.json`. | Claude CLI (Opus), else Gemini in the browser |
| 3 | **Adapt** | Rewrite the spec for Kapruka: same geometry and hierarchy; Kapruka copy of the same length and job, Kapruka product, logo, palette. Writes `kapruka-spec.json`. (Only in `creative` mode is a new concept added first.) | Claude CLI, else Gemini |
| 4 | **Picture** (text-free) | Draw a layout sketch (grey = where the objects go), then paint the picture with **Meta AI and Gemini in parallel**. A vision check looks for painted text, logos, watermarks, packaging faces and objects clipped by an edge. A defect triggers one regeneration with the defect named. | Meta AI, Gemini, picture-checker (`inspectScene`) |
| 5 | **Place and brand** | Crop the watermark, composite the objects into their area inside the 100px margin (feathered, no seam), flatten near-backdrop haze, pull the colours toward Kapruka purple `#4B2386`, add the packaging logo. | PIL / numpy in `design.mjs` |
| 6 | **Layers** | Turn the spec into a layered PPTX (1080×1350). All text Inter; headline, label, badge, CTA and price bold. `enforceLayout` pulls text and the header logo inside the margins and fits the logo to 5.68:1. | `toLayers`, `enforceLayout`, `lib/layered.mjs` |
| 7 | **Canva** | Import the PPTX through the Canva Connect API (text stays editable) and export a preview PNG. | `lib/canva.mjs` |
| 8 | **Review and repair** | The art director checks the Canva render and lists issues; the fixer turns them into layer patches; re-import and re-check, up to 3 rounds. The picture may be regenerated once. The best-scoring round is kept (`reviewScore`). | art-director (`reviewDesign`), fixer (`fixDesign`), `polish()` |
| 9 | **Final** | Export each design from Canva as `final-NN-<time>.png` and copy the better design to **`FINAL.png`**. Runs automatically at the end of every job. | `pullFinal` in `design.mjs` |
| 10 | **Optional: your edit** | Edit the design in Canva, then use "pull final" (web UI, Telegram, or the Sithiji card) to export your version as a newer `final-NN` file. | You |

A run normally produces **two designs** (Meta AI picture and Gemini picture). `FINAL.png` is the one the art director scored higher
(`reviewScore`: verdict rank × 1000 minus issue weights — high 10, medium 3, low 1). The score is the art director's opinion, so look at both.

---

## 2. Adaptation modes

Set with `ASHADI_STYLE`. Default is **`adapt`**.

| Mode | What it does |
|---|---|
| `adapt` (default) | Same layout, same visual device, same composition. Kapruka copy of the same length and job, Kapruka product, logo, palette. No new concept. |
| `replica` | Even closer copy of the source. |
| `creative` | Adds a concept step that reinterprets the idea for Kapruka. Switched off by default (decision 2026-11-17: "exact thing Kapruka adapted — that's it"). |

### How much changes from the source (in `adapt` mode)

| | Result |
|---|---|
| Layout (positions, sizes of text blocks and picture area) | Copied; about 0% changed |
| Words | The brand word, product word and any name change. Lengths are kept. Measured on the Biscoff test: about 25% of words |
| Fonts | 100% changed to Inter (standing rule) |
| Colours | 100% changed to the Kapruka palette |
| Product | Swapped for a Kapruka product. The visual device (e.g. red stiletto with pitchfork) is kept exactly in colour and material |
| Logo | Added (standing rule) |
| Small ornaments | Often dropped (the devil-tail arrow was lost) |
| The picture | Always redrawn by an image AI, never copied pixel for pixel. Size, crop and fine detail vary |

Measured on one reference only (the Devil Wears Prada / Biscoff parody, about 18 runs). Other reference types are untested.

---

## 3. Standing rules (enforced in the AI prompts and again in code)

1. **Logo** within 110px of the top.
2. **Brand guidelines** followed strictly.
3. **Product looks exactly like the original post**, with no changes.
4. **100px margin on all sides** — text, logo and picture objects (so objects are placed whole; nothing bleeds off the edge).
5. **Font is Inter** everywhere. Canva only honours Regular and Bold.
6. **Do not over-localise** (no "amma", "akka" and the like).
7. **Clean and refined** look, but never write the banned words (premium, luxury, exclusive, best, amazing and the rest of the list in `CLAUDE.md`).
8. A keep-the-device rule: a glossy red stiletto stays a glossy red stiletto — do not recolour it to purple.

---

## 4. Which AI answers the thinking steps

`runClaude()` in `lib/designer.mjs`:

1. **Claude CLI** (`claude -p --model opus`) first — sharper measuring and review, clear errors.
2. If the CLI fails for any reason (not signed in, 5-hour limit), it logs `Claude CLI unavailable for <step> … asking Gemini instead` and uses **Gemini in the signed-in Chrome** (`askGemini`): images are pasted in, the prompt is pasted, the reply is read back as JSON.
3. `ASHADI_AI=gemini` forces Gemini and skips the CLI.

| | Claude CLI | Gemini in browser |
|---|---|---|
| Review quality | More thorough (found 9 issues where Gemini found 2–3) | Looser |
| Limits | Shares the Claude plan's 5-hour limit with other automations | Own Gemini limits |
| Sign-in | Per Windows user, PC-wide; broke several times | Uses the automation Chrome profile |
| Failure mode | Clear error message | Breaks if Chrome closes or Gemini's page changes |
| Speed | About 10–12 min per job | About 20 min per job |

The CLI login lives in `C:\Users\fari\.claude` and is shared by every Claude automation on this PC.
Re-login with `claude auth login`; check with `claude auth status`.

---

## 5. Output files

Each run writes `3-output/ashadi-designs/ig-<post-id>-<timestamp>/`:

| File | What it is |
|---|---|
| `FINAL.png` | The final output: the better design, exported from Canva |
| `final-NN-<time>.png` | Final PNG of each design (and of any later "pull final") |
| `preview-NN[-rN].png` | Canva render at each repair round |
| `design-NN[-rN].pptx` | The layered PPTX sent to Canva |
| `design.json` | Everything about the run: source, title, style, `best`, and per design: engine, Canva ids and links, art-director verdict and issues, repair rounds |
| `reference/` | The saved source images |
| `reference-spec.json`, `kapruka-spec.json` | The measured source and the Kapruka adaptation |
| `layout-sketch.png` | The guide sketch given to the image AIs |
| `renders/` | Raw pictures from Meta AI and Gemini |
| `scene-check-*.json` | Picture-checker results |
| `placed-NN*.jpg` | Picture after placement and colour correction |

---

## 6. Running it

- **Web UI:** http://127.0.0.1:5041 (started by `web/start-web.ps1`). Paste an Instagram link, choose Design, then Stop at any time.
- **Telegram:** send a link to @Ashadiabot.
- **Sithiji:** each card with a recreatable still image or carousel (68 of 83 at the last count) has a **Send to Ashadi** button on https://pricelens.lanka.info/sithiji/ . The VPS only queues the job. The PC worker (`sithiji/worker_pc.py`, started at logon) claims it, runs the design locally, and posts previews and the Canva link back to the card. "Pull final" on the card brings the Canva export back.
- **Autostart:** scheduled task `Kapruka-ig2img-autostart` (at logon and every 5 minutes) restarts Chrome, the bot, the web server and the Sithiji worker.
- Jobs run one at a time. **Do not close Chrome, sign out or restart during a run** — it kills the job (seen 2026-11-21 22:57).

Environment variables: `ASHADI_STYLE` (`adapt` | `replica` | `creative`), `ASHADI_AI` (`gemini` to skip the CLI).

---

## 7. Known limits

- **Picture fidelity.** The image AI redraws the product and scene, so the result is an adaptation of the picture, not a copy. Fine details (like the arrow on the "V") are often lost.
- **Bleed versus margin.** Sources whose hero object runs off the page edge (like the shoe) end up smaller, or cut off in a hard line at the 100px margin. Allowing a bleed for the hero object would need a rule change.
- **Gemini review is looser than Claude's.** While the CLI is signed out, flaws are more likely to get through.
- **Tested on one reference** (Instagram DYW3V6IFNYs). A calibration batch of varied references has not been run.
- **Not built yet:** reusing the source product photo's own pixels for Kapruka-own posts, rebuilding ornaments, an Ashadi-only Claude login (`CLAUDE_CONFIG_DIR`), an API-key path, and automatic cleanup of intermediate Canva designs.
