# SmoothMix quality parameter check

Six actual outputs compare 0.35 strength on the anime character and cyber portrait, with 7/12 steps and shift 8/3. All returned workflows were checked against execution histories.

Manual inspection found almost no material quality gain from increasing 7 to 12 steps. Shift 3 preserved more of the source but also reduced redraw; it is not proof of solving high-strength color drift. No default was changed.

The user requested a direct original-Wan comparison while these tests were completing. That comparison is now the main decision artifact: `../wan-vs-smoothmix-wash-validation/index.html`. Original output files and run histories are preserved here.
