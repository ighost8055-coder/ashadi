# Reference Creatives — visual taste anchors

The brand guidelines describe the look in *words*. These folders show it in *pictures*. The Art Director and Designer use them to match Kapruka's taste before generating any prompt — written rules alone can't capture "premium and on-brand," but examples can.

## Folders — what goes where

```
references/
├── kapruka-past/   ← Kapruka's OWN past creatives. Tag the winners.
├── ideal/          ← aspirational / competitor / mood references you WANT to look like
└── taste-digest.md ← written distillation of the patterns in the above (the Art Director reads this)
```

**Drop images in as `.png` / `.jpg`.** Helpful naming:
- `kapruka-past/win-diwali-hamper.png`, `kapruka-past/win-cake-hero.png` (prefix proven winners with `win-`)
- `ideal/ref-minimal-purple-textled.png`, `ideal/ref-premium-product-hero.png`

## How they're used

1. **Taste digest (always-on).** Someone (or Claude, on request) looks at every image here once and writes `taste-digest.md` — the recurring patterns: exact purple tone, how much negative space, headline placement, product styling, lighting, what's deliberately absent. The Art Director reads this on every run, so the *taste* shapes every prompt cheaply and consistently.

2. **Reference-image conditioning (selective).** For a creative that must match a specific look closely, 1–3 of these images are attached directly to the image-generation call (`gpt-image-1` via `images.edit`) so the model sees the target style, not just reads about it. Costs more per image — use on hero creatives, not every draft.

## Keep it curated
A handful of genuinely on-brand, high-quality references beats a dumping ground. 5–10 strong examples per folder is plenty. Remove anything off-brand — the model will copy whatever it sees, including mistakes.
