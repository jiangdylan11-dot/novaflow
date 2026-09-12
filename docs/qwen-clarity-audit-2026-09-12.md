# Qwen clarity comparison after FP8 migration

The user observed softer character details with ordinary image editing than with the NSFW/Rapid route. Both actual outputs were 1056 x 1488 and used 4 sampling steps. The latest ordinary and Rapid runs had identical positive and negative prompts and the same reference `a.jpg`, but different seeds and different model/sampler/conditioning pipelines.

- Ordinary FP8: `9eb63bcb-db5f-4584-88ff-9ea9adab6bf6`, Edit 2511 FP8 mixed, Lightning 4-step, Euler/simple, CFG 1, seed 464710836.
- Rapid: `b60d6b9a-6e1b-416a-a5b2-fc2e823b047f`, Rapid AIO NSFW v20, Euler ancestral/beta, CFG 1, seed 398768004.
- Controlled BF16: `b5d58cb1-598e-4d56-9510-f87f27025669`, success. Cloned the ordinary submitted graph, changed only UNET filename and output filename prefix. Seed, prompts, reference, sampling, Lightning and resolution were retained.

Visual inspection of the full PNGs found similarly soft facial/hair/accessory rendering in FP8 and BF16, while the supplied Rapid output had stronger fine edges and detail separation. BF16 did not visibly restore Rapid-level crispness in this sample. This supports a model/pipeline explanation over a major FP8 precision regression for this image, but one sample cannot establish quality parity across all tasks. No automatic sharpening or installed-workflow changes were made during the comparison.

BF16 control image: `../.tmp-qwen-clarity-bf16.png`. Original FP8 comparison: `../.tmp-qwen-clarity-1.png`. Rapid comparison: `../.tmp-qwen-clarity-2.png`.
