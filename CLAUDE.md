# CLAUDE.md — Kapruka Ad Creative Pipeline

> This file orchestrates the Kapruka performance-creative system. It tells any agent (or Claude Code session) how the pipeline fits together, what each role reads and writes, the operating cadence, and the rules that keep the flywheel turning instead of resetting every week.

---

## WHAT THIS SYSTEM IS

A repeatable creative flywheel for Kapruka's Meta (Facebook/Instagram) ads, built on the modern Andromeda-era paradigm: **creative is the targeting.** We build concepts around personas; the persona in the creative finds its own audience. We test in modular packs, judge by incremental attribution, kill losers, and iterate winners. The goal is a system that compounds — not one that resets with every new tactic.

**Current scope:** static image creatives only. Two business lines (Gifting, Self-Purchase). Generation is for priority personas the human names each month. **No product/offer advertising** (no SKUs, prices, or deals) until the human explicitly flags one.

> **SCOPE DECISION (2026-06-28) — the system delivers IDEAS, not pixels.** The ads pipeline does **NO AI image generation**, and **no scanned Pinterest pins reach the Build Sheet.** The single monthly deliverable is the **Build Sheet PDF**, due **by the 10th of each month**, carrying **six columns: Source · Business line · Persona · Angle · Hook · Format (in plain words)**. A human designer builds the actual creative from those words. Retired/dormant: the **Track B** recreate sheet, `tools/ref2creative.py` / `tools/generate_creatives.py`, and the Art Director's image-gen-prompt output. They stay on disk (reversible) but are not run.
>
> **AMENDMENT (2026-06-29 → 2026-07-01) — Image Researcher is an upstream INSPIRATION READER (human-fed).** It runs **daily at 4pm** to read **the images the human drops into `1-foundation/references/swipe-file/inbox/`** and distil **the angle each one suggests**, feeding the **Researcher, Ideator, and Strategist** via the swipe file. **It no longer scouts/finds images itself** (Pinterest grid scout retired 2026-07-01 — the human supplies the images, Claude reads them). It still does **NO image generation**, and its finds **never** become Build-Sheet pins (the sheet stays six columns). Pure inspiration → angles. See `2-roles/11-image-researcher.md`.

### The model in one screen

```
THREE LINES        PERSONA GRID (broad — the relationship situation)
Gifting (Int)   →   Romantic · Parents · Kids · Siblings · Friends · Social/Obligation
Gifting (Local) →   Romantic · Parents · Kids · Siblings · Friends · Social/Obligation
Corporate(Local)→   Staff/employees · Customers/clients
Ecom (Local)    →   Self-Purchaser
                    = 12 gifting + 2 corporate (Local) + 1 ecom = 15 personas
```

- **Three business lines:** **Gifting** (Int+Local) · **Corporate** (Local only — own packs, own economics: B2B, bulk, branded, invoicing; 2 personas: Staff/employees · Customers/clients) · **Ecom** (Local). Corporate is its own line, never folded into Gifting.
- **Geography is a primary split for Gifting** (International → Local carries the diaspora moat; Local → Local is convenience). **Corporate and Ecom are Local only.**
- **Personas are broad relationship situations, not demographics.** They are the *exploration unit*. Keep them broad so research and idea generation stay wide — don't pre-narrow.
- **The individual ad is sharp.** Narrowing happens at the *ad* via optional modifiers — it's one ad, not the whole strategy, so narrowing costs nothing.
- **Modifiers (optional sharpness dials):** Occasion · Emotion. Zero modifiers = broad-brand ad; more modifiers = a sharper swing. The floor is: **every ad has exactly one clear job.**
- **The old fine-grained emotional detail** (the former A1.1–B1.3 sub-cells) lives on as the **angle menu** in `02-personas.md` — a palette to draw from per ad, not a fixed taxonomy.

### ⭐⭐ BEFORE ANY CONCEPT: RUN THE RELATABILITY RESEARCHER *(human rule, 2026-10-03)*

> *"Before you write a concept, put a research layer — who researches jokes, events, relatable events. The content that wins is the content that's relatable at scale."*

**Whenever work starts on a new topic or occasion — image prompts, angles, concepts, organic content — the FIRST step is the Relatability Researcher** (`2-roles/15-relatability-researcher.md`, agent `relatability-researcher`). It delivers a **Recognition Brief** to `3-output/relatability/`: evidence-backed truths the audience already shares, **ranked 1-5 by SCALE OF RECOGNITION.**

- **Ship 4s and 5s.** A 1-scoring truth **cannot be rescued downstream** — craft is added later, reach is not.
- **Two kinds of truth, both mandatory:** **TYPE A** (culturally specific) and **TYPE B** (universal, true here too). **A brief must contain at least two Type B findings** — a truth shared by a billion people is not weaker than one shared by twenty million, it is usually stronger.
- **⭐ The formula:** **a TYPE B truth in a TYPE A room.** Reach from the truth, ownability from the picture.
- **The Reference Recreator's Ship Gate requires a `Recognition:` line** on every prompt, naming the finding and its score.

**⛔⭐ THE LIVING FRAME TEST comes before everything** *(human rule, 2026-10-03 — §A0 of the rulebook)*: **a person in frame with a visible face · something happening NOW · two people, one acting on the other · someone coming off slightly badly.** **Reverence is the enemy of the laugh**, and in the strongest reference work the brand's own customer is the butt of the joke. **The product may be a mess** — spilling, half-eaten, fought over; pristine reads as catalogue. **`Product: none` is allowed; "no people" is a DECLARED EXCEPTION**, and at least half a batch must carry a human doing something. *(Added after five rule-compliant, lifeless batches: every realism rule here is a BAN, and a ban is perfectly satisfied by putting nobody in the frame. That loophole is now closed.)*

**⛔⭐ THE TWO-PASS RULE** *(human rule, 2026-10-05 — §A0b)*: **the type is COMPOSITED on top, never rendered into the photo.** It carries **no grain, haze, colour cast, scene light, blur or wetness**; edges mathematically crisp, fill flat. The photo keeps all its grain and atmosphere; **the type keeps none of it.** **The two layers must look like they were made on different days by different people.** *Why: viewers can now tell human from AI, and **the tell is the INTEGRATION, not the face** — AI renders type and photo in one pass into one tonal world. VW's headline is flat and grainless over a grainy photo; Uber's line sits over rain and is not wet; the one AI-labelled reference does the opposite.*

**⛔⭐ CONCEPT BUCKETS COME BEFORE EXECUTION BUCKETS** *(human rule, 2026-10-04)*: `_CONCEPT-TABLE.md` names **K1-K9, how the 38 references THINK** — and **K0, the reverent tableau** (product beautifully lit, nobody present, respectful caption), which is what five lifeless batches ran on and **appears zero times in 38 references.** **The thread through the strongest work: not one shows the product being used correctly by a happy person.** Coca-Cola wastes it, Domino's hides it in sunglasses, VW shows the wrong product, McDonald's builds the logo from flight paths. **The concept IS the detour.**

**⛔ IDEAS AND EXECUTION COME FROM DIFFERENT PLACES** *(human rule, 2026-10-03)*: the **Recognition Brief** decides **WHAT the ad is about**; the **Execution Table** (`1-foundation/references/swipe-file/_EXECUTION-TABLE.md`) decides **HOW it is built** (visual × composition × text × light × copy shape). **⛔ Never mine the swipe images for ideas — they are borrowed execution for our idea.** And the copy lesson from all 38: **every winning headline is plain spoken speech, not one is clever — clarity over clever, always.**

