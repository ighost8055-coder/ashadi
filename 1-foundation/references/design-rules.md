# Design Rules — Visual Craft Reference

> **What this is.** A consolidated, deduplicated set of graphic-design rules extracted from six design-education videos (listed below), reorganized for the Kapruka ad pipeline and translated into directives the **Art Director / image-prompt generator** must follow on every prompt. The rules below sit *on top of* `00-brand-guidelines.md` and `taste-digest.md` — they govern craft (composition, hierarchy, type, colour, restraint); the brand docs govern the Kapruka-specific system (palette, logo, voice). Where they ever conflict, brand guidelines win.
>
> **Sources (6 videos):**
> 1. *I Wish I Knew These Graphic Design Rules SOONER!!* — purpose, consistency, audience, responsiveness
> 2. *Graphic Design GOLDEN RULES (2025 Edition)* — research, distinct style, memory hooks, narrative
> 3. *6 Golden Rules Of Layout Design You MUST OBEY* — negative space, proximity, repetition, contrast, alignment, focal points
> 4. *20 Rules For GOOD Graphic Design* (Timothy Samara, *Design Elements*) — the canonical 20
> 5. *6 Rules EVERY Pro Designer Knows* — workflow/business + know-your-audience
> 6. *5 Laws of Design Layout & Composition* — grid systems, hierarchy & proximity, layering, colour harmony, focal points

---

## HOW TO READ THIS

Every rule below is stated as a **directive** (do this), with a one-line **why**, and — for the rules that show up visually — a **good vs. bad** example. The final section, **THE PROMPT-GENERATOR CHECKLIST**, is the operational distillation: the lines the image-prompt generator runs through before every prompt leaves the door.

---

# PART 1 — THE RULES

## A. Intent before pixels (decide *why* before *how*)

**A1. Have a concept. Communicate, don't decorate.**
Every creative carries one message. Form must serve that message; an element that doesn't strengthen the one idea is clutter, and clutter junks up communication. *(Videos 3, 4)*

**A2. Design for the audience as if you knew them personally.**
The persona in the creative is who you're talking to — age, status, fear, desire. A creative that doesn't resonate with *that* person has failed, no matter how pretty. (Kapruka: the concept already names the persona; honour it visually.) *(Videos 1, 4, 5)*

**A3. Be decisive — every element on purpose.** "Do it on purpose or not at all." No accidental placement, no filler graphic, no colour grabbed from thin air. *(Video 4)*

**A4. Be universal / legible to a stranger.** If someone with no context can't grasp the message at a glance, rework it. *(Video 4)*

---

## B. Layout & composition (the heart of it)

**B1. Negative space is a design element — create space, don't fill it. Less is more.**
Empty space separates sections, creates focus, and reads as *premium*. The rookie move is scaling everything up to fill the frame; the pro move is restraint. This is the single rule most aligned with Kapruka's minimal-first brand.

<svg viewBox="0 0 640 230" xmlns="http://www.w3.org/2000/svg" width="100%" style="border:1px solid #ddd;border-radius:6px">
  <!-- BAD -->
  <rect x="10" y="10" width="300" height="210" fill="#340A5C"/>
  <text x="160" y="30" fill="#FFC107" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle">✗ CRAMMED</text>
  <rect x="22" y="40" width="276" height="44" fill="#fff" opacity="0.9"/>
  <rect x="22" y="90" width="276" height="40" fill="#FFC107"/>
  <rect x="22" y="136" width="276" height="34" fill="#fff" opacity="0.7"/>
  <rect x="22" y="176" width="130" height="34" fill="#fff" opacity="0.5"/>
  <rect x="168" y="176" width="130" height="34" fill="#FFC107" opacity="0.8"/>
  <!-- GOOD -->
  <rect x="330" y="10" width="300" height="210" fill="#340A5C"/>
  <text x="480" y="30" fill="#FFC107" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle">✓ ROOM TO BREATHE</text>
  <rect x="360" y="80" width="200" height="34" fill="#fff" opacity="0.95"/>
  <rect x="360" y="122" width="120" height="16" fill="#fff" opacity="0.6"/>
  <rect x="360" y="170" width="92" height="26" rx="13" fill="#FFC107"/>
