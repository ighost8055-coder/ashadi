# Strategist craft — how to think when there is NO reference image

> Read by Ashadi's creative strategist (`tools/ig2img/lib/oneflow.mjs`, `strategist()`) before it writes any no-reference brief.
> Distilled 2026-11-25 from `CLAUDE.md` (Creative Standard, Escalation Pass, Core Rules 12-19), `references/swipe-file/_CONCEPT-TABLE.md`
> and `_EXECUTION-TABLE.md`. Edit this file to change how the strategist thinks; no code change needed.

## The job
One ad, **one clear job**, that a stranger understands in one second and half-recognises themselves in. The IDEA lives in the PICTURE.
The words only finish what the picture started. A catalogue shot with a nice sentence is not an ad.

## The process — do these in order, on paper, before writing the brief
1. **Find the shared truth.** What do people in this audience already know to be true, and would nod at ("yes, exactly")? A small human
   moment, not a brand claim. Best formula: a **universal truth** (true for a billion people) played in a **Sri Lankan room** (the
   picture makes it ours). Reach comes from the truth, ownability from the picture.
2. **Pick the detour (concept bucket).** Direct is why ads read as stock. Choose ONE:
   - **K1 The product fails and that is the ad** — spilled, forgotten, wrongly chosen; the joke is on the customer's *situation* (forgot the date, panic-bought), never on delivery.
   - **K2 Never shown directly** — only its effect: the face of the person receiving, the emptied box, one more plate on the table, the phone lighting up at 6am.
   - **K3 Show the wrong thing** — the gift that is technically right and emotionally absurd.
   - **K4 Brand built from the world** — a route, an arc, a colour field or a shape made of real products (the real logo is placed once, never redrawn).
   - **K5 Same feeling, different uniform** — the same emotional moment moved to a completely different world; the absurdity is in the idea, the craft stays dead serious.
   - **K6 The sentence with a hole** — a word is missing and the picture fills it.
   - **K7 One variable, twice** — the same scene, one thing changed (before/after, with/without).
   - **K9 Say less than you earned** — a humble, true under-claim that hands the credit to the person (the safe, warm form of K1).
   - **K0 The reverent tableau** — product beautifully lit, nobody present, respectful caption. **REJECT. This is the default failure.** Test: if the frame could be captioned "we honour X" and still work, it is K0.
3. **Build the picture device — and pass the SUBJECT TEST.** What is actually happening in the frame? Cover ALL the text: (a) does the image still say something, and
   (b) **can a stranger still tell WHAT IS BEING ADVERTISED?** The picture must hold a recognisable **anchor of the subject**: the real product if one is attached; for a
   service or feature (updates, tracking, checkout, delivery) the object people associate with it — e.g. for WhatsApp updates a phone showing a WhatsApp-style chat (white and
   green rounded bubbles, tiny tick marks, pale chat wallpaper, drawn as lines — no legible letters); for an occasion, its unmistakable symbols. A frame that would suit ANY brand
   or message (a person smiling at a phone, a gift on a table) fails: it is about nothing in particular. If what is left is "here is the product, on a colour", it is a poster, not an idea.
4. **Escalation pass.** Write the *logical version* (what an ordinary art director would do first, honestly). Then move ONE or TWO of these
   variables hard and keep the idea, the joke and the product identical: **scale** (absurdly big/small) · **viewpoint** (overhead, from
   inside, through something) · **the moment** (one second before/after) · **who holds the frame** (the consequence or the absence is the hero) ·
   **surface** (a surface that itself means something) · **material swap** · **quantity** (one too many / one missing) · **repetition with one
   break** · **light as the subject** (a shadow that completes the shape) · **juxtaposition** (the one unexpected object that belongs).
   Never all ten. If the result is weirder but less clear, you traded comprehension for wow — undo it.
5. **Make it alive.** Strong frames have a visible face mid-expression, contact and consequence (something is happening NOW), someone slightly
   ridiculous (the customer can be the butt of the joke, warmly), and the product allowed to be a mess. Test: *could this have been taken one second
   earlier or later and be the same picture?* If yes, nothing is happening. `Product: none` is allowed when a person and a moment carry the idea.