**Why this exists:** on 2026-10-03 five Teachers' Day frames shipped; four were ideas *reasoned* into existence and one was a *shared truth*. **The human picked the shared truth.** Craft was never the bottleneck.

---

### Four ways to start an ad (entry points)

1. **Persona-led** — a relationship situation names the message (sharp).
2. **Broad-brand** — one broad message per line: *Gifting = Kapruka · Ecommerce = Kapruka · Corporate Gifts = Kapruka*. Names no single persona.
3. **Occasion / seasonal-led** — the calendar moment is the hook (`03-occasion-calendar.md`); activates many personas at once.
4. **Competitor / research-library** — proven angles mined from other e-commerce ad libraries.

### Occasion-aware generation

Idea generation is **proactive about the calendar.** Generation runs a **month at a time**, so when generating, read `1-foundation/03-occasion-calendar.md`, pull every occasion landing inside the window **+ its lead time** (gifting ads must run *before* the date so delivery lands on time), and seed occasion-led ideas for the personas each occasion activates — alongside the evergreen persona ideas. Late June generation builds for *mid-July onward*, not June.

### Who generates, who picks (divergent → enrich → ONE human pick)

The generation half of the pipeline runs **autonomously** — there is **no mid-pipeline human gate.** Agents generate a wide range of ideas *and* enrich each one into a ready-to-judge row (angle + hook + format-in-words), then assemble everything into the **Build Sheet** (3 tables). The human's **only** intervention is the final pick from that sheet — at which point breadth becomes depth:

1. **Researcher** (`03-researcher.md`) refreshes proven evidence, mapped by line/persona.
2. **Ideator** (`03a-ideator.md`) produces the wide pool of one-line candidate seeds (occasion + non-occasion, all 3 lines, all 4 entry points). Goes **wide**; does not rank.
3. **Enrichment pass (one-per-row, lightweight)** — for every seed: the **Strategist** names the sharp *angle* (+ the proof/cue to lean on), the **Copywriter** writes the *hook*, and the **Art Director** names the *format* in plain words (e.g. flat-lay hero · split before/after · text-led · lifestyle). One angle, one hook, one format per row — breadth now, depth later.
4. **Assembler** (`10-assembler.md`) collates every enriched row into the **Build Sheet** — three tables: **Occasion-based · Non-occasion-based · Broad-brand** (line-level, no persona).
5. **⭐ ONE HUMAN PICK GATE** — the human picks the rows to produce from the finished sheet. This is the *only* human step in the generation half.
6. **Post-pick — depth on winners only.** Picked rows go to the full pipeline: the **Creative Director** expands each row into its concept set → **Copywriter** polishes → a human **Designer** builds → **Live**. (The Strategist deepens the brief here only if the angle needs more than the one-line enrichment.)

> **No Pinterest pins, no AI image generation (retired 2026-06-28).** Earlier the enrichment pass pulled verified Pinterest reference pins and the pipeline could auto-generate draft creatives. Both are **retired.** The Format column is now a **plain-words** visual direction; a human designer sources their own references and builds the creative. The dormant method docs (`1-foundation/references/pinterest-curation.md`) and tools remain on disk for reference only.

> **SCALE vs EXPLORE — it's an output, not an input.** At the start there is nothing to scale, so *everything is EXPLORE by definition.* SCALE is an **earned status**: a persona/angle only becomes SCALE *after* its pack proves out on incremental results. That verdict is assigned at the back of the loop by the **Analyzer**, then feeds the *next* Tuesday — at which point the proven winner gets heavier budget and the full-rigor pipeline. The human names which personas to work on each week; the human does **not** pre-tag them SCALE. The Analyzer promotes winners to SCALE; until then, treat every persona as EXPLORE.

---

## THE PIPELINE (flow)

```
                    ┌─────────────────────────────────────┐
                    │  HUMAN: names monthly priority lines/ │
                    │  personas (SCALE earned from results, │
                    │   not assigned here — see cadence)    │
                    └──────────────────┬────────────────────┘
                                       ▼
  ╔════════════════════ AUTONOMOUS GENERATION (all agents, no human) ════════════════════╗
  ║                                                                                       ║
  ║                          RESEARCHER — proven evidence, mapped (Opus)                  ║
  ║                          03-researcher.md                                             ║
  ║                                     │  competitor winners → persona/line              ║
  ║                                     ▼                                                  ║
  ║ 01-business-context.md ──┐                                                            ║
  ║ 02-personas.md ──────────┤  (emotion: what to say)                                    ║
  ║ 03-occasion-calendar.md ─┼──►  IDEATOR — wide pool of one-line seeds (Opus)           ║
  ║ Researcher output ───────┤     03a-ideator.md  (occasion + non-occasion,              ║
  ║ Memory + Analyzer verdict┘     │                all 3 lines, all 4 entry points)      ║
  ║                                     ▼                                                  ║
  ║                          ENRICHMENT PASS — one angle/hook/format per seed             ║
  ║                          Strategist → angle (+proof/cue)                              ║
  ║                          Copywriter → hook                                            ║
  ║                          Art Director → format (in plain words — no pins, no gen)     ║
  ║                                     ▼                                                  ║
  ║                          ASSEMBLER — the BUILD SHEET (Opus)                           ║
  ║                          10-assembler.md  →  3 tables:                                ║
  ║                          Occasion-based · Non-occasion-based · Broad-brand            ║
  ║                                                                                       ║
  ╚═══════════════════════════════════════╤═══════════════════════════════════════════════╝
                                       ▼
                            ┌──────────────────────────────────┐
                            │  ⭐ ONE HUMAN PICK GATE           │
                            │  human picks rows from the         │
                            │  Build Sheet — the ONLY human      │
                            │  step in the generation half       │
                            └──────────┬───────────────────────┘
                                       ▼  (depth on winners only)
                              CREATIVE DIRECTOR — expands picked row → concepts
                              03b-creative-director.md
                                       │  (brief/insight concern → back to Strategist)
                                       ▼
                              COPYWRITER (voice polish)
                              04-copywriter.md
                                       │  (angle/concept concern → back to Creative Director)
                                       ▼
                              HUMAN DESIGNER (builds in frame from angle+hook+format)
                              [no AI generation — designer sources own refs]
                                       │
                                       ▼
                              EVALUATOR (fidelity + quality)
                              [20-point checklist]
                                 │              │
                  fidelity miss ─┘              └─ quality/strategy miss
                  → back to Designer               → CD (concept) or Strategist (insight)
                                       │
                                  (all pass)
                                       ▼
                              LIVE — packs by line × persona
                              7-day 1× CPA minimum
                              incremental attribution
                                       │
                                       ▼
                              ANALYZER (kill/scale by incr. ROAS)
                                       │
                                       ▼
                              MEMORY LOG (facts only)  ──┐
                                                          │ feeds next
                                                          ▼ month's run
                                              (back to RESEARCHER / IDEATOR)
```

---

## ROLES & FILES