</svg>

*Left: every element fights for space; the eye has nowhere to rest. Right: one idea, generous margins, a single CTA — calmer and more premium. (Videos 3, 4)*

**B2. Use a grid; align everything.**
Modular grids (rows × columns with consistent gutters) give a professional structure; elements snap to it. Ragged, un-aligned edges are the clearest "amateur" tell. You may deliberately break alignment for *one* element to make it pop — but only against an otherwise disciplined grid.

<svg viewBox="0 0 640 230" xmlns="http://www.w3.org/2000/svg" width="100%" style="border:1px solid #ddd;border-radius:6px">
  <rect x="10" y="10" width="300" height="210" fill="#F5F4EB"/>
  <text x="160" y="30" fill="#340A5C" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle">✗ RAGGED</text>
  <rect x="34" y="46" width="180" height="20" fill="#340A5C"/>
  <rect x="70" y="84" width="210" height="12" fill="#9b86c4"/>
  <rect x="48" y="110" width="150" height="12" fill="#9b86c4"/>
  <rect x="90" y="150" width="120" height="26" rx="13" fill="#FFC107"/>
  <!-- GOOD with guide lines -->
  <rect x="330" y="10" width="300" height="210" fill="#F5F4EB"/>
  <text x="480" y="30" fill="#340A5C" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle">✓ ALIGNED TO A GRID</text>
  <line x1="360" y1="40" x2="360" y2="205" stroke="#FFC107" stroke-dasharray="3 3" stroke-width="1"/>
  <rect x="360" y="50" width="200" height="22" fill="#340A5C"/>
  <rect x="360" y="84" width="240" height="12" fill="#9b86c4"/>
  <rect x="360" y="104" width="180" height="12" fill="#9b86c4"/>
  <rect x="360" y="150" width="120" height="26" rx="13" fill="#FFC107"/>
</svg>

*A shared left edge (the dashed guide) instantly organizes the right panel. (Videos 3, 6)*

**B3. Proximity — group what's related, separate what isn't.**
Elements that belong together sit together; unrelated elements get their own space. Proximity is how the viewer *reads* the layout in the right order.

<svg viewBox="0 0 640 230" xmlns="http://www.w3.org/2000/svg" width="100%" style="border:1px solid #ddd;border-radius:6px">
  <rect x="10" y="10" width="300" height="210" fill="#340A5C"/>
  <text x="160" y="30" fill="#FFC107" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle">✗ EVENLY SCATTERED</text>
  <rect x="40" y="48" width="120" height="14" fill="#fff" opacity="0.9"/>
  <rect x="170" y="84" width="100" height="12" fill="#fff" opacity="0.6"/>
  <rect x="40" y="120" width="140" height="14" fill="#fff" opacity="0.9"/>
  <rect x="160" y="160" width="110" height="12" fill="#fff" opacity="0.6"/>
  <rect x="330" y="10" width="300" height="210" fill="#340A5C"/>
  <text x="480" y="30" fill="#FFC107" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle">✓ GROUPED</text>
  <rect x="360" y="50" width="150" height="16" fill="#fff" opacity="0.95"/>
  <rect x="360" y="70" width="110" height="11" fill="#fff" opacity="0.6"/>
  <rect x="360" y="150" width="150" height="16" fill="#fff" opacity="0.95"/>
  <rect x="360" y="170" width="120" height="11" fill="#fff" opacity="0.6"/>
</svg>

*Right: headline + its supporting line are locked up together; the two groups are clearly distinct. (Videos 3, 6)*

**B4. Build a hierarchy — give the "one-two punch."**
Focus attention on ONE thing first (a big shape, a striking image, a bold headline), then lead the eye to the second, then the rest, in a logical order. Without a dominant element the eye doesn't know where to start.

