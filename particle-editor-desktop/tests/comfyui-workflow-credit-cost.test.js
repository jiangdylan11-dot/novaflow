const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function klingStoryboardWorkflow(duration) {
  return {
    prompt: {
      "31": {
        class_type: "KlingVideoNode",
        inputs: {
          "model.resolution": "720p",
          generate_audio: true,
          multi_shot: "1 storyboard",
          "multi_shot.storyboard_1_duration": duration
        }
      }
    }
  };
}

async function main() {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, "../../particle-editor/comfyui-workflow-credit-cost.js"));
  await import(`${moduleUrl.href}?test=${Date.now()}`);
  const pricing = globalThis.NovaFlowComfyWorkflowCreditCost;
  assert.ok(pricing && typeof pricing.estimateWorkflowCreditCost === "function");
  assert.ok(
    pricing.SUPPORTED_NODE_TYPES.includes("KlingOmniProImageToVideoNode"),
    "the settlement authority must recognize the actual Kling reference node",
  );
  const imageProviderNodeTypes = [
    "OpenAIGPTImage1",
    "OpenAIGPTImageNodeV2",
    "GeminiImageNode",
    "GeminiImage2Node",
  ];
  for (const nodeType of imageProviderNodeTypes) {
    assert.ok(
      pricing.SUPPORTED_NODE_TYPES.includes(nodeType),
      `the settlement authority must recognize ${nodeType}`,
    );
  }

  const imageProvider = pricing.estimateWorkflowCreditCost({
    prompt: {
      "8": {
        class_type: "OpenAIGPTImageNodeV2",
        inputs: { model: "gpt-image-2", credit_cost: 42.25 },
      },
    },
  });
  assert.equal(imageProvider.providerKey, "comfyui");
  assert.equal(imageProvider.taskType, "local_workflow_image");
  assert.equal(imageProvider.workflowNodeType, "OpenAIGPTImageNodeV2");
  assert.equal(imageProvider.modelKey, "gpt-image-2", "pending settlement must preserve the actual selected image model");
  assert.equal(imageProvider.known, false);
  assert.equal(imageProvider.estimatedCreditCost, 0);
  assert.equal(imageProvider.creditCost, 0);
  assert.equal(imageProvider.pricingStatus, "pending_pricing");
  assert.equal(imageProvider.pricingSource, "unknown");

  const fifteenSeconds = pricing.estimateWorkflowCreditCost(klingStoryboardWorkflow(15));
  assert.equal(fifteenSeconds.known, true);
  assert.equal(fifteenSeconds.workflowNodeType, "KlingVideoNode");
  assert.ok(Math.abs(fifteenSeconds.estimatedCreditCost - 398.79) < 1e-9);
  assert.equal(fifteenSeconds.creditCost, 399);
  assert.equal(fifteenSeconds.pricingStatus, "known");

  const tenSeconds = pricing.estimateWorkflowCreditCost(klingStoryboardWorkflow(10));
  assert.ok(Math.abs(tenSeconds.estimatedCreditCost - 265.86) < 1e-9);
  assert.equal(tenSeconds.creditCost, 266);

  const omni = pricing.estimateWorkflowCreditCost({
    prompt: {
      "21": {
        class_type: "KlingOmniProImageToVideoNode",
        inputs: {
          model_name: "kling-v3-omni",
          resolution: "720p",
          duration: 4,
          generate_audio: true,
        },
      },
    },
  });
  assert.equal(omni.known, true);
  assert.equal(omni.workflowNodeType, "KlingOmniProImageToVideoNode");
  assert.ok(Math.abs(omni.estimatedCreditCost - 94.528) < 1e-9);
  assert.equal(omni.creditCost, 95);
  assert.equal(omni.pricingSource, "kling_omni_static_v1");

  const seedanceStrict = pricing.estimateWorkflowCreditCost({
    prompt: {
      "2": {
        class_type: "ByteDance2FirstLastFrameNode",
        inputs: {
          model: "Seedance 2.0",
          "model.resolution": "480p",
          "model.duration": 7,
        },
      },
    },
  });
  assert.equal(seedanceStrict.known, true);
  assert.equal(seedanceStrict.workflowNodeType, "ByteDance2FirstLastFrameNode");
  assert.ok(Math.abs(seedanceStrict.estimatedCreditCost - 148.49822988) < 1e-9);
  assert.equal(seedanceStrict.creditCost, 149);
  assert.equal(seedanceStrict.pricingSource, "jimeng_static_v1");

  const seedanceMinimum = pricing.estimateWorkflowCreditCost({
    prompt: {
      "2": {
        class_type: "ByteDance2FirstLastFrameNode",
        inputs: {
          model: "Seedance 2.0",
          "model.resolution": "480p",
          "model.duration": 1,
        },
      },
    },
  });
  assert.ok(Math.abs(seedanceMinimum.estimatedCreditCost - 84.85613136) < 1e-9);
  assert.equal(seedanceMinimum.creditCost, 85);

  const explicit = pricing.estimateWorkflowCreditCost({
    prompt: {
      "8": {
        class_type: "KlingVideoNode",
        inputs: { credit_cost: 42.25 }
      }
    }
  });
  assert.equal(explicit.estimatedCreditCost, 42.25);
  assert.equal(explicit.creditCost, 43);
  assert.equal(explicit.pricingSource, "workflow_explicit");

  const unknown = pricing.estimateWorkflowCreditCost({
    prompt: {
      "1": { class_type: "UnknownComfyCloudNode", inputs: {} }
    }
  }, { allowCloudPrompt: true });
  assert.equal(unknown.known, false);
  assert.equal(unknown.estimatedCreditCost, 0);
  assert.equal(unknown.creditCost, 0);
  assert.equal(unknown.pricingStatus, "pending_pricing");

  const multipleProviderNodes = pricing.estimateWorkflowCreditCost({
    prompt: {
      "1": klingStoryboardWorkflow(10).prompt["31"],
      "2": klingStoryboardWorkflow(15).prompt["31"]
    }
  });
  assert.equal(multipleProviderNodes.known, false);
  assert.equal(multipleProviderNodes.creditCost, 0);
  assert.equal(multipleProviderNodes.pricingStatus, "pending_pricing");

  console.log("comfyui workflow credit cost tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