| Role | File | Model | Reads | Writes |
|---|---|---|---|---|
| **Business context** | `1-foundation/01-business-context.md` | — | (source of truth) | — |
| **Personas (emotion layer)** | `1-foundation/02-personas.md` | — | (source of truth) | — |
| **Fears/objections** | `1-foundation/02b-fears-objections.md` | — | (source of truth) | — |
| **Why people buy (buying psychology)** | `1-foundation/02d-why-people-buy.md` | — | (source of truth) — the buying-driver lens | — |
| **Desire Engine (angle source)** | `1-foundation/02e-desire-engine.md` | — | (source of truth) — 25×5 Desires/Pains/Fears/Misconceptions/Beliefs + iPod-ladder method | — |
| **Occasion calendar** | `1-foundation/03-occasion-calendar.md` | — | (source of truth) | — |
| **Brand guidelines** | `1-foundation/00-brand-guidelines.docx` | — | (source of truth) | — |
| **Researcher** | `2-roles/03-researcher.md` | **Opus 4.8** | context, personas, fears, guidelines, ad library | proven concepts mapped by line/persona |
| **Ideator** *(idea bank)* | `2-roles/03a-ideator.md` | **Opus 4.8** | research, context, personas, fears, **occasion calendar**, memory+analyzer | wide pool of one-line candidate seeds (occasion + non-occasion, all 3 lines, all 4 entry points), unranked |
| **Strategist** *(enrichment: angle)* | `2-roles/03-strategist.md` | **Opus 4.8** | the seeds, research, context, personas, fears, guidelines, memory+analyzer | one sharp **angle** (+ proof/cue) per seed for the Build Sheet; deepens to a full brief only *after* the pick |
| **Copywriter** *(enrichment: hook)* | `2-roles/04-copywriter.md` | **Sonnet 4.6** | the seed + angle | the **hook** per row for the Build Sheet; full in-frame copy + copy-fit mock *after* the pick |
| **Art Director** *(enrichment: format)* | `2-roles/04b-art-director.md` | **Opus 4.8** | the seed + angle, brand guidelines | the **format in plain words** per row (e.g. flat-lay hero · text-led · lifestyle). *No pins, no image generation (retired).* |
| **Assembler** *(build sheet)* | `2-roles/10-assembler.md` *(to build)* | **Opus 4.8** | every enriched row | the **Build Sheet** — 3 tables (Occasion · Non-occasion · Broad-brand) the human picks from |
| **⭐ HUMAN PICK GATE** | — | human | the Build Sheet | the rows to produce (the *only* human step in generation) |
| **Creative Director** *(concepts — post-pick)* | `2-roles/03b-creative-director.md` | **Opus 4.8** | each **picked row**, context, personas, fears, guidelines, research, memory+analyzer, own experience | expands each picked row into its **concept set** + self-critique & ranking |
| **Designer** *(human)* | `2-roles/05-designer.md` *(to build)* | **human** | the picked row's angle + hook + format-in-words, guidelines | finished static creatives (built by hand — no AI generation) |
| **Evaluator** | `2-roles/06-evaluator.md` | **Opus 4.8** | finished creatives + brief + checklist | pass/fail + correction routing |
| **Analyzer** | `2-roles/07-analyzer.md` *(to build)* | **Opus 4.8** | live performance (incremental attr.) | kill/scale verdict (by **persona**) |
| **Memory** | `2-roles/08-memory.md` *(to build)* | **Haiku 4.5** | analyzer verdicts | factual log of angles tested |
| **Content (Kelly)** | `2-roles/09-content-strategist-kelly.md` | **Opus 4.8** | context, personas, fears, guidelines, NeilPatel + Day Trading Attention methods, content memory | weekly organic content batch |
| **Image Researcher** *(inspiration reader, human-fed)* | `2-roles/11-image-researcher.md` | **Opus 4.8** | **the images the human drops in `swipe-file/inbox/`**, context, personas, occasion calendar, guidelines, the existing swipe index | the **swipe file** — the human's supplied images, each mapped to line/persona/occasion + **the angle it suggests**; feeds the Researcher/Ideator/Strategist **and Kelly (organic)** — a first-class `Swipe` idea source for both tracks. **Daily at 4pm** (drains the inbox). No scouting; no image generation; no Build-Sheet pins. |
| **Reference Recreator** *(standalone, on-demand)* | `2-roles/12-reference-recreator.md` | **Opus 4.8** | **reference images the human points to**, brand guidelines, business context, **+ the remix pool: past prompt batches · swipe file · style board · taste digest (CP-2)**, **+ the rebuilt rulebook `_image-gen-rules.md` (2026-10-03)** | one **ultra-detailed, self-contained AI image-generation prompt per reference image**, recreating the reference's exact construction (composition/palette/type/props) swapped to Kapruka's colors, product categories, and copy. Runs only when explicitly asked. **Does NOT feed the Build Sheet, does not touch Source/Angle/Hook/Format, is never picked at the human pick gate.** The one deliberate exception to the 2026-06-28 no-AI-image-generation decision — scoped separately so it can't leak into the monthly pipeline. |
| **⭐ Relatability Researcher** *(upstream research layer, on-demand)* | `2-roles/15-relatability-researcher.md` | **Opus 4.8** | business context, personas, fears, why-people-buy, desire engine, occasion calendar, **+ real social listening (Reddit/FB groups/YouTube comments/forums)**, past Recognition Briefs | the **Recognition Brief** — 5 evidence-backed truths the audience already shares, **ranked by SCALE of recognition (1-5)**, each with its evidence, the picture it suggests and its mechanism fit. **Runs BEFORE any concept is written.** Feeds the Reference Recreator, Ideator, Comedian Angle Generator and Kelly. **The only role accountable for reach-of-insight** — craft is added downstream, scale cannot be. |
| **Comedian Angle Generator** *(standalone, on-demand)* | `2-roles/14-comedian-angle-generator.md` | **Opus 4.8** | business context, personas, fears/objections, why-people-buy, desire engine, occasion calendar | **angle + hook pairs written in the distilled comedic voice** (structure/pacing/POV, never likeness) **of Nate Bargatze, Kevin Hart, Shane Gillis, George Carlin** — text only, aimed at viral/shareability upside. Feeds the Ideator's seed pool as a new `Comedian` entry-point, or Kelly's organic bank. **Never writes image-generation prompts, never depicts the named comedians, never implies their endorsement** — that boundary is absolute, not a per-batch judgment call. Runs only when explicitly asked; not part of the Build Sheet pipeline, not picked at the human pick gate. |

