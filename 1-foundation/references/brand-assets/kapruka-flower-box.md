# Brand Asset — The Kapruka Flower Box (canonical reference image)

> **What this is:** the real Kapruka flower-gifting box, registered as a **reusable reference asset** for all image-generation work (2026-07-24, human rule). Whenever a prompt depicts "a gift" as a **flower bouquet in its box** (as opposed to a bouquet alone, a cake, or general premium gifting), this is the exact packaging to reproduce — **attach the image file below to the image-generation tool and instruct the model to match/composite it, not redraw it from text** (same attached-asset discipline as the logo, cake box, gift packaging, bag and van).

## The image files
- **Canonical path:** `1-foundation/references/brand-assets/kapruka-flower-box.png`
- **Source:** provided by the human on 2026-07-24 — two reference shots: (1) a styled lifestyle photo, mixed bouquet (roses/lilies/carnations/chrysanthemums) arranged directly into the open box on a pale tabletop; (2) a plain studio/desk photo of the closed box alone, confirming the real construction.
- ⚠️ **Action for the human:** save the supplied flower-box photo(s) to the path above (Claude cannot write a pasted image's binary to disk). Once it's there, every batch attaches it alongside the logo. If both reference shots are worth keeping, save the second as `kapruka-flower-box-closed.png` and note it in the registry.

## Exact description (for models that can't take a reference image, or as a spelling/detail check)
A **deep Retail Purple `#340A5C`** rigid rectangular box (same material/construction family as the cake box — matte cardboard, clean die-cut edges), photographed either as a lifestyle shot with the bouquet arranged into it, or plain on its own. Features:
- **Two bold Kapruka-Yellow `#FFC107` smile arcs** (open-U shapes), one upper-right and one lower-left, on the front panel — **note: two smiles, diagonally placed**, distinct from the cake box's single centred smile.
- **Front lower area:** the white **"kapruka"** wordmark (smile in the 'u') with the **"A world of choices"** tagline beneath, centred — **no "Every Bite. Pure Happiness." line** (that tagline is cake-box-only, per `_brand-assets.md`).
- Clean matte finish, real cardboard edges, soft natural studio/daylight — premium, not glossy/plastic. Sized for a **standing bouquet**, taller/narrower proportions than the cake box.

## When to use it (vs the other gift assets)
| Use this flower box when… | Use instead… |
|---|---|
| the gift is a **bouquet delivered/gifted in its box** (unboxing, doorstep arrival, "the box that showed up") | — |
| the gift is specifically **a cake** | `kapruka-cake-box.png` |
| the gift is **wrapped/ribboned premium gifting** (bag+box+tissue+card, non-flower, non-cake) | `kapruka-gift-packaging.png` |
| a purchase is **carried/shopped/hauled** (Ecom breadth) | `kapruka-bag-packaging.png` |
| a **delivery vehicle** appears | `kapruka-delivery-van.png` |

> **Don't default to the cake box for every "gift" prompt.** Kapruka now has multiple real packaging assets — pick the one that **matches the scenario's actual product category** (flowers → flower box, cake → cake box, general premium gift → gift packaging set, everyday purchase → bag). See "3. A gift is never a generic box" in `_image-gen-rules.md`.

## The usage rule (global — applies to every image-gen prompt this system produces)
1. **Attach `kapruka-flower-box.png` to the generation tool** whenever the concept's gift is a flower bouquet shown in its Kapruka box, and instruct: *"Use the attached Kapruka flower box image exactly as provided — composite/match it; do not redraw, distort, recolour or reconstruct the two smile arcs, wordmark, or tagline from text."*
2. **Never substitute a generic/unbranded flower box** for "a gift." (See Reference Recreator Hard Rule 11.)
3. The **bouquet inside** is still swapped to a real kapruka.com listing (e.g. *Velvet Rose Dreams*, a mixed rose/lily/carnation arrangement).
4. Same as the other packaging assets: after generating, **check the smile shapes, wordmark and tagline spelling** — AI models distort packaging; for final production rebuild as vectors (brand guidelines §11).

## Related
[[kapruka-cake-box]] · [[kapruka-gift-packaging]] · [[gift-depiction-and-cake-box-asset]] · Reference Recreator Hard Rules 8 & 11.
