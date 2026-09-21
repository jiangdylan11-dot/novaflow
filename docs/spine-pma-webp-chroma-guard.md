# Spine PMA WebP Chroma Guard Correction, 2026-09-21

## Reproduction

The supplied scatter sample contained an original PNG (3,120,975 bytes,
1635x1635) and a converted WebP (403,514 bytes). Skeleton JSON was byte-identical;
the atlas changed only the page extension. SCATTER3 at x=1456, y=849, w=176,
h=165 contains the crown seen in the Cocos report.

The old Q70 drawing encoder reproduced the supplied WebP byte-for-byte after
10 passes. Cropping the atlas itself shows the same gray crown ornament and
red-to-gray patches; this damage already exists before loading into Cocos.

Input PNG SHA256: `7355dcc4bae139a9b04fd24c1d6450b64c89599f3ec6a3019dcfe209ee52b317`.
Old WebP SHA256: `8a64e7ed88e5501ea425a8e08a099fb7848f67f7414e9312c3eb33091973f680`.

## Cause and Correction

The old transparent-RGB guard neutralized U/V across a neighborhood around a
leaking YUV420 cell. At low Q, its radius grew to four chroma samples. Repeated
neutralization therefore removed color from neighboring visible artwork.
Lossless alpha and clean RGB at alpha=0 did not detect this visible damage.

Only the chroma cell containing an observed transparent spill may now change.
The guard does not expand into neighboring cells. A cell still covers 2x2
pixels, so lossy edge changes are possible; this is not exact-color output.
The existing low-Q luma adjustment stays restricted to that same cell and
original RGB <= min(16, 2 * (pass + 1)). Source pixels and alpha are unchanged.

Default/clarity candidates allow eight passes rather than four; drawing Q70/Q80
keeps its twelve-pass bound. Only transparent-RGB failures trigger these bounded
quality retries, without widening the correction area:

| Requested preset | PMA candidate qualities |
| --- | --- |
| clarity | 95, 96 |
| compact / legacy PMA default | 90, 92 |
| small | 70 drawing, 80 drawing, 90, 92 |

A successful retry reports the actual quality and a per-image warning. Other
errors, or exhaustion of the candidates, still produce verified exact-RGBA
output with a larger-file warning. No alpha changes, loader changes, atlas
coordinate changes, new dependencies, or UI controls are introduced.

## Sample Results

The local Q90 scatter candidate is 525,650 bytes (513.33 KiB), versus 394.06 KiB
before: +30.3%, but 83.2% smaller than the source PNG. Alpha matches byte for
byte, transparent RGB is zero, and the crown's gold/red colors are restored.
It converges after five passes. Its SHA256 is
`a03f9a7b3fe4e7831030eeaf9b072cac689e109ceeb4517362a9c12e4ca36da5`.

As a diagnostic, count pixels with source alpha >= 200, source RGB range >= 50,
and output RGB range less than half the source range. In the crown, that count
falls from 2,593 to 0; across the page it falls from 8,627 to 32. This heuristic
is evidence for this desaturation bug, not a general perceptual quality score.

Q70/Q80 do not pass the corrected guard on scatter; small upgrades to Q90.
Q95 also fails, while Q96 passes in three iterations at 674,602 bytes. Merely
increasing local retries to twenty did not solve the residual transparent
pixels on this sample or the old win corpus. Neutralizing extra transparent
or near-black cells did not solve them either; those experiments are not shipped.

For the frozen source-pma win corpus, local Q90 alone would fall back to large
lossless files for win.png and win_3.png. Slightly higher Q92 passes without
expanding chroma protection: win.webp is 1,184,226 bytes (three passes),
win_3.webp is 635,472 bytes (one pass). win_2.webp remains Q90 at 412,864 bytes.
The three-page total is 2,232,562 bytes (2.13 MiB), 5.4% above the earlier
accepted Q90 total, rather than 5.54 MiB from unconditional lossless fallbacks.
The native straight-alpha reference is a size reference, not a PMA visual one.

## Verification Boundary

Fifty focused converter, encoder, and tool-contract tests pass. New tests hold
the transparent spill for four consecutive retries at Q70 and Q90 and assert
that neighboring visible chroma cells never change. They also cover the actual
Q92/Q96 reporting, bounded retries, unchanged alpha, and exact fallback.

The real converter and folder writer are exercised separately from mock-based
contracts. All test assets are written to separate output folders, with JSON
copied unchanged; inputs are not overwritten. Compare decoded pixels and actual
written bytes, not just the success flag.

Syntax checks, runtime sync, and runtime hash checks pass. The locked 4783 entry
check reports GO; unrelated upstream 8188 health times out. No installer is
built in this fix. Cocos scene/game acceptance is still pending the user's
test of the exported sample; atlas inspection is not a substitute for it.