<svg viewBox="0 0 640 230" xmlns="http://www.w3.org/2000/svg" width="100%" style="border:1px solid #ddd;border-radius:6px">
  <rect x="10" y="10" width="300" height="210" fill="#F5F4EB"/>
  <text x="160" y="28" fill="#340A5C" font-family="Arial" font-size="12" font-weight="bold" text-anchor="middle">✗ FLAT — ALL EQUAL</text>
  <text x="30" y="80" fill="#340A5C" font-family="Arial" font-size="20">Same size</text>
  <text x="30" y="120" fill="#340A5C" font-family="Arial" font-size="20">Same size</text>
  <text x="30" y="160" fill="#340A5C" font-family="Arial" font-size="20">Same size</text>
  <rect x="330" y="10" width="300" height="210" fill="#F5F4EB"/>
  <text x="480" y="28" fill="#340A5C" font-family="Arial" font-size="12" font-weight="bold" text-anchor="middle">✓ CLEAR HIERARCHY</text>
  <text x="350" y="92" fill="#340A5C" font-family="Arial" font-size="34" font-weight="bold">Big idea.</text>
  <text x="350" y="128" fill="#340A5C" font-family="Arial" font-size="17">Then the support.</text>
  <text x="350" y="158" fill="#7a6aa0" font-family="Arial" font-size="12">then the small print</text>
</svg>

*One dominant line earns the first look; size = order of reading. (Videos 3, 4, 6)*

**B5. Create a focal point.**
A single area of dominance that captures attention and starts the viewer's journey — usually made by contrast (colour, size, isolation) and often *pointing* toward the headline. It need not be the literal biggest object; it's the area of greatest interest.

**B6. Fight flatness — use contrast, layering, depth. "Without contrast you're dead."**
2D layouts get lifeless. Create movement and depth by layering (overlap type and image, some in front / some behind), varying weight, and contrasting elements. *(Videos 4, 6)*

**B7. Beware symmetry.**
Dead-centre, perfectly symmetrical layouts can read static and dull. Reach for asymmetry, angles, and grid tension to add energy — unless calm symmetry is the deliberate point. *(Video 4)*

---

## C. Colour

**C1. Pick colours on purpose — never from thin air.** Colour must tie to the brand/message and audience. *(Video 4)*

**C2. Less colour is more — harmonize a limited palette.**
A tight, intentional palette (and *global* swatches you can tune all at once) looks cohesive; a grab-bag of hues is a "garish mess." One accent does the highlighting. *(Videos 4, 6)*

**C3. Master the dark and the light (tonal value).**
Use a real range of tone, but concentrate it — "use tone like firecrackers": pools of deep dark and bright light for a focal pop, with subtler transitions between related values elsewhere. *(Video 4)*

<svg viewBox="0 0 640 200" xmlns="http://www.w3.org/2000/svg" width="100%" style="border:1px solid #ddd;border-radius:6px">
  <text x="160" y="24" fill="#333" font-family="Arial" font-size="12" font-weight="bold" text-anchor="middle">✗ TOO MANY COLOURS</text>
  <rect x="30" y="36" width="50" height="50" fill="#e23b3b"/>
  <rect x="85" y="36" width="50" height="50" fill="#2ecc71"/>
  <rect x="140" y="36" width="50" height="50" fill="#3b8de2"/>
  <rect x="30" y="92" width="50" height="50" fill="#ff8c00"/>
  <rect x="85" y="92" width="50" height="50" fill="#9b59b6"/>
  <rect x="140" y="92" width="50" height="50" fill="#1abc9c"/>
  <text x="470" y="24" fill="#333" font-family="Arial" font-size="12" font-weight="bold" text-anchor="middle">✓ LIMITED + ONE ACCENT</text>
  <rect x="350" y="36" width="80" height="106" fill="#340A5C"/>
  <rect x="435" y="36" width="80" height="106" fill="#5a3a86"/>
  <rect x="520" y="36" width="80" height="50" fill="#F5F4EB"/>
  <rect x="520" y="92" width="80" height="50" fill="#FFC107"/>
  <text x="470" y="170" fill="#777" font-family="Arial" font-size="11" text-anchor="middle">purple family · neutral · one yellow accent</text>
</svg>

---

## D. Typography

