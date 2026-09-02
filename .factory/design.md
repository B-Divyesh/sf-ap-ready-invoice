# AP-Ready Invoice — visual thesis

## Direction

**Monochrome typographic broadsheet.** Corporate payment work is document work: invoices, purchase orders, approval stamps, and email trails. The interface borrows the certainty and scan order of a financial newspaper without pretending to be an accounting system. Dense rules organize facts; generous margins keep the task calm. A single proofing red marks only missing details, overdue actions, and the next person responsible.

## Palette

- `paper #F3EFE5` — warm uncoated stock; the primary background.
- `ink #151513` — near-black type and rules; 15.1:1 contrast on paper.
- `sheet #FFFDF7` — active forms and invoice sheets.
- `muted #5C5A53` — secondary copy; 5.8:1 contrast on paper.
- `proof #A72D24` — proofing marks, warnings, and primary actions; 6.2:1 on paper.
- `proof-dark #7E1F19` — active proof red.
- `clear #1F624A` — completed checks; paired with words and symbols.
- `rule #BBB5A8` — structural borders, never the only state cue.

This is a deliberately single-mode product. Explicit paper backgrounds preserve the broadsheet metaphor and make printed packets predictable.

## Type

- Display and editorial headings: Georgia, `Times New Roman`, serif. Large, compressed line-height gives headlines the authority of a front page.
- Body and controls: Arial, Helvetica, sans-serif. Familiar letterforms reduce friction in forms and dense AP details.
- Invoice numbers, amounts, dates, and audit rows use tabular figures. No external fonts load.

## Spacing and shape

An 8 px base grid uses 4, 8, 16, 24, 32, 48, 64, and 96 px steps. Content caps at 1180 px; reading copy caps at 68 characters. Rules and open columns replace generic floating cards. Sheets have square corners, one-pixel ink rules, and a small offset shadow like stacked paper. Buttons are rectangular labels with 44 px minimum height.

## Interaction grammar

- The current next action appears as a red margin note with an explicit owner.
- Preflight rows read like a proofreader's checklist: numbered, ruled, and stamped “Ready” or “Fix”.
- Status changes append to a chronological receipt trail. Nothing silently overwrites history.
- Destructive actions name the exact record and require confirmation.
- Route changes move focus to the page headline and announce it.

## Motion

The signature motion is a 220 ms **proof-stamp** arrival: new status labels scale from 0.96 and settle in place while the receipt rule draws across. Other transitions use opacity only. Under `prefers-reduced-motion: reduce`, all transforms and smooth scrolling are removed and state changes are instant. Nothing loops.

## Asset plan and provenance

The hero uses one original editorial still life: an overhead invoice packet, PO slip, envelope, and red pencil on warm newsprint. It explains the product's world without placing required text inside the image. The crop leaves a quiet left margin for the headline and keeps the paperwork on the right.

Prompt sheet:

> Use case: stylized-concept. Asset type: wide landing-page editorial hero. An overhead still life of a corporate invoice handoff on warm uncoated newsprint: a clean blank invoice sheet, small purchase-order slip, window envelope, paper clip, and one red proofreader pencil. Monochrome black ink with a single restrained oxblood red accent. High-contrast editorial photography mixed with subtle halftone print texture, precise hard shadows, tactile paper fibers, 35mm top-down lens. Composition weighted to the right with calm negative paper space on the left. No people, no hands, no readable text, no numbers, no logos, no brands, no watermark, no gradient, no glossy 3D render.

Generated on 2026-09-02 with the factory Azure image deployment via `/opt/fleet/lib/gen-image.sh`. The selected output is original to AP-Ready Invoice. Source PNG and prompt sidecar live under `assets/src/`; optimized WebP is shipped in `frontend/public/`.

## Responsive behavior

At 390 px, columns become one reading stream. The live product preview follows the first action, tables become labeled stacked rows, and the demo banner wraps without covering content. The invoice sheet keeps print hierarchy while nonessential folio labels hide. Every control remains at least 44 px.

## Artwork review checklist

Reject candidates with legible invented invoice text, malformed stationery, accidental logos, extra pencils, glossy SaaS styling, or dominant color beyond paper, ink, and proof red. The final must read as a real document handoff at thumbnail size.
