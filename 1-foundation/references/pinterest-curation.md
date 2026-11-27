# Reference Curation — method + the premium bar

> ## SCOPE (updated 2026-06-29) — used by the Image Researcher SCOUT only.
> The **Build Sheet no longer carries a Pinterest-refs column** and the pipeline does **no AI image generation**. But the **Image Researcher** (daily 4pm) DOES use the scan method + premium bar below to scout premium images for **inspiration → angles** (it feeds the Researcher/Ideator/Strategist via the swipe file). So: the **scan method + premium bar are LIVE for the scout**; the "5 refs per Build-Sheet row" framing is **retired** (ignore the per-row / Build-Sheet-column wording). The scout reads this for *how to find and grade premium images*, not to fill a sheet column.

---

> Canonical spec for finding and **visually grading** premium reference creatives. Used by the **Art Director** (enrichment) and enforced by the **Assembler** (gate). The whole point: the references that reach the human and the Designer must look **premium and alive** — never generic, never beginner, never sterile stock.

---

## THE BAR DEPENDS ON THE BUSINESS LINE (read this first)

What "premium" means is **not the same across lines** — match the line:

- **Ecom (Self-Purchase) → premium, restrained DESIGNED social ads.** Target the look of **Amazon · McDonald's · Flipkart · Walmart** brand creative and **Behance / Dribbble** e-commerce ad design: product-on-colour heroes, confident typography, clean designed ad layouts. **Restrained, not loud** — premium brand-campaign craft, never "MEGA SALE!!!" collage clutter. Mix ≈ **80% designed ad creatives + 20% genuine real lifestyle/product photos** (the 20% must look *authentically real* — a true in-use moment, NOT stock, NOT staged, NOT itself ad-looking). On this line **baked-in text is expected and good** when it's premium design — Ecom literally ships designed ads, so designed references are correct. The #1 reject here is *cheap/loud/beginner* ad design and *sterile stock photos*.
- **Gifting & Corporate → premium emotional photography + tasteful design.** Keep the warm, real, gallery-grade photography taste (real scenes, human/hands, solid grounds) plus high-craft designed layouts. Stock-cube sterility is the #1 reject.

When the row's line is Ecom, steer every query and every keep/reject toward the designed-ad bar above.

---

## THE METHOD — see the GRID, then actually LOOK (don't trust the title)

**Preferred: the headless visual grid scout (`tools/img-grid.mjs`).** A real headless browser loads an image-search grid, screenshots the *whole board* with every tile numbered, and writes each tile's source link to `candidates.json`. You **Read the grid screenshot and handpick the strongest tiles by eye** — like an art director scrolling a board, comparing 40 at once — then map your picked numbers back to their URLs in `candidates.json`. This is how good picks happen: you see breadth, then choose.

```
node tools/img-grid.mjs "<query>" <outdir> pinterest 2
   → <outdir>/grid.png         (Read this; pick tiles by their red number)
   → <outdir>/candidates.json  ([{n, thumb, src, page, alt}] — resolve picks → use `page` = real /pin/ URL)
```

