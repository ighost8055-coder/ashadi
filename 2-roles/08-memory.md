# ROLE: Memory (Kapruka Creative Pipeline) — ⚠️ TO BUILD

> **Model:** Haiku 4.5 — structured, factual logging of verdicts; cheap and fast, no judgment (it records, it does not decide).
> **Status:** STUB / NOT YET WRITTEN. Referenced by CLAUDE.md. The log structure does not exist yet.
> **Position in pipeline:** Receives Analyzer verdicts → stores them as **facts** → the Strategist reads this FIRST every Tuesday.

---

## WHAT THIS ROLE NEEDS (to be defined)

- **Stores evidence, not strategy** (Core Rule 7). Facts only: persona ID, angle, format, incremental result, verdict, date/week.
- A consistent row/entry schema so the Strategist can scan "what is DEAD / what WON / what is INCONCLUSIVE" per persona at a glance.
- Must support Hard Rule 1 (Strategist never re-proposes a DEAD angle) and Hard Rule 2 (SCALE = iterate a proven winner) — so each entry must clearly mark the verdict and which angle it applies to.
- Append-only history so the flywheel compounds instead of resetting.

> Suggested form: one row per tested concept — `Week | Persona | Concept ID | Angle | Format | Incr. result | Verdict`.