> **Note — six tracks.** (1) The main roles (Researcher → … → Evaluator → Analyzer) are the **paid Meta ad** pipeline, delivering the monthly Build Sheet PDF by the 10th. (2) **Kelly** is a standalone **organic-content** track sharing the same foundation docs; she flags standout organic ideas to the Strategist as candidate paid angles. (3) The **Image Researcher** is a standalone **upstream inspiration reader** — **daily at 4pm** it reads **the images the human drops into `swipe-file/inbox/`** and grows a swipe file, each image distilled into an **angle**, that the Researcher/Ideator/Strategist read as an idea source. It **no longer scouts** (human-fed since 2026-07-01). Inspiration in → angles out. (No image generation, no Build-Sheet pins.) (4) The **Reference Recreator** is a standalone, **on-demand** track — given specific reference images, it writes copy-paste-ready AI image-generation prompts that recreate the reference's technique in Kapruka's brand system. It never runs as part of the monthly cycle, never touches the Build Sheet, and is the **only** place in the system that writes AI-image-generation prompts (alongside the Lightweight Track, below) — see `2-roles/12-reference-recreator.md` for why it's kept separate from the no-AI-image-generation ads pipeline. (5) **The Lightweight Track** (`2-roles/13-lightweight-track.md`, added 2026-08-16) is a **general pattern for secondary/smaller clients** (first run: Skrumptious) — 5 roles only (Researcher → Ideator → Copywriter → Reference Recreator → Evaluator), no Strategist/Art Director/Assembler/Creative Director, and **no human pick gate**: every idea goes straight through to one end-of-day document (the Reference Recreator's prompt format, extended to carry Source/Angle/Hook/Format inline). It is the one place besides the Reference Recreator itself where AI-image-generation prompts get written — scoped to secondary clients only, never the main Kapruka Build Sheet cycle. (6) **The Comedian Angle Generator** (`2-roles/14-comedian-angle-generator.md`, added 2026-08-21) is a standalone, **on-demand text-only** track — comedic-structure angle+hook pairs inspired by named comedians' style mechanics, never their likeness or endorsement. Feeds the Ideator/Kelly as a candidate source; never touches images, the Build Sheet, or the human pick gate directly.

*(Numbering note: Researcher (evidence), Ideator (idea bank, `03a`) and Strategist (insight/brief) all sit in the "03" stage cluster — researcher feeds ideator, ideator's bank goes through the human pick gate to the strategist, the strategist's brief feeds the Creative Director (03b, concepts). Rename if you prefer strict sequence.)*

> **Role split (classic agency model):** **Researcher** finds the evidence → **Ideator** generates the *range* (wide pool of seeds) → an **enrichment pass** (Strategist angle · Copywriter hook · Art Director format-in-words) turns each seed into a ready-to-judge row → **Assembler** builds the Build Sheet → **human picks once** → **Creative Director** expands each picked row into *concepts* and ranks them. Generating runs fully autonomous and goes wide; the single human gate sits at the Build Sheet. The independent quality check on finished work is the **Evaluator**, downstream.

---

## THE BUILD SHEET (the end deliverable the human picks from)

The generation half ends in **one artifact**: the Build Sheet, written to `3-output/build-sheet/build-sheet-YYYY-MM.md`. It is **three tables** — the human's only decision surface.

1. **Occasion-based** — rows tied to a calendar moment (per `03-occasion-calendar.md`, inside the window + lead time).
2. **Non-occasion-based** — evergreen persona rows, no calendar hook.
3. **Broad-brand** — line-level rows that name **no persona** (*Gifting = Kapruka · Corporate Gifts = Kapruka · Ecommerce = Kapruka*). **Guaranteed block: 2–3 distinct angles per line, split by geography where it changes the message** — Gifting Int (diaspora moat) vs Local (convenience); Corporate (Local); Ecom (Local). ~10–13 rows, each leaning on the line's universal truth (above all the delivery moat), not a relationship situation.

**Every table uses the same columns:**