**Engine = `pinterest`** for Ecom designed-ad refs (it's where premium brand ads live; Bing returns clipart/stock). Keep **scrolls LOW (2)** — logged-out Pinterest throws a "Log in to see more" wall on deeper scrolls (the tool strips the modal + a low scroll keeps the grid clean). If it prints `FAIL no tiles hydrated`, it's transient throttling — just rerun (don't run several in parallel).

**THE QUERY FORMULA (this is the taste lever — get it right):**
```
QUERY = [SUBJECT from the angle] + [CREATIVE intent] + [QUALITY cue]
   CREATIVE intent → "ad creative" · "advertising" · "campaign" · "poster"   ← pulls REAL premium brand ads
   QUALITY cue     → "premium" · "editorial" · "minimal"
```
- ✅ DO: `car accessories ad creative premium` · `engine oil advertising editorial` · `car detailing poster premium`
- ❌ DON'T use `"social media ad design"` / `"...post design"` — those pull **generic designer-template/mockup pins** ("E-Commerce Made Easy" filler), which read generic and off-taste. (Lesson logged 2026-06-28.)
- ❌ Avoid bare `"car"` / `"auto parts"` alone (→ silhouette clipart) and any `"sale / % off / discount"` (→ loud beginner graphics; violates restraint + no-deals).
- 🔁 For the ~20% real photo, swap the creative intent for `"product photography"` / `"candid photo"`.

Run 1–2 queries per row; handpick across the grids.

**Fallback: pin-by-pin (when the grid scout is unavailable).** The original chain still works — search, then actually look at each candidate:

A pin's title can lie; the image is the truth. So every candidate is **downloaded and visually scanned** before it ships. The full chain (all proven to work with the available tools):

1. **Find candidates** — `WebSearch` scoped to `pinterest.com/pin` (+ country mirrors `in.` `uk.` `au.` `cl.` …). Use specific visual queries (the *look* you want), not just the topic — e.g. `"gift hamper flat lay linen solid background"`, not `"gift hamper"`. List only URLs the search returns.
2. **Get the real image URL** — `curl` the pin page and pull the CDN image URL **directly** (match the `i.pinimg.com` link itself — do NOT key off attribute order, because Pinterest emits the tag as `content="…" … property="og:image"`, i.e. `content` *before* `property`, which breaks naive `og:image…content` greps):
   `curl -s -A "Mozilla/5.0" "<pin-url>" | grep -oE '<meta content="https://i\.pinimg\.com[^"]+"[^>]*og:image' | grep -oE 'https://i\.pinimg\.com[^"]+' | head -1`
   → yields an `https://i.pinimg.com/...jpg` direct file. **Target the `og:image` meta tag specifically** (content sits *before* `property="og:image"` with other attrs between) — a bare `i.pinimg.com` grep can grab a page-chrome **placeholder PNG** instead of the real image. If extraction returns nothing or the placeholder, fall back to the oEmbed thumbnail. (oEmbed `https://www.pinterest.com/oembed.json?url=<pin>` also returns title/dimensions/thumbnail as a cross-check.)
3. **Download it** — `curl -o <file>.jpg "<i.pinimg.com url>"` into scratch.
4. **SCAN it — Read the image and grade it** against the premium bar below. This is the step that separates this system from "paste a link and hope."
5. **Keep or reject.** Only pins that *pass the scan* go on the row. Aim for **5 strong**; **real premium refs beat padding to 5 with junk** — if only 4 clear the bar, ship 4 rather than add a weak one.

> **Liveness caveat (honest):** pins are *real at pull-time* (search-indexed) but can't be re-verified later — Pinterest returns HTTP 200 for dead pins and blocks page fetches. A small number may rot. Acceptable: these are mood/reference images for the Designer, not the ad. Where no pin passes, fall back to a live **board** or **`/ideas/` search link** and mark it `(board)`.

---

## THE PREMIUM BAR — what passes the scan

Grade each downloaded image. **PASS = scroll-stopping and alive** — it would either sit next to Kapruka's ideal references OR stop a thumb in-feed. The line is **quality + vibe, not medium or polish** — collect **both** premium *photography* **and** premium *graphic design*, and across both the energy we want is **fun, exciting, engaging, vibrant, aesthetic, social-media-worthy** — the **iPhone-shot / social-native** look very much counts.

> **THE VIBE (overrides "polished").** Premium ≠ stiff. An aesthetic, well-composed candid can out-rank a glossy-but-lifeless studio shot. The single biggest enemy is **generic, boring, sterile STOCK** — reject that on sight. We are not collecting catalogue photos; we're collecting images that feel *alive* and that a real person would stop scrolling for. When in doubt, ask: "would this stop me in-feed?" — not "is this glossy?"

### ✅ TWO KINDS OF PREMIUM WE COLLECT (cues, not a rigid checklist — go beyond them if something better appears)

**A) Premium photography / product shots**
- **Real photography with vibe — expensive OR aesthetic-candid, never stocky** — a genuine styled shot *or* a social-native moment.
- **Social-native / iPhone-aesthetic shots** — candid, in-the-moment, well-composed phone photography with real colour and energy (the look that actually performs in-feed). An aesthetic candid beats a sterile studio shot.
- **Solid / clean background** *(when it suits)* — single calm ground (white, cream, linen, stone, deep tone), uncluttered — but a rich, lively real-world scene is just as welcome if it's got vibe.
- **Human element** — hands, a person, a moment of use/receiving — warmth and realism.
- **Real setting** — an actual table, doorstep, room, kitchen, shop — lived-in and authentic, not a sterile stock cube.
- **Light, palette, and composition that feel alive** — strong colour, clear focal point, energy; expensive *or* fun, never flat and lifeless.

**B) Premium graphic design / designed layouts** *(collect these too — this is what Kapruka's own ads are)*
- **High-craft designed compositions** — product-on-colour hero layouts, typographic posters, editorial/agency-style ad designs, branded key-visuals where the *design* is the value.
- **Type as deliberate craft** — confident typography, strong hierarchy, intentional grid and spacing. Baked-in text is **fine here** when it's part of premium design (the medium isn't the reject reason — *amateur* execution is).
- **"Guide-style" / multi-product graphics** — knolling, curated grids, considered "X essentials" layouts done with real design polish (not clip-art).
- **Restrained, ownable palette + clean negative space** — looks like a top studio made it, not a beginner in Canva.

> These are **cues to steer toward**, not a gate. A striking premium piece that fits neither bucket cleanly is still a take.

### ❌ Reject on sight — the tell is **generic / boring / sterile stock / careless**, never "it's casual or has text"
- **Sterile stock / corporate-bland** — flat even lighting, posed fake smiles, plastic/glossy 3D, fake staged scenes, obvious cut-outs. **The "stock photo" look is the #1 reject.**
- **Generic / boring / forgettable** — the safe, lifeless shot or layout anyone would grab first. No energy, no idea, no vibe → skip.
- **Beginner / careless** — clip-art, default fonts, clashing colours, misaligned, "made in 5 min," misspellings. *(Careless fails — but an intentional iPhone-aesthetic / social-native candid PASSES. Judge vibe + composition, not polish.)*
- **Blog-pin / SEO-pin templates** — busy marketing collages, "click through", giant watermarks/URLs, multi-panel numbered tutorial graphics.
- **Genuinely bad-blurry / low-res / cluttered** — not the *intentional* grain or candid aesthetic, but actual technical junk; awkward crops.

---

## OUTPUT FORMAT (per row)

List 5 passing pins as the page (pin) URLs, each tagged with a 2–4 word reason it passed, so the human and Designer know *why* it's there:

`https://www.pinterest.com/pin/… (clean linen flat-lay) · https://in.pinterest.com/pin/… (hands receiving, real doorstep) · https://uk.pinterest.com/pin/… (designer multi-product grid)`

Use `(board)` on any fallback collection link.