6. **Write the words last.** Plain spoken, direct, no wordplay, no puns, no clever double meanings. The line must not repeat what the picture shows.

## Hard checks — if any fails, drop the concept and use the next one
- **Subject test (FIRST — any fail drops the concept, score at most 3):** with every word covered, a stranger can name what is advertised. The subject (product / service / feature / occasion) is visibly in the frame through a recognisable anchor. Concepts that hide it (K2 "never shown directly", K3 "the wrong thing") are allowed ONLY if the anchor is still plainly there (e.g. the person's face lit by the green chat glow of the phone, phone in frame). For a feature or service ad, prefer concepts where its interface or object is the hero or co-hero.
- **One-second test:** needs no counting, reading or decoding; every meaning-carrying element survives a ~250px thumbnail.
- **Blank-headline test:** with the headline covered, the picture still says something.
- **Easy to process:** ONE hero that differs from its background on at least two of size, value, saturation, shape; one clear eye path. Fewer, bigger, calmer. The product being sold is never the quietest thing in the frame.
- **Anti-slop gate:** "is this the first idea every ordinary art director would reach for?" If yes, go again.
- **Happy and vibrant, never gloomy.** A sad setup is allowed only if the ad lands on the happy fix. Vibrant is a mood, not a colour-grade licence: natural light, true colour, restrained contrast — never candy-bright or glossy stock.
- **Honest:** no invented prices, offers, delivery promises, awards or numbers. Never imply a capability Kapruka lacks.
- **Range:** any frame with more than one product spans more than one department (cakes and flowers at most about half); match the category to the recipient, not to habit (gifts for him are not cakes and flowers).
- **No subtext:** nothing under the logo; no invented words printed on any object; surfaces stay blank unless the exact text is given.
- **Copy is light:** one headline (two short lines) plus at most one short supporting line. No third text block.

## Layouts (choose the one that carries THIS idea)
- **purple-hero** — Kapruka purple field, white headline, one yellow accent word. Best for object-led, cut-out ideas (K2, K3, K7) where the subject can float on colour. Do not default to it.
- **light-split** — cream field, purple type. Best for calm, warm, daylight ideas.
- **full-bleed** — the picture IS the whole poster (a place, a moment, people, a table, a street) and the type sits on a calm band at the top. Best for K1, K5 and any idea with a person or an environment. All the type (logo, headline, supporting line) sits together in the top ~40%: keep that band quiet (soft, even, low detail) and put the whole story in the lower 60%; decide `text_tone` = "light" (white type on a darker picture) or "dark" (purple type on a lighter picture).

## Writing scene_prompt (the picture, for the image model — never any text in it)
Write 150-230 words of one connected description, in this order: **viewpoint and scale** → **who is in the frame and what they are doing right now**
(visible face, honest expression; not posed) → **the SUBJECT ANCHOR (the product, or the interface/object that makes the subject recognisable with no text), how it is used, what state it is in** → **surface and the few props that
mean something** → **the light as a choice** (direction, softness, time of day, colour) → **colour story** (brand: Retail Purple #340A5C, yellow #FFC107,
cream #F5F4EB, white; the rest natural) → **what is deliberately left empty** for the type → **what to avoid**. Be specific enough that two artists would
draw the same picture. Never write the headline or any lettering into the scene.

**Weak (K0):** "Eye-level studio photograph on a flat purple backdrop; centred, a purple bag with the products beside it." — a catalogue shot; the words do all the work.
**Strong (K2 — the effect on a person, full-bleed, light type):** "Close, slightly low viewpoint at an open front door in warm late-afternoon light. An older woman
with one hand pressed to her mouth, eyes bright, caught mid-laugh as she looks down just past the camera; a child's small hand reaches in from the right edge toward the gift
box in the lower right of the frame, its lid half-open so the real cake from the attached sheet shows, drawn exactly as it is. Worn terracotta doorstep, a few green leaves, nothing
else. Natural window-side light, true colour, gentle contrast. The top 40% is a calm, softly out-of-focus wall, kept empty for the type; the story sits in the lower 60%." (An illustration of the depth and
order to write in — not an idea to copy. When a real product is attached it MUST appear, accurately, even if small or partly in frame.)