**D1. Type must be legible and friendly.** "Type is only type when it's friendly" — readable and approachable, never pushing the viewer away. *(Video 4)*

**D2. Two type families maximum.** Get contrast from weights/styles within a family (bold vs. regular, italic) rather than piling on faces. *(Videos 3, 4)*

**D3. Treat type as image.** Type is shapes, lines, and texture — it must compose with everything else, not just sit on top. *(Video 4)*

**D4. Contrast within type.** Vary weight, size, and colour to build the hierarchy (one bold word against lighter text). *(Video 3)*

---

## E. Consistency, voice & repetition

**E1. Be consistent — it builds trust.** Consistent type, colour, and layout across a creative (and the whole set) reads as professional and trustworthy. *(Video 1)*

**E2. Speak with one visual voice.** One coherent theme; all elements feel like they belong to the same family. *(Video 4)*

**E3. Repetition unifies.** Repeat colour, shape, and type style throughout so the design flows as a whole. *(Video 3)*

---

## F. Make it stick (distinctiveness)

**F1. Build in a memory hook.** One unique, relevant idea the viewer remembers and talks about — but it must serve the message, not be a gimmick. *(Video 2)*

**F2. Use narrative.** When the brief calls for it, let the visual tell a small story (imagery, metaphor) that carries the message. *(Video 2)*

**F3. Avoid redundant redundancies.** Don't say the same thing in the image *and* the words — let them work together, each carrying part of the load. *(Video 4)*

**F4. Research first; have a recognizable style; don't chase fashion.** Ground the creative in research, keep a consistent ownable look, and don't copy trends you don't understand. *(Videos 2, 4)*

---

## G. Workflow rules (context — not for the prompt itself)

From *6 Rules Every Pro Designer Knows* (Video 5): a **time cushion** on deadlines, building **post-project relationships**, treating **presentation** as part of the sell, **knowing the target audience**, **asking questions up front**, and always using a **contract + deposit**. These govern how a designer runs a *project*, not how a single creative is composed — captured here for completeness. The one that crosses into the creative is **know the audience** (see A2).

---

# PART 2 — THE PROMPT-GENERATOR CHECKLIST

> The image-prompt generator (Art Director) runs every prompt through these before it ships. Each line below is enforceable inside a natural-language image prompt. They restate the rules above in the imperative, ordered the way a prompt is built.

**Intent**
- [ ] **One message per creative.** State the single idea; remove anything that doesn't serve it (A1, A3).
- [ ] **Right persona in the frame.** Scene/human/mood matches the concept's named persona (A2).

**Composition**
- [ ] **Generous negative space; subject moderately sized.** Explicitly instruct breathing room and ≥80px safe margins; never enlarge the subject to fill the frame (B1).
- [ ] **Align to an implied grid.** Shared edges, consistent margins; one element may break alignment *only* for deliberate emphasis (B2).
- [ ] **Group by proximity.** Related text/elements locked together; unrelated elements separated (B3).
- [ ] **One clear hierarchy / focal point.** Name the dominant element and the reading order (headline → support → proof → CTA) (B4, B5).
- [ ] **Add depth, avoid dead symmetry.** Use overlap/layering and contrast for movement; prefer purposeful asymmetry (B6, B7).

**Colour**
- [ ] **Limited, intentional palette.** Kapruka purple-dominant (or soft-cream), one yellow accent only — no grab-bag of hues (C1, C2).
- [ ] **Concentrated tonal contrast.** Strong dark/light where the focal point is; subtler elsewhere (C3).

**Type** *(when the prompt renders text, or in the overlay spec)*
- [ ] **Legible + friendly, two families max, type composed as image, one highlighted word** (D1–D4).

**Cohesion & stickiness**
- [ ] **Consistent visual voice; repeated colour/shape/type** across the set (E1–E3).
- [ ] **One memory hook / narrative beat that serves the message** (F1, F2).
- [ ] **No image/text redundancy** — image and words each carry part of the load (F3).

**Honesty & brand (always)**
- [ ] Real, premium look — no glossy 3D / fake scenes; honour every `[CONFIRM]`; brand guidelines override any rule here on conflict.
