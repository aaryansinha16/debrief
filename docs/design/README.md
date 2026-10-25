# Witness design

The approved visual direction for Debrief's witness product (D-080). Source of truth for P-71 to P-75.

- `tokens.json` — colors, type, radii, glow, motion.
- `artboards/*.dc.html` — the four approved screens as markup. They were authored for a design
  canvas runtime, so they don't open standalone: read them as a spec. Layout, copy, inline styles,
  keyframes and the sample data in each `renderVals()` are all meant to be followed.
- `screens/` — add PNG exports or screenshots of the four screens here.

## Screens

| File | Screen | Route (planned) |
| --- | --- | --- |
| `claim-check.dc.html` | Claim check: verdict headline, integrity ring, claim beams, unreported side effect, witnesses | `/sessions/[id]` |
| `replay.dc.html` | Replay: said vs saw rails splitting at the divergence, beat strip, playback | `/sessions/[id]/replay` |
| `receipt.dc.html` | Receipt a client opens: staged verification checks, chain links, paper receipt with holographic seal | `/r/[receiptId]` (public) |
| `phone-nudge.dc.html` | Phone: contradicted-claim card, session list with mini rings | PWA / push |

## Signature elements (keep these, they carry the brand)

1. **Claim beam** — claim on the left, evidence on the right, joined by a beam. Holds: solid
   line with a travelling light pulse and a check node. Contradicted: the line fractures into a
   flickering zigzag, cross node, row tinted. No witness: dotted line, dashed "?" node.
2. **Integrity ring** — one arc segment per claim, colored by verdict, glowing; centre shows
   `holds / total`.
3. **Said / saw rails** — two light rails over time; the observed rail bends away at the
   divergence into a pulsing burst with the consequence label.
4. **Paper receipt + foil seal** — off-white thermal paper with zigzag edges on a dark stage,
   gently floating; conic-gradient foil seal spinning, circular text ring.

## Rules

- Every verdict is shown by icon + word + color, never color alone. Text contrast ≥ 4.5:1.
- Glow only on objects that carry meaning. No background washes, particles or swarms.
- Every animation is disabled under `prefers-reduced-motion`.
- Replay animations are functions of the replay clock (seek-deterministic), not wall-clock CSS.
- Sample data in the artboards is illustrative; real screens use fixture or live data.
