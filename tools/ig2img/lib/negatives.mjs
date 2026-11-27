// negatives.mjs — the ONE list of things that must never appear in a generated image.
//
// Kept in a single place so the image model, the prompt-writing agent and any future
// engine all read the same list. Add here, and it reaches every path at once.

export const NEGATIVES = [
  // --- brand safety -------------------------------------------------------------
  'no alcohol of any kind: no beer, wine, arrack, spirits or cocktails, no bottles, cans, wine or beer glasses, no bar or pub setting, nobody drinking or toasting',
  'no third-party brand logos, wordmarks, watermarks, labels or packaging of any other company — no Coca-Cola, Nestle, Cadbury, Amazon, Apple, Samsung or any other mark, and no invented brand marks',
  'no stock-photo watermarks, agency watermarks, signatures, URLs, handles or QR codes',
  'no Kapruka logo, wordmark or tagline drawn into the frame (the real one is added afterwards) — keep the bottom-right corner clear',
  'no Kapruka branding printed onto a third-party product',

  // --- text quality -------------------------------------------------------------
  'no misspelled, garbled, duplicated, reversed or nonsense lettering, and no non-English characters',
  'no serif, script, slab, display, decorative or handwritten type — Inter only',
  'no em dash in any on-image copy',
  'no text smaller than the size stated in the prompt',
  // Placement is where the recreations keep drifting off the reference, so it is
  // stated as a negative too, not only as a positive in the LAYOUT block.
  'no sloppy typesetting: no uneven or unequal side margins, no ragged or inconsistent line spacing, no text block drifting off the alignment the prompt specifies, no type crowded against or bleeding off a frame edge, no text overlapping the subject unless the prompt asks for it',

  // --- craft --------------------------------------------------------------------
  'no waxy, plastic, over-smoothed or CG/3D-render look; no AI-generated sheen',
  // Counting matters more than "malformed" here: the common failure is an EXTRA
  // limb, drawn perfectly, because the character is holding two things and also
  // gesturing. State the count, not just the quality.
  'every person or character has EXACTLY two arms, two hands and five fingers per hand — never a third arm or hand, never an extra hand appearing behind or beside an object being held',
  'no malformed, fused, extra or missing hands, fingers, arms, legs, eyes or faces',
  'if a character holds more than one object, the objects must be shared between their two hands only — never add a hand to hold the extra item',
  'no floating or ungrounded objects, no oversized subject filling the frame',
  'no flat, muted, washed-out or low-contrast rendering',
  'no clutter or filler props',

  // --- setting ------------------------------------------------------------------
  'no gift resting on the ground, floor, doorstep or pavement',
];

/** One line per negative, for pasting into an image prompt. */
export const negativeBlock = () => `NEGATIVE — do not include any of the following:\n${NEGATIVES.map((n) => `- ${n}`).join('\n')}`;

/** Compact single-line form, when space is tight. */
export const negativeLine = () => NEGATIVES.join(' · ');
