# Spine PMA WebP Q90

The Q86 small-preset sections below record the 2026-09-12 implementation.
The current size-first preset is described in [spine-pma-webp-q70.md](spine-pma-webp-q70.md).
The historical guard, retry bounds, and byte-identity claims below are superseded
by the [2026-09-21 chroma guard correction](spine-pma-webp-chroma-guard.md).

## Contract

The compatible preset preserves the input's stored premultiplied RGB convention.
It requires PMA input and PMA rendering in the consumer. It does not convert
straight-alpha input into PMA, modify the viewer, or add upload premultiplication.
Per-page source-alpha overrides still describe the input, not a desired output.
Unknown source alpha and explicit lossless mode retain exact RGBA.

## Fixed Presets

The tool exposes three fixed presets instead of compatible/lossless mode buttons
or a free-range slider. `options.preset` accepts `clarity` (Q95) and `compact`
(Q90, default), plus `small` (Q86). Compact preserves the accepted PMA Q90 encoder exactly. The same
color quality applies to PMA WebP, straight WebP and JPG; alpha quality stays 100.
Source-alpha selection is independent. Changing preset clears old results and
disables export until reconverted. Keyboard activation preserves button focus.

Legacy API callers without preset retain their existing options, including
explicit lossless output. An explicit preset overrides legacy quality/mode flags;
invalid preset values are rejected. Presets request compression, not a byte size.
PMA verification still falls back to exact RGBA with a warning when necessary.

Q95 and Q90 pass on all three frozen win pages. Q95 totals 2,569,424 bytes;
Q90 totals 2,117,850 bytes. Merely lowering Q to 89, 88 or 86 with the default
codec configuration fails the win_2 transparent RGB check. Earlier Q80/Q70
trials still failed with 12 passes, so the four-pass bound remains unchanged.

The small preset instead uses libwebp's drawing configuration at Q86 for the
opaque VP8 color encode. The original Q100 intermediate, lossless alpha, and
all validation remain unchanged. Its three outputs total 1,971,030 bytes,
6.9% below Q90 and 8.5% above the native straight-WebP size reference. It does
not promise native quality or an exact byte size. It requires separate visual
acceptance; it is not the previously user-approved Q90 configuration.

Only when the small preset fails transparent-RGB verification does it retry
that page once with the accepted Q90 configuration, reporting the actual
quality and a warning. Other failures and failed Q90 retries keep exact RGBA
fallback. No preset bypasses verification. Default Q90 output remains unchanged.

## Accepted Encoder

`main/spine-webp-pma-encoder.js` implements the user-accepted `guard-q90` preset:

1. Decode RGBA and reject RGB above alpha from this lossy path. Such pixels may
   contain intentional additive color and are preserved by the exact fallback.
2. Encode opaque stored RGB with Sharp Q100, effort 6, smart subsampling; decode
   that intermediate into YUV420 using the bundled FFmpeg.
3. Set Y to zero only where original alpha is zero. This sub-black encoding
   headroom reduces VP8 ringing without quantizing alpha or visible-pixel luma.
4. Encode VP8 at Q90 by default (or the chosen Q95 preset), compression
   level 6, without extra presets or dithering. Only the small preset uses
   Q86 with the codec's drawing configuration; no alpha quantization is added.
5. Mux a lossless ALPH stream generated from the actual input alpha. A black RGB
   carrier avoids doing unnecessary color encoding for this independent stream.
6. Decode the completed file. Alpha must match byte for byte. If RGB spills into
   fully transparent pixels, neutralize surrounding 3x3 chroma cells by 0.35 and
   retry, with four encodes maximum. No unpremultiply or second multiply occurs.
7. On failure, use the existing byte-verified exact encoder and report a warning.

FFmpeg's pipe muxer may leave a zero RIFF size and append the size fixup after
large outputs. Normalize that internal form before strict chunk validation and
final muxing. Do not relax validation of externally supplied WebP containers.

This is lossy RGB, not lossless or a general proof that decoded RGB never exceeds
alpha. The guarantees checked here are unchanged alpha and zero transparent RGB.
Other content/decoder combinations still need visual acceptance. Do not silently
lower the default Q90, quantize alpha, step RGB, or add a straight-alpha loader
workaround. Lower-quality encoding is limited to the explicit small preset.

## Local Acceptance, 2026-09-12

Using the frozen `Straight-source-test-MhyIHq/source-pma` three-page win asset:

| Page | Integrated bytes | Accepted guard-q90 bytes |
| --- | ---: | ---: |
| win.webp | 1,114,232 | 1,153,236 |
| win_2.webp | 412,864 | 416,852 |
| win_3.webp | 590,754 | 611,730 |
| Total | 2,117,850 | 2,181,818 |

Every decoded RGBA byte and every VP8 chunk matches the user-accepted candidate.
Only lossless alpha compression differs. The native straight-WebP size reference
is 1,817,378 bytes; it is not a PMA-compatible output reference.

Stock Spine 4.2 rendering, PMA enabled, default texture upload unchanged: two
Bigwin_loop frames, one Megawin_loop frame and one Superwin_loop frame match the
accepted candidate pixel for pixel. All frames are nonblank, with identical poses
and no console errors. JSON is unchanged; atlas changes only page extensions.
The user separately accepted guard-q90 in their existing viewer.

## Small Preset Validation, 2026-09-12

The real converter and output writer exported the three pages to
`D:/some/2026_08金鏟鏟/输出/PMA-small-preset-RbTxLR` without touching the sources.
Sizes are 1,034,292 / 383,420 / 553,318 bytes. All retain byte-exact alpha and zero
fully-transparent RGB; no page needed fallback. JSON is unchanged. Atlas changes
only the three matching page extensions. `verification.json` records the results.

Stock Spine 4.2, PMA enabled with the default texture loader unchanged, rendered
the same four frames for PNG, Q90 and small. Poses match, frames are nonblank,
and console errors are zero. Mean per-channel error against the PNG renders is
0.979-1.068 for small versus 0.905-0.987 for Q90 on an 8-bit scale. These averages
do not prove perceptual equivalence; the new preset still needs user acceptance.

An isolated Electron component host verified preset changes invalidate results,
mouse/keyboard activation, disabled controls during conversion/export, mixed
format quality, default Q90 byte identity, and real folder export. The 1440x900
and 1100x900 layouts keep the preset labels and preview titles clear of actions.
This host is not the locked 4783 page. Runtime sync and 43 focused tests passed;
`check:entry` remains NO-GO because 4783 is not listening (8188 responds).

## Regression

```powershell
node --test --test-isolation=none particle-editor-desktop/tests/spine-webp-pma-encoder.test.js particle-editor-desktop/tests/spine-atlas-webp-converter.test.js particle-editor-desktop/tests/spine-atlas-webp-tool-contract.test.js
npm run sync:runtime
npm run check:runtime
npm run check:entry
```

The helper is in the shared runtime-file registry and the packaged main directory.
The 4783 entry/UI gate is separate from the file conversion and stock-render tests.
