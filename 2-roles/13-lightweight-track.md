# TRACK: Lightweight Track (secondary-client pattern)

> **Standalone, general pattern — not a replacement for the main Kapruka Build Sheet pipeline.** Use for smaller/secondary clients where the full monthly machine (Strategist/angle + Art Director/format + Assembler/PDF + Creative Director/concepts + the ⭐ human pick gate) is more process than the engagement needs. First run: Skrumptious, 2026-07-26 (see PRECEDENT below). Formalized as a reusable pattern 2026-08-16.

---

## THE FLOW

```
Researcher → Ideator (lightweight mode) → Copywriter (lightweight mode) → Reference Recreator → Evaluator → build/live
```

**No human pick gate. No Build Sheet. No Assembler. No Creative Director.** Every idea that clears the Copywriter pass goes straight through the Reference Recreator into the one end-of-day document (see below) — that's the entire point of "lightweight." Reference Recreator's main-pipeline default (on-demand only, per its SCOPE DECISION) is superseded *within this track*: here it runs every batch, not on request, because its output format **is** this track's deliverable.

## THE FIVE ROLES, IN THIS TRACK

1. **Researcher** — unchanged from `03-researcher.md`. Mines the client's competitive set for proven concepts, maps by segment/persona.

2. **Ideator, lightweight mode** — wide pool of one-line seeds, each tagged with an idea **type** instead of the main pipeline's four entry points:
   - **`Combo`** — an original idea: a combination of 2+ existing angles/concepts/references. ("Nothing is fully original" — combination *is* the origination move.) State the combination in one clause; that clause **is** the angle.
   - **`Direct`** — a proven concept lifted from research, ported into the client's own context with minimal remixing. The angle is the source ad's angle, carried over as-is.
   Angle now lives **inside the seed row** — no separate Strategist pass in this track.

3. **Copywriter, lightweight mode** — writes the hook **and** names the format in plain words, in one pass, directly off the Ideator's seed. The main role's hard boundary ("you are a REFINER, waiting on Creative-Director-approved concepts") is **suspended in this mode only** — there is no CD stage to wait on. Everything else about the Copywriter still applies: the Three-Yes Test, Write-Like-A-Human, honesty discipline, one CTA.

4. **Evaluator** — unchanged from `06-evaluator.md`. Fidelity + quality gate before spend, checklist adapted to the client's own brand guidelines (not Kapruka's).

5. **Reference Recreator** — same prompt-writing method and rules as `12-reference-recreator.md`, but runs as a **standard stage of this track**, not on-demand — every idea that survives the Copywriter pass gets one prompt written for it, because the Reference Recreator's document format is this track's single deliverable (see below).

## WHAT REPLACES THE HUMAN PICK GATE

Nothing does — there isn't one in this track. Whatever Ideator + Copywriter produce goes straight to build. If a specific client engagement later wants a pick step, that's a deliberate addition scoped to that client, not this track's default.

## THE END-OF-DAY DELIVERABLE — one document, not two

There is **no separate idea sheet as an intermediate.** The lightweight track's single output **is** the document the **Reference Recreator** already produces (per `12-reference-recreator.md` § FORMAT OF THE DELIVERABLE) — one markdown file, one numbered prompt per idea, saved to `../3-output/reference-recreations/[batch-name]-[date].md`. What this track adds: each prompt's metadata line is **extended to carry the full trail** back through Researcher → Ideator → Copywriter, so the single document is self-contained — nobody has to flip to a separate sheet to know where an idea came from or why it looks the way it does:

```
## Prompt N — [source filename or "Brain"] — [one-line: what this recreates/builds]
Source: [Combo/Direct] · Idea: [the Ideator's one-line seed] · Angle: [the angle] ·
Hook: [the Copywriter's headline] · Format: [the Copywriter's plain-words visual direction] ·
Business line/Category: [as relevant to the client]

[the complete, self-contained image-generation prompt — per the Reference Recreator's usual spec]
```

So Researcher's evidence, the Ideator's seed + type, the Copywriter's hook + format, and the Reference Recreator's prompt all live in **one file per batch.** No Build Sheet, no separate pick doc, no cross-document lookups — end of day, there's exactly one document to hand the human or the builder.

## WHEN TO USE THIS VS THE MAIN PIPELINE

| | Main pipeline (11 roles) | Lightweight track (5 roles) |
|---|---|---|
| **Client** | Kapruka | secondary/smaller client |
| **Volume** | high, monthly cadence | lower, on-demand batches |
| **Personas/lines** | 15 personas × 3 lines | usually one core positioning |
| **Human gate** | ⭐ one pick from the Build Sheet | none — straight to build |
| **Angle/format owners** | Strategist / Art Director (dedicated) | folded into Ideator / Copywriter |

## PRECEDENT

First run: **Skrumptious** (2026-07-26) — `3-output/reference-recreations/kapruka-x-skrumptious-graphic-set-2026-07-26.md`. That run predated this formalized track and didn't explicitly tag Combo/Direct, but its angle — *"For fifteen years, you had to come here. Not anymore."* — is retroactively a **Direct**-type idea: Skrumptious's own 15-year delivery limitation, adopted straight through as the ad's angle, Kapruka-context adopted (next-day island-wide).

## RULES THAT STILL APPLY, NO EXCEPTIONS

- **Core Rule 9 — honest claims only.** Same as the main pipeline.
- **Core Rule 11 — ground every recommendation in that client's business context**, not Kapruka's, unless the client *is* being sold as a Kapruka merchant (see the Skrumptious memory for that nuance).
- **The Three-Yes Test** on every hook.
- If the client's brand rulebook has its own version of Core Rule 12 (category breadth) or any other Kapruka-specific rule, **check whether it applies before importing it** — see the Skrumptious memory's rule-split (brand-agnostic craft carries over; Kapruka-only specifics do not).
