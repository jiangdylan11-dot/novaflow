# Spine offset curve correction 2.0.82

For a 60-frame loop with authored keys at 0, 30 and 60, offsetting by +10 frames
produces keys at 0, 10, 40 and 60. The original 30-to-60-frame Bezier is split
and renormalized into the 40-to-60 and 0-to-10 segments. The complete 0-to-30
segment shifts to 10-to-40 with its normalized shape intact.

Consecutive offset gestures remember the authored track and accumulated phase,
so generated seam keys are not treated as additional authored keys on the next
gesture. A different edit invalidates that transient cache. No cache is saved
in project JSON, exports, or undo snapshots.

Verification: 25 focused clipping/dopesheet/offset checks, 56 editor operation
checks, runtime synchronization and runtime/entry checks passed. The 11 offset
checks also passed against the exact minified script installed locally. Browser
interaction with an independent test project loaded scripts from the installed
assistant at 127.0.0.1:4784: +10, +5, -5 preserved four keys and restored the same
split handles. Both seam segments were visually inspected.

The original 2.0.81 installed script matched the script served at port 4784.
Running the same synthetic +10-frame test through it produced a linear seam
and unchanged outgoing handles. Its version label was correct; it did not
contain the curve-splitting change from commit 41314f99.

Local update scope: only the two Spine editor scripts in web-dist and
worker-renderer, the web entry cache tokens/release metadata, and installed
package/shared version metadata. The previous eight files are backed up under
work/local-spine-offset-2.0.82/before; manifest.json records before/after hashes.
The served script was checked byte-for-byte against the staged update.

This updates the local assistant's web runtime. No new installer was built,
no executable was replaced, and no online deployment was performed. The user's
open project was left intact. To retry an offset created by the previous
implementation, undo that offset first, save the project, refresh the page,
then perform the offset again. Loading an already altered track does not
reconstruct information lost by the earlier implementation.
