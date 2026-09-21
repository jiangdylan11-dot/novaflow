# Spine Size-First WebP, 2026-09-15

This is a historical validation record. The expanding chroma guard below was
found to desaturate visible artwork and is superseded by the
[2026-09-21 chroma guard correction](spine-pma-webp-chroma-guard.md).
Its file sizes are not promises for the corrected encoder.

## Behavior

`options.preset = "small"` now starts at Q70 rather than Q86. The user explicitly
accepts more color loss in exchange for smaller files. Balanced Q90 remains the
default, and clarity Q95 is unchanged. Straight WebP and JPG use Q70 directly.
Source-alpha overrides still describe the input; nothing converts straight input
into PMA or changes the runtime's texture loader.

PMA pages use the existing drawing codec configuration and independent lossless
alpha stream. All completed PMA candidates must retain byte-exact alpha and zero
RGB wherever the original alpha was zero. RGB above source alpha, unknown alpha,
codec failure, and failed verification retain the existing exact-RGBA fallback.

## Low-Quality Edge Guard

For drawing Q80 and below only, the guard permits up to 12 encodes. After an
observed transparent-RGB spill, its chroma neighborhood grows from radius 1 to a
maximum radius of 4 chroma samples. Neutralization still moves U/V toward 128 by
the existing factor of 0.35.

Only flagged cells may also get local luma headroom: source RGB must be at most
`min(16, 2 * (pass + 1))` in every channel. These near-black pixels get Y=0 before
the next lossy encode. Brighter pixels and cells outside the flagged neighborhood
are not changed by this luma adjustment. This is an intentional local color loss,
not lossless output. No alpha levels are quantized, no global dark-floor filter
is applied, and the input RGBA buffer is not modified.

Q90/Q95 and the previous drawing Q86 profile keep the original four-pass guard.
If Q70 still fails the transparent-RGB check, only that page tries Q80, then Q90.
Other errors do not start these quality retries. Successful upgrades report their
actual quality with a filename-specific warning. If every attempt fails, exact
RGBA output and its larger-file warning remain in effect. The process is bounded
but can take longer than Q86, particularly for a page requiring a quality retry.

No additional binaries or dependencies are required. Experimental cwebp profiles
were evaluated only in temporary files and are not part of this implementation.

## Real Output

Frozen input: `Straight-source-test-MhyIHq/source-pma` under
`D:/some/2026_08金鏟鏟/输出`. Real converter plus output writer produced
`PMA-small-q70-5FCgiB`, without overwriting the source.

| Page | Actual quality | Bytes |
| --- | ---: | ---: |
| win.webp | 80 | 930,988 |
| win_2.webp | 70 | 299,676 |
| win_3.webp | 70 | 449,822 |
| Total | | 1,680,486 |

The total is 1.603 MiB: 14.7% below the previous Q86 small preset (1,971,030
bytes), 20.7% below Q90 (2,117,850 bytes), and 7.5% below the native size reference
(1,817,378 bytes). The native reference is straight-alpha WebP, not a PMA visual
reference. File-size comparisons do not imply equal quality.

Simply lowering the old drawing encoder to Q75 produced 1,629,472 bytes, but all
three pages failed transparent-RGB verification. Those rejected candidates were
not shipped. The new result includes one explicit Q70-to-Q80 warning for win.png.

The exported atlas changes only page extensions, JSON is copied unchanged, image
dimensions are unchanged, and all written image bytes match the converter output.
`verification.json` records per-image alpha and transparent-RGB checks.

## Verification

45 focused converter, encoder, and UI-contract tests pass, including local-only
luma changes, retry limits, actual quality reporting, mixed JPG/WebP pages, exact
alpha, default Q90 identity, and real output writing.

Stock Spine 4.2 with PMA enabled and texture upload unchanged rendered four frames
each for PNG, Q90 and the new preset. Poses match, frames are nonblank, and console
errors are zero. Render mean RGB error against PNG is 1.18-1.38/255 for the new
preset versus 0.91-0.99/255 for Q90. Visual quality is lower by design and final
user acceptance remains separate from these checks.

An isolated Electron host loaded the actual tool script and exercised preset
changes, mixed formats, keyboard activation, default Q90 identity, and real folder
export for both Q90 and Q70. Exported bytes match the converter results. At
1440x900 and 1100x900, preview pixels are nonblank and labels do not overlap the
actions. Page console errors are zero. Evidence is in
`C:/Users/jiang/AppData/Local/Temp/nf-spine-preset-ui-bT4MY5`.

Commands: `node --check`, focused `node --test --test-isolation=none`,
`npm run sync:runtime`, `npm run check:runtime`, and `npm run check:entry`.
Syntax, focused tests, runtime sync and runtime checks pass. `check:entry` is
NO-GO because 4783 refuses connections; upstream 8188 responds. The isolated
component host is not the locked live page, which remains unverified.