| Column | Filled by | Notes |
|---|---|---|
| **Source of idea** | Ideator | which entry point produced it: `brain` (persona-led) · `research` · `competitor` · `broad-brand` |
| **Business line** | Ideator | Gifting (Int/Local) · Corporate (Local) · Ecom (Local) — never mixed |
| **Persona** | Ideator | the relationship situation (blank/`—` for the Broad-brand table) |
| **Angle** | Strategist | one sharp angle line (the insight made concrete) |
| **Hook** | **Copywriter** | the in-frame headline — earns the [Three-Yes Test](#the-three-yes-test-copy-standard--every-line) |
| **Format** | Art Director | the visual direction **in plain words** — e.g. flat-lay hero · split before/after · UGC testimonial · text-led · lifestyle. *No pins, no image links — the designer sources their own references.* |

Six columns, that's it. One angle, one hook, one format per row — the sheet is for **breadth** (pick across many ideas); depth (5 concepts, polish, build) happens only on picked rows. **No fixed quota** on angles/rows per line — go as wide as the ideas warrant, guided by the month's priorities + a rough total.

> **Delivery — PDF to WhatsApp, by the 10th of each month.** The Build Sheet PDF is the **single monthly deliverable.** The Assembler writes the Build Sheet `.md`, exports it to PDF (`tools/md2pdf.sh`), and sends **only the PDF** to the admin WhatsApp (`tools/wa-send.sh "<pdf>" "Build Sheet — <Month>"`) **by the 10th.** The markdown stays local as the source; the human reviews and picks from the PDF on WhatsApp.

---

## OPERATING CADENCE

> **Two rhythms.** *Idea generation* runs **monthly** — a whole month of ideas at once, occasion-aware (read `03-occasion-calendar.md`, build for occasions landing inside the month + lead time). *Launch & testing* runs in **weekly packs** with 7-day windows. So: generate the month up front, then release and read results pack by pack through the month. The weekly beats below are the launch/test rhythm.

- **Month start → by the 10th — Build Sheet PDF (autonomous).** Human names the priority lines/personas to emphasise (early on all EXPLORE; SCALE is earned later from results). Then the generation half runs with **no further human input**: **Researcher** refreshes evidence → **Ideator** generates the wide seed pool → the **enrichment pass** gives every seed one angle (Strategist), one hook (Copywriter), one format-in-words (Art Director) → the **Assembler** collates everything into the **Build Sheet** (3 tables: Occasion · Non-occasion · Broad-brand) and ships the **PDF to WhatsApp by the 10th.**
- **⭐ Pick day — the one human gate.** The human picks the rows to produce from the Build Sheet PDF. This is the *only* human intervention in generation. Unpicked rows stay in the sheet for later promotion.
- **Each week — concepts (post-pick, depth).** The **Creative Director** expands each picked row into its concept set, self-critiques and ranks. A brief/insight problem routes back to the Strategist; the CD owns the concept.
- **Mid-week — Production.** Copywriter polishes → Art Director names the format → a human **Designer** builds the creative by hand → Evaluator checks. *(No AI image generation.)*
- **Upload day — Launch.** Approved creatives go live as new packs (one line × one persona per pack), 7-day 1× CPA ad-set minimum.
- **Analysis day — Read results.** After the 7-day window, the Analyzer reviews via incremental attribution and decides kill/scale. **This is where the SCALE tag is assigned** — a persona/angle that proves out is promoted to SCALE; the rest stay EXPLORE or are killed. The Analyzer writes the verdict to memory.
- **Next cycle — Compound.** The Ideator and Strategist read the updated memory + analyzer verdict and the new priority list. The cycle repeats, building on what won.

---

## CORE RULES (the things that keep this a flywheel, not a hamster wheel)

> ### ⭐ THE CREATIVE STANDARD (project-level — every track, every role, 2026-07-18)
> A quality **bar** every idea is measured against — in the ads pipeline (Ideator · Strategist · Creative Director · Copywriter · Art Director), in **Kelly** (organic), and in the **Reference Recreator** (image prompts). It sits *on top of* the "one clear job" floor (below) and the [Three-Yes Test](#the-three-yes-test-copy-standard--every-line); it complements them, never overrides them.
>
> **Always (no exceptions):**
> - **One-second comprehension** — the idea reads instantly, before any reading. **⭐ Enforced by THE ONE-SECOND TEST (added 2026-07-26), the counterweight to the blank-headline test below:** *(1)* does the idea need **counting, reading or inference**? *(2)* does every meaning-carrying element survive a **~250px feed thumbnail**? *(3)* does the headline **explain the picture**, or must the picture be decoded first? Any "no" means rebuild the device. **The blank-headline test pushes toward cleverness and has no opinion on cleverness that's unreadable — this is what pushes back.** Mechanics: [`_image-gen-rules.md`](1-foundation/references/brand-assets/_image-gen-rules.md) §0a.
> - **Ogilvy headline discipline + minimal, thought-through copy** — the headline earns its place; say less. Copy only when the visual needs it.
> - **⛔ No twist — direct claims only.** *(Human rule, 2026-09-26 — retires "THE TWIST": "the copywriting should be very direct, no word play, clarity over clever.")* Every line, text-led or not, stays plainly direct — say the claim straight, no wordplay, no double meaning, no pun, no deliberately "wrong" word to unpack. Clarity beats clever, always.
> - **Breakthrough / Cannes-grade thinking** — enter the conversation already in the reader's head; aim for the global creative benchmark, not "fine."
> - **⛔ The anti-slop reject gate** — before a concept ships, ask *"is this AI slop / the usual design / the first idea every ordinary art director would reach for?"* If yes, reject and go again.
>
> ### ⭐ THE ESCALATION PASS — HOW to go again (human rule, 2026-10-02)
>
> *"Take a prompt — okay, this is how a logical person will design it. What are the variables I could change to turn it into a creative design, while keeping the same humour and the same idea?"*
>
> **The anti-slop gate above only says reject. This says how to fix it, and it is now MANDATORY on every image prompt, every track.** The failure it catches is not a wrong idea — it is a **correct idea executed the obvious way.** A logical designer and a creative designer start from the *same* brief; they differ only in which variables they were willing to move.
>
> **Every image prompt carries two blocks, in this order:**
> 1. **`Logical version:`** — one sentence naming the staging a competent, ordinary art director would reach for first. **Write it honestly, do not strawman it** — it is usually the version you just drafted.
> 2. **`Wow variable(s) moved:`** — name which variable(s) below you changed, and the one-line result. **The idea, the joke, the product and the claim stay IDENTICAL** — only the execution escalates.
>
> **THE TEN VARIABLES** (move 1–2 hard, never all ten — a frame with ten twists is noise, not wow):
> | # | Variable | The logical default → the escalation |
> |---|---|---|
> | 1 | **Scale** | Product at true size → absurdly large or tiny against its surroundings |
> | 2 | **Viewpoint** | Eye-level three-quarter → directly overhead, from inside, from underneath, through something |
> | 3 | **The moment** | The finished, settled state → one second before or after (mid-fall, mid-pour, just-missed, about to) |
> | 4 | **Who/what holds the frame** | The product is the hero → the *consequence* or the *absence* of the product is the hero |
> | 5 | **Surface / ground** | Table, desk, plain backdrop → a surface that itself means something (the blackboard, the register, the gate, the floor of the thing) |
> | 6 | **Material swap** | The thing rendered as itself → rendered in an honest other material that carries meaning (chalk, ink, thread, paper) |
> | 7 | **Quantity** | One of the thing → exactly one *too many*, or conspicuously one *missing* |
> | 8 | **Repetition / pattern** | A single object placed well → the same object repeated into a rhythm, with one break in it |
> | 9 | **Light as subject** | Light that merely illuminates → light that *is* the device (a shadow that completes the shape, a beam that writes) |
> | 10 | **Juxtaposition** | Product + matching props → product + the one object nobody expects beside it, that belongs anyway |
>
> **Hard limits on the pass — it escalates execution, it never buys wow with a rule:** the swapped variable must keep **one-second comprehension** (an escalation that needs decoding is a reject, not a wow), must keep the **joke or emotional beat exactly as it was**, must keep **copy direct** (Core Rule 15 — wow lives in the *picture*, never in a cleverer line), must keep the **happy/vibrant mood** (Rule 14), must stay **easy to process** (Rule 18 — fewer/bigger/calmer still binds, so escalation usually means *removing* elements, not adding), must keep every **product accurate to its real listing photo**, and must not imply a **capability Kapruka lacks** (Core Rule 9). **Where the escalation collides with any rule, the rule wins and you pick a different variable.**
>
> **The test that it worked:** *could an ordinary art director, given this same brief and this same product, have produced this frame?* If yes, no variable actually moved — go again. **And the inverse test:** is the frame now *weirder but less clear*? Then you bought wow with comprehension, which this project does not trade.
>
> **The strong default (applied with judgment, NOT a mandate):**
> - **⭐ THE BLANK HEADLINE TEST (the enforcement mechanism, added 2026-07-25).** Cover the headline — **does the image still say something?** If what's left is *"here is the product, on a colour,"* it's a **product poster, not a concept**, and the copy is doing 100% of the thinking. A product poster is a fine *choice* for functional/offer work; it is not an acceptable *default* for brand and emotional work. Every image prompt must declare a **`Visual idea:`** (the device) and a **`Blank-headline read:`** — or state plainly that it's a product hero and why. Device menu + mechanics: [`_image-gen-rules.md`](1-foundation/references/brand-assets/_image-gen-rules.md) §0a. **Watch for this trap:** a strong headline twist can quietly *displace* visual thinking — the two are meant to compound, not substitute.
> - **Metaphorical / conceptual over literal** — reach for a visual metaphor for **brand & emotional** work. But **functional / occasion-direct / offer** ads are allowed to be plainly direct (e.g. "Same-day delivery available," a clear CTA) — don't force a metaphor where directness wins. Metaphor is a default, not a law.
>
> *Image-prompt expression of this standard lives in [`1-foundation/references/brand-assets/_image-gen-rules.md`](1-foundation/references/brand-assets/_image-gen-rules.md) §0; the style-board execution is a logged option in `taste-digest.md`.*

1. **Creative is the targeting.** Build for the persona; the message sorts the audience. Don't over-engineer Meta targeting.
2. **One line × one persona per pack.** Never mix business lines (Gifting / Corporate / Ecom) or personas in a pack — it muddies Meta's signal and makes results unreadable. Corporate is its own line and never shares a pack with Gifting.
3. **Judge by incremental attribution, never surface ROAS.** A high reported ROAS can be bottom-feeding on existing customers. Incremental ROAS is the truth.
4. **New ads → new pack, always.** Iterations of a winner launch as a fresh pack with its own 7-day minimum, not stuffed back into the old ad set.
5. **Iterations are real swings.** New format / sub-angle / visual — never a one-word headline change. Meta merges near-duplicates.
6. **Horizontal first, then vertical.** Explore broadly to find winners; then go deep on what works. SCALE is **earned from results, not assigned upfront** — the Analyzer promotes a proven persona/angle to SCALE at the back of the loop, and that verdict steers the next Tuesday's budget. Early on, everything is EXPLORE.
7. **Memory stores evidence, not strategy.** The log records facts (angle, persona, incremental result, verdict). It informs the Strategist; it does NOT rewrite the system's objectives. Changes to *how the system thinks* are human decisions.
8. **Never re-test a dead angle** without an explicit, justified, genuinely-different execution.
9. **Honest claims only.** Every claim backed by something true. Kapruka's trust is the asset — don't spend it on overstatement.
10. **Correction routing:** fidelity miss → Designer · voice miss → Copywriter · concept/quality miss → Creative Director · brief/insight miss → Strategist.
11. **Ground every recommendation and issue in the business context — no exceptions.** Before any agent (interactive or scheduled) flags a recommendation, a problem, a kill/scale verdict, a self-critique, or an idea, it must **re-read `1-foundation/01-business-context.md`** (the three lines, the personas served, and above all the delivery moat) and check the call against it. Every flagged rec/issue must name *which* part of the business context it serves or violates — a recommendation that can't be tied back to the lines, a persona, or the moat is not actionable and should be dropped or reframed. This applies to all roles and both scheduled runs (Kapruka-IdeaBanks, Kapruka Image Researcher). Business context is the yardstick; nothing gets flagged against a vacuum.
12. **⛔ SHOW THE FULL RANGE — the range IS the product.** *(Human rule, 2026-07-25; sharpened 2026-07-26.)* **Read this as a positive requirement to SPAN, never as a list of things to dodge.** *"A world of choices"* is not decoration under the logo — it is the claim the brand makes, and **every multi-product idea either proves it or contradicts it.** Cakes, flowers, chocolates, hampers and combos are the **reflex** categories — the first thing every role reaches for, and the reason a set ends up looking like a florist's window. The real catalogue is far wider: beauty & personal care (cosmetics, skincare, perfume, spa sets, grooming) · fashion (**handbags 300+**, ladies/gents/kids shoes, slippers, eyewear, wallets, belts, umbrellas) · jewellery & watches · electronics (mobile phones, **gaming 230+**, audio, **wearables 320+**, computers, cameras) · home & kitchen appliances (**600+**) · clothing · toys · personalised gifts · car accessories.
    - **No set collapses into cakes-and-flowers** — the classics take **at most about half** of any multi-item set; the rest come from the wider catalogue.
    - **⛔ ANY set or frame showing more than one product must span more than one DEPARTMENT — not just grids.** *(Added 2026-07-26.)* Grids, lifestyle scenes, flat-lays, still lifes, hauls, tabletops — all of them. **A themed single-department set argues depth in one category, the precise opposite of the promise,** and reads as a specialist retailer of that category rather than as Kapruka. **Count departments, not objects:** four car accessories is one department; bouquet + cake + chocolates + macarons is one department. *(Caught live 2026-07-26: a "fun gifting" ad put four automobile accessories in a car interior — no cakes, no flowers, every rule obeyed — and read unmistakably as a car-accessories ad, with "A world of choices" sitting under a frame that showed exactly one.)* **The one exception is a declared category ad** — a deliberate category push to a category-interested audience. Declare it explicitly, and don't let it carry a breadth claim in its copy.
    - **Match the category to the recipient, not to habit.** Gifting **to her** runs far past flowers (cosmetics, perfume, handbags, jewellery, footwear, spa sets). Gifting **to him** is served *badly* by the classics — electronics, phones, gaming, audio, watches, wallets, grooming, car accessories, hobby gifts. **A "girlfriend → boyfriend" set built on cakes and flowers is a failed brief.**
    - **Browse kapruka.com before writing** — the catalogue is consistently bigger than memory suggests. Applies to the Ideator, Strategist, Art Director, Creative Director, Kelly and the Reference Recreator alike. Full category map: [`1-foundation/references/brand-assets/_image-gen-rules.md`](1-foundation/references/brand-assets/_image-gen-rules.md) §2d.
13. **Image-prompt documents paste the STANDING SPEC in full — never abridged.** *(Human rule, 2026-07-25.)* The external image model reads only pasted text + attached images, so a dropped block is a rule that silently doesn't exist for that batch. Tick the block checklist in `_image-gen-rules.md` §11 before shipping any prompt document. If a block seems not to apply, **paste it anyway** — the spec is identical across every document by design.
14. **⛔ GIFTING IS A HAPPY, VIBRANT MOMENT — never sad, gloomy, dull or somber.** *(Human rule, 2026-09-26.)* Kapruka gifting ads depict joy, warmth, celebration, connection — bright and alive, never a mopey/melancholy mood, a grief/loss framing, a guilt-trip, or a washed-out/dim/gloomy visual treatment. This applies to every track (Ideator, Strategist, Creative Director, Copywriter, Art Director, Kelly, the Reference Recreator, image prompts). A sad moment can be the *setup* only if the ad's whole point is Kapruka fixing it fast (e.g. "forgot the date" panic resolved by same-day delivery) — the ad must still land on/end in the happy, vibrant moment, never linger in or centre the gloom. **⚠️ Vibrant is a mood, not a colour-grade licence** (caught live, same day — renders drifted toward oversaturated, glossy, app-onboarding-style lighting once this rule shipped). Happy/vibrant frames still carry Kapruka's premium, editorial colour grade — natural light, true-to-life colour, restrained contrast — never candy-bright or stock-photo-glossy. See `_image-gen-rules.md` §1g for the full guardrail.
15. **⛔ COPY IS DIRECT — no wordplay, no puns, clarity over clever.** *(Human rule, 2026-09-26 — supersedes THE TWIST above.)* Every line — headline, support, CTA, text-led or not — says the claim straight. No double meanings, no puns, no "wrong-on-purpose" verbs to unpack. If a reader has to pause and decode it, rewrite it plainer. This does not relax the [Three-Yes Test](#the-three-yes-test-copy-standard--every-line) or Core Rule 9 — a direct line still has to be visualizable, true, and ownable.
16. **⛔ LIGHT ON TEXT — the image carries the idea, not a paragraph on it.** *(Human rule, 2026-09-26.)* One headline (1-3 short lines) plus at most one short support line. No third text block, no dense caption-style copy baked into the creative. If the idea needs more than a headline + one support line to land, the idea is the problem, not the copy length.
17. **⛔ A PRODUCT IS NOT MANDATORY — don't force one in.** *(Human rule, 2026-09-26.)* Not every image prompt needs a product or a cached product photo. Let the concept decide what's in the frame: some ideas are carried by a **Kapruka brand asset alone** (cake box, flower box, bag, gift packaging, van), some by **people and the moment** with no product, and some genuinely need a **real product** from the cache. Use a cached product only where one naturally belongs; otherwise write `Product: none`. Across a batch, expect a natural mix, not a product in every frame. (When a product *is* in frame, the attach-the-real-photo discipline still applies.) Applies to the Reference Recreator, the ig2img pipeline, Kelly and every image-prompt batch.
18. **⛔ EASY TO PROCESS — the frame must be effortless for the eye.** *(Human rule, 2026-09-29 — caught live on a render that was beautiful but tiring to read.)* Sits on top of the One-Second Test, which only checks whether elements are *individually* legible; this checks whether the eye can **organise** them. Two questions: **(1) Figure/ground — can the eye separate the hero from its background?** The hero must differ from its surroundings on **at least two of: size, value, saturation, shape.** It fails when both share the same visual language *(the live failure: small bright circular products set inside a peacock tail already covered in small bright circular eye-spots — every element legible on its own, the whole frame unreadable as one busy texture)*. If the background is the most saturated/detailed/contrasty thing in frame, the background has become the subject — calm it down. **⛔ The products being sold must never be the quietest elements in their own ad.** **(2) Hierarchy — does the eye know where to go first, and then where?** One clear first stop, then a path; never several elements at equal size and equal emphasis scattered in an arc. State the intended eye path in one sentence — if you can't, the frame has no hierarchy. **The standing fix is FEWER, BIGGER, CALMER:** breadth reads from *variety*, never from *count*, so cutting items makes the idea legible rather than weaker. Full mechanics: [`_image-gen-rules.md`](1-foundation/references/brand-assets/_image-gen-rules.md) §0a questions 4-5.
19. **⛔ AVOID SUBTEXT — nothing under the logo, and no invented text on any object.** *(Human rule, 2026-09-29 — caught live on three renders at once.)* Two halves, both hard bans. **(1) The logo lockup is mark + wordmark ONLY** — no tagline beneath it, no divider rule, no descriptor. *"A world of choices" is a copy block, not free decoration*: the frame already budgets one headline + at most one support line (Rule 16), and a tagline under the logo makes it a fourth. If a concept genuinely wants the tagline in frame, it runs **as the headline or the support line, spending that budget.** *(This existed as a soft default from 2026-08-21 — "unless a concept calls for one" — with no negative-list entry, and was therefore quietly ignored for five weeks. It is now a ban.)* **(2) No invented sub-text printed on any object** — packaging, boxes, bags, labels, tags, signage, vehicle panels, aprons, cups. **Never let the model decide what a surface says.** A surface carries text in exactly two cases: it is the **attached real asset** (whatever is genuinely printed on it is part of the physical product), or the prompt **names the exact string**. Otherwise it stays **blank**. *(Caught live: a redrawn cake box came back carrying "Every Bite, Pure Happiness" on the lid and "A World of Happiness" under the wordmark — neither is a Kapruka line.)* This is **stricter than the material floor's "no garbled sub-text"**: garbled text is obviously broken and gets rejected on sight, while **cleanly-rendered invented brand copy looks legitimate and ships** — a false claim in Kapruka's own voice, failing Core Rule 9. Full mechanics: [`_image-gen-rules.md`](1-foundation/references/brand-assets/_image-gen-rules.md) §7.

---

## KAPRUKA'S AUTHORITY (anchor for nearly every ad)

Reliable, dated, island-wide delivery — **from anywhere in the world to anywhere in Sri Lanka** — backed by **23+ years** and **millions of gifts delivered**. **Same-day within the Colombo region, next-day island-wide.** Top diaspora markets: **Australia · USA · Canada · UAE.** (Confirmed 2026-07-04 — approved for ad use; see `1-foundation/01-business-context.md`.) This is the moat. It directly answers the deepest fear of the highest-value persona (the overseas gifter who can't be there in person). Lean on it.

---

## THE THREE-YES TEST (copy standard — every line)

Every copy line must earn **three yes**. If any answer is no, rewrite it (or flag it if the fix depends on an unconfirmed claim — never fake the yes).

1. **Can I visualize it?** — does the line put a concrete picture in the reader's head? Abstract claims ("great service," "fast delivery") fail; sensory/specific ones ("on her table by morning," "the lane she grew up on") pass.
2. **Can I falsify it — and is it true?** — is the line specific enough to be checked, *and does it check out?* Vague puffery can't be falsified and converts weakly; a falsifiable, true claim ("delivered on the date you choose, 20+ years") builds trust. Honest only — this is Core Rule 9 made concrete.
3. **Can nobody else say this?** — is it ownable to Kapruka? If a competitor could paste their logo on the line, it isn't yours — push it onto the moat or a Kapruka-only truth.

> **Where it bites:** the hero lines (hook, support, proof) must pass **all three**. A purely functional line (a CTA like "Order today") can't be "ownable" — it must at least pass #2 (true), and the *ad as a whole* must pass all three. The **Copywriter** applies this per line; the **Evaluator** independently re-checks it before spend.

---

## OPEN THREADS (not yet resolved)

- **Unit economics / target threshold** — PARKED. The Analyzer's "did it win" threshold and the Strategist's "is this worth spend" gate both depend on a break-even/CPA target (per the tracking model). Resolve before going live.
- **Brand voice definition** — placeholder in `04-copywriter.md`. Needs 3-4 real sentences + do/don't examples.
- **Roles still to build:** Designer (+ craft checklist), Analyzer, Memory structure. *(Evaluator, Researcher, and Ideator are written.)*
- **`[CONFIRM]` flags** throughout `01` and `02` — top revenue categories, corporate gifting, funeral/almsgiving, best overseas markets, approved proof stats.

---

## FILE INDEX

```
CLAUDE.md                              — this file (orchestration), at root

Content Guideline NeilPatel            — Kelly's method source (three jobs, idea-as-unit, pillars, flywheel)
Day-Trading-Attention-Primer-Part4.pdf — Kelly's method source: the 7 platforms as "rooms" (PAC — be native per platform)
Day-Trading-Attention-Primer-Part5A.pdf— Kelly's method source: content format menu (formats 1–18) + engagement ladder
Day-Trading-Attention-Primer-Part5B.pdf— Kelly's method source: content format menu (formats 19–36) + chop-long-form
AI-Static-Ads-in-Minutes-Primer.html   — Strategist/Copywriter/Art Director method source (Dara Denney): levels-of-
                                          awareness thinking, the copy playbook, the 7-format×3-production-level
                                          taxonomy, golden-nugget testimonial mining. NOTE: its Part 5 AI-generation
                                          workflow (Claude → Super Scale → generate statics) is NOT adopted — conflicts
                                          with the 2026-06-28 no-AI-image-generation scope decision; ideas-only import.

1-foundation/                          — source-of-truth inputs (read first)
   00-brand-guidelines.docx            — brand voice/visual rules (locked source of truth)
   00-brand-guidelines.md              — readable extract of the above (so agents can read it)
   01-business-context.md              — what Kapruka is, business lines, the moat
   02-personas.md                      — emotion layer: pain/desire/fear by sender×recipient×occasion
   02b-fears-objections.md             — online-shopping fears by segment (one angle type of several; disarm or use as angles)
   02d-why-people-buy.md               — buying-psychology lens: the core drivers (why anyone buys) the Strategist maps a persona's pain onto
   02e-desire-engine.md                — ANGLE SOURCE: 25 Desires/Pains/Fears/Misconceptions/Beliefs + iPod-ladder method (Nick Theriot desire primer)
   _archive/02c-behavioral-sub-avatars.md — [ARCHIVED 2026-07-05] behavioural sub-avatar layer (BH1–BH10); retired to simplify. Model is now 5 dimensions: persona · fear · objection · desire · why-people-buy
   03-occasion-calendar.md             — occasion layer: 2026 dates + lead time + personas activated (drives occasion-led generation)
   references/                         — the visual taste system
      brand-assets/                    — REAL Kapruka assets (cake box · gift packaging · delivery van) as ATTACHED reference images for image-gen + a first-class idea source across paid ads/Kelly/image prompts/brain. See _brand-assets.md.
         _image-gen-rules.md           — ⭐ PROJECT-LEVEL image-generation rulebook (source of truth): super-real/no-AI-look, pull real products from kapruka.com, attach brand assets, treatment-upfront, palette (#4B2386/#FFD21E on assets · #340A5C/#FFC107 on ground), tagline "A world of choices"
      taste-digest.md                  — distilled visual taste from past winners / ideal refs
      design-rules.md                  — consolidated graphic-design craft rules + prompt checklist
      pinterest-curation.md            — [DORMANT] the old premium-image scan method (retired 2026-07-01 when the Image Researcher went human-fed)
      swipe-file/                      — Image Researcher's living swipe file (daily 4pm; human-fed inspiration → angles)
         inbox/                        — the human drops reference images here; each 4pm run reads them, writes angles, moves them to images/
         _swipe-index.md               — living doc: per-image angle + recreation notes, mapped to line/persona/occasion
         images/                       — the downloaded premium reference images

2-roles/                               — the pipeline agents
   03-researcher.md                    — mines category winners, maps to line/persona; screenshots landing pages (Opus) ✅
   03a-ideator.md                      — IDEA BANK: wide pool of candidate seeds (occasion + non-occasion, all 3 lines, all 4 entry points) (Opus) ✅
   03-strategist.md                    — INSIGHT + BRIEF: 1 brief per human-picked candidate (not finished ads) (Opus) ✅
   03b-creative-director.md            — CONCEPTS: turns each brief into 5 concepts + self-ranks the launch set (Opus) ✅
   04-copywriter.md                    — polishes voice; refiner not originator ✅
   04b-art-director.md                 — ENRICHMENT: names the FORMAT in plain words per row (image-gen prompts PARKED) (Opus) ✅
   05-designer.md                      — [STUB / to build] HUMAN designer builds creatives by hand + craft checklist
   06-evaluator.md                     — fidelity + quality gate, 20-point checklist ✅
   07-analyzer.md                      — [STUB / to build] kill/scale by incremental ROAS (blocked on unit econ)
   08-memory.md                        — [STUB / to build] factual log of tested angles
   09-content-strategist-kelly.md      — Kelly: organic content idea generator (3 jobs, pillars, flywheel) ✅
   09a-content-prompt-plays.md         — Kelly's on-demand toolkit: 4 reusable prompt plays (fresh ideas · reverse-engineer viral · shareability rewrite+score · viral-score+fix) ✅
   10-assembler.md                     — BUILD SHEET: collates enriched rows into the 3 pick-tables; PDF by the 10th (Opus) ✅
   11-image-researcher.md              — INSPIRATION READER (human-fed): daily 4pm, reads images the human drops in swipe-file/inbox/ → distils the ANGLE each suggests → feeds Researcher/Ideator/Strategist + Kelly (Source `Swipe` for both paid & organic) (Opus) ✅ (no scouting, no generation, no Build-Sheet pins)
   12-reference-recreator.md           — STANDALONE / ON-DEMAND (2026-07-15): given specific reference images, writes one ultra-detailed self-contained AI image-gen prompt per image, recreating the reference's construction in Kapruka's colors/categories/copy. NOT part of the monthly cycle, never feeds the Build Sheet. The one deliberate exception to the no-AI-image-generation decision (Opus) ✅
                                         ⚠⚠ RULEBOOK REBUILT 2026-10-03 — `_image-gen-rules.md` was rebuilt from 32 human-supplied award references
                                         ("brand colours and font stay, everything else is revamped — like handing it to a new agency"). KEPT: the 5 brand hexes,
                                         Inter, and the whole honesty/safety/authenticity floor. REBUILT: camera, composition, treatment axes, text system, devices.
                                         Treatments are now V1-V5 × T0-T5 (was A/B1/B2/B3/C × T0-T3). Light, camera height and the moment are DECLARED CHOICES,
                                         not the old mandated soft-side-light/eye-level/candid house style. 5th output invariant: every prompt declares `Mechanism: M1-M13`.
                                         ⭐ Top-level test (§A): if the headline still makes sense without the picture, the ad is redundant — illustration is not advertising.
                                         ⭐ THE 38 REFERENCE IMAGES ARE SAVED: `1-foundation/references/swipe-file/images/1-38.PNG`, mapped to mechanisms in
                                         `swipe-file/_MECHANISM-REFERENCE-INDEX.md`. The Recreator MUST open the reference image for its declared mechanism
                                         before writing the prompt, and compare the render against it afterwards.
                                         ⭐ For batches (M10): declare a `Stem:` — one sentence skeleton, one variable per frame. Old rulebook archived at `_archive/`.
                                         ⭐ CREATIVITY PROTOCOL (human rule, 2026-10-02) — §CP-1/2/3 in the role file:
                                         CP-1 NEW LIBRARY ONLY — ⚠ RETIRED/MOOT 2026-10-03: it parked an OLD library that no longer exists; `Library:` is replaced by `Mechanism:`
                                         CP-2 REMIX INTAKE — read the pool first (past batches · swipe file · style board · taste digest); batch carries `REMIX INTAKE:`, each prompt carries `Remix: A × B`
                                         CP-3 LAYER AUDIT — decompose each frame into element layers (subject/worn/held/held-within-held/surface/environment/light/type/absent), fix Core concept + Reason for being as immovable, mark KEEP/CHANGE/ADD/DELETE, act on 1-2; DELETE before ADD; drift test closes it
   15-relatability-researcher.md      — ⭐ UPSTREAM RESEARCH LAYER (2026-10-03, human rule): runs BEFORE any concept. Finds what the audience ALREADY shares
                                         (jokes, events, relatable moments) across 4 lanes — Shared Memory · Live Event · Universal Friction · Diaspora Split —
                                         and ranks every finding by SCALE OF RECOGNITION 1-5. Ship 4s and 5s only. Six tests, the first being THE NOD TEST
                                         ("yes, exactly" not "that's clever"). Deliverable: the Recognition Brief in `3-output/relatability/`. Role 12 now requires
                                         a `Recognition:` line per prompt. Born from: 4 of 5 Teachers' Day frames were reasoned ideas; the 1 picked was a shared truth ✅
   13-lightweight-track.md             — STANDALONE / GENERAL PATTERN (2026-08-16): 5-role track for secondary/smaller clients (Researcher → Ideator → Copywriter → Reference Recreator → Evaluator), no human pick gate, no Build Sheet. Ideator tags seeds Combo/Direct with angle baked in; Copywriter also names format. Single deliverable = the Reference Recreator's prompt doc, extended with Source/Angle/Hook/Format per entry. First run: Skrumptious ✅
   14-comedian-angle-generator.md      — STANDALONE / ON-DEMAND (2026-08-21): text-only angle+hook pairs in the distilled comedic-structure voice (Bargatze/Hart/Gillis/Carlin) aimed at viral/shareability upside. NEVER depicts the named comedians or implies endorsement — likeness/endorsement boundary is absolute. Feeds the Ideator (`Comedian` entry-point) or Kelly's organic bank; never writes image prompts, never touches the Build Sheet (Opus) ✅

3-output/
   research/                           — Researcher handoff files (research-W##.md), mapped by line/persona
   ideas/                              — Ideator's monthly seed pool (ideas-YYYY-MM.md) + _TEMPLATE-idea-bank.md
   build-sheet/                        — Assembler's Build Sheet (build-sheet-YYYY-MM.md): 3 pick-tables — THE human decision surface
   briefs/                             — Strategist creative briefs ([candidate]-[Week]-brief.md), deepened post-pick
   concepts/                           — Creative Director concept files, built from picked rows
   content/                            — Kelly's weekly organic content batches (content-W##.md) + _memory.md
   reference-recreations/              — Reference Recreator's prompt batches ([batch-name]-[date].md), on-demand only
   relatability/                       — Relatability Researcher's Recognition Briefs (recognition-[topic]-[date].md), on-demand, upstream of concepts
   comedian-angles/                    — Comedian Angle Generator's angle+hook batches (comedian-angles-[date].md), on-demand only, text only
```
