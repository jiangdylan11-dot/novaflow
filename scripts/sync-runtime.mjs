#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const syncEntries = [
  {
    label: 'electron-main.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main.js'),
    ],
  },
  {
    label: 'client-auth-direct.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'client-auth-direct.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'client-auth-direct.js'),
    ],
  },
  {
    label: 'main/single-instance-policy.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'single-instance-policy.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'single-instance-policy.js'),
    ],
  },
  {
    label: 'main/runtime-lifecycle.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'runtime-lifecycle.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'runtime-lifecycle.js'),
    ],
  },
  {
    label: 'main/minimax-h3-runtime-lifecycle.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'minimax-h3-runtime-lifecycle.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'minimax-h3-runtime-lifecycle.js'),
    ],
  },
  {
    label: 'main/minimax-h3-output-publisher.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'minimax-h3-output-publisher.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'minimax-h3-output-publisher.js'),
    ],
  },
  {
    label: 'main/minimax-h3-lora-catalog.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'minimax-h3-lora-catalog.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'minimax-h3-lora-catalog.js'),
    ],
  },
  {
    label: 'main/wan22-lora-catalog.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'wan22-lora-catalog.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'wan22-lora-catalog.js'),
    ],
  },
  {
    label: 'main/temp-session-lifecycle.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'temp-session-lifecycle.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'temp-session-lifecycle.js'),
    ],
  },
  {
    label: 'main/video-compositor-export.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'video-compositor-export.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'video-compositor-export.js'),
    ],
  },
  {
    label: 'main/video-resource-media.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'main', 'video-resource-media.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'video-resource-media.js'),
    ],
  },
  {
    label: 'electron-preload.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'preload.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'preload.js'),
    ],
  },
  {
    label: 'prompt-assistant-service.py',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'prompt-assistant-service.py'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'prompt-assistant-service.py'),
    ],
  },
  ...[
    '__init__.py',
    'art_prompt_contract.py',
    'visual_contract.py',
    'qwen3_vl_adapter.py',
  ].map((fileName) => ({
    label: `prompt_assistant/${fileName}`,
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'prompt_assistant', fileName),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'prompt_assistant', fileName),
    ],
  })),
  {
    label: 'admin-server/server.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'admin-server', 'server.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'admin-server', 'server.js'),
    ],
  },
  {
    label: 'admin-server/storyboard-grok.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'admin-server', 'storyboard-grok.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'admin-server', 'storyboard-grok.workflow.js'),
    ],
  },
  {
    label: 'license-admin-gui/admin-data.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'license-admin-gui', 'admin-data.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'license-admin-gui', 'admin-data.js'),
    ],
  },
  {
    label: 'license-admin-gui/renderer.js',
    sourcePath: path.join(repoRoot, 'particle-editor-desktop', 'license-admin-gui', 'renderer.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'license-admin-gui', 'renderer.js'),
    ],
  },
  {
    label: 'renderer/index.html',
    sourcePath: path.join(repoRoot, 'particle-editor', 'index.html'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'index.html'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html'),
    ],
  },
  {
    label: 'renderer/assets/index-BbIa-2NM.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'assets', 'index-BbIa-2NM.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'assets', 'index-BbIa-2NM.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'assets', 'index-BbIa-2NM.js'),
    ],
  },
  {
    label: 'runtime-fetch-proxy.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'runtime-fetch-proxy.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'runtime-fetch-proxy.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'runtime-fetch-proxy.js'),
    ],
  },
  {
    label: 'ai-background-removal-runtime.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'ai-background-removal-runtime.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-background-removal-runtime.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ai-background-removal-runtime.js'),
    ],
  },
  {
    label: 'png-remove-black.tool.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'png-remove-black.tool.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'png-remove-black.tool.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'png-remove-black.tool.js'),
    ],
  },
  ...[
    'aifx-provider.resource.js',
    'aifx-provider.tool.js',
    'aifx-prompt.workflow.js',
    'aifx-template.resource.js',
    'aifx-motion-guide.resource.js',
    'aifx-local.workflow.js',
    'aifx-generate.workflow.js',
    'aifx-rmbg.workflow.js',
    'aifx-postprocess.workflow.js',
    'aifx-temporal-conform.workflow.js',
    'aifx-material-identity.resource.js',
    'aifx-material-reconstruct.workflow.js',
    'aifx-template-materialize.workflow.js',
    'aifx-sequence-quality.workflow.js',
    'aifx-export.workflow.js',
    'aifx-repaint-runtime.js',
  ].map((fileName) => ({
    label: fileName,
    sourcePath: path.join(repoRoot, 'particle-editor', fileName),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', fileName),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', fileName),
    ],
  })),
  {
    label: 'comfyui-workflow-credit-cost.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'comfyui-workflow-credit-cost.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'comfyui-workflow-credit-cost.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'comfyui-workflow-credit-cost.js'),
    ],
  },
  {
    label: 'art-generate-model.resource.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'art-generate-model.resource.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-model.resource.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-model.resource.js'),
    ],
  },
  {
    label: 'art-generate-ideogram.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'art-generate-ideogram.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-ideogram.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-ideogram.workflow.js'),
    ],
  },
  {
    label: 'art-generate-provider.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'art-generate-provider.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-provider.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-provider.workflow.js'),
    ],
  },
  {
    label: 'left-panel-accordion.helper.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'left-panel-accordion.helper.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'left-panel-accordion.helper.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'left-panel-accordion.helper.js'),
    ],
  },
  {
    label: 'art-generate-mode.tool.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'art-generate-mode.tool.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-mode.tool.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-mode.tool.js'),
    ],
  },
  {
    label: 'art-generate-credit-pricing.tool.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'art-generate-credit-pricing.tool.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-credit-pricing.tool.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-credit-pricing.tool.js'),
    ],
  },
  {
    label: 'novaflow-client-auth.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'novaflow-client-auth.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'novaflow-client-auth.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'novaflow-client-auth.js'),
    ],
  },
  ...[
    'ui-design.structure.tool.js',
    'ui-design.inspector.tool.js',
    'ui-design.project.resource.js',
    'ui-design.preview.js',
    'ui-design-layout-guide.helper.js',
    'ui-design-local-resolution.helper.js',
    'ui-design-local.workflow.js',
    'ui-design-local-reference.helper.js',
    'ui-design-local-director.workflow.js',
    'ui-design-local-refine.workflow.js',
    'ui-design-image-preview.dialog.js',
    'ui-design.workspace.js',
    'ui-design-generate.workflow.js',
    'ui-design-quality-profile.helper.js',
    'ui-design-generate.tool.js',
    'ui-design-mode.tool.js',
    'ui-design-assistant-image.helper.js',
    'ui-design-assistant.workflow.js',
    'ui-design-assistant.dialog.js',
    'ui-design-quality-review.workflow.js',
    'ui-design.bridge.js',
  ].map((fileName) => ({
    label: fileName,
    sourcePath: path.join(repoRoot, 'particle-editor', fileName),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', fileName),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', fileName),
    ],
  })),
  {
    label: 'primary-entry-transition.preview.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'primary-entry-transition.preview.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'primary-entry-transition.preview.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'primary-entry-transition.preview.js'),
    ],
  },
  {
    label: 'primary-entry-transition.bridge.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'primary-entry-transition.bridge.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'primary-entry-transition.bridge.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'primary-entry-transition.bridge.js'),
    ],
  },
  {
    label: 'export-progress.dialog.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'export-progress.dialog.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'export-progress.dialog.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'export-progress.dialog.js'),
    ],
  },
  {
    label: 'art-generate-reference-drop.tool.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'art-generate-reference-drop.tool.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-reference-drop.tool.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-reference-drop.tool.js'),
    ],
  },
  ...[
    'ai-sequence-state-machine-runtime.js',
    'ai-sequence-video-merge.resource.js',
    'ai-sequence-video-merge.resource-bridge.js',
    'ai-sequence-video-merge.mask.tool.js',
    'ai-sequence-video-merge.preview.js',
    'ai-sequence-video-merge-export.workflow.js',
    'ai-sequence-video-merge.workspace.js',
    'ai-sequence-video-merge.tool.js',
  ].map((fileName) => ({
    label: fileName,
    sourcePath: path.join(repoRoot, 'particle-editor', fileName),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', fileName),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', fileName),
    ],
  })),
  {
    label: 'novaflow-brand-runtime.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'novaflow-brand-runtime.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'novaflow-brand-runtime.js'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'novaflow-brand-runtime.js',
      ),
    ],
  },
  {
    label: 'ai-sequence-input-compat.tool.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'ai-sequence-input-compat.tool.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-input-compat.tool.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ai-sequence-input-compat.tool.js'),
    ],
  },
  {
    label: 'resource-mention.tool.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'resource-mention.tool.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'resource-mention.tool.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'resource-mention.tool.js'),
    ],
  },
  {
    label: 'resource-mention.tool.css',
    sourcePath: path.join(repoRoot, 'particle-editor', 'resource-mention.tool.css'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'resource-mention.tool.css'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'resource-mention.tool.css'),
    ],
  },
  {
    label: 'ai-sequence-frame-mode.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'ai-sequence-frame-mode.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-frame-mode.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ai-sequence-frame-mode.js'),
    ],
  },
  ...[
    'ai-sequence-minimax-h3.resource.js',
    'ai-sequence-minimax-h3-output.resource.js',
    'ai-sequence-minimax-h3-lora.resource.js',
    'ai-sequence-wan22-lora.resource.js',
    'ai-sequence-wan22-lora.workflow.js',
    'ai-sequence-minimax-h3-prompt.workflow.js',
    'ai-sequence-minimax-h3-reverse.workflow.js',
    'ai-sequence-minimax-h3.workflow.js',
  ].map((fileName) => ({
    label: fileName,
    sourcePath: path.join(repoRoot, 'particle-editor', fileName),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', fileName),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', fileName),
    ],
  })),
  {
    label: 'ai-sequence-outpaint.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'ai-sequence-outpaint.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-outpaint.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ai-sequence-outpaint.workflow.js'),
    ],
  },
  {
    label: 'ai-sequence-credit-pricing.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'ai-sequence-credit-pricing.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-credit-pricing.js'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'ai-sequence-credit-pricing.js',
      ),
    ],
  },
  {
    label: 'vendor/jsonata/jsonata.min.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'vendor', 'jsonata', 'jsonata.min.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'jsonata', 'jsonata.min.js'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'vendor',
        'jsonata',
        'jsonata.min.js',
      ),
    ],
  },
  {
    label: 'vendor/jsonata/LICENSE',
    sourcePath: path.join(repoRoot, 'particle-editor', 'vendor', 'jsonata', 'LICENSE'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'jsonata', 'LICENSE'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'vendor',
        'jsonata',
        'LICENSE',
      ),
    ],
  },
  {
    label: 'art-quality-profile.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'art-quality-profile.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-quality-profile.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-quality-profile.workflow.js'),
    ],
  },
  {
    label: 'art-reference-compiler.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'art-reference-compiler.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-reference-compiler.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-reference-compiler.workflow.js'),
    ],
  },
  {
    label: 'smart-ai-art-auto-intent.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'smart-ai-art-auto-intent.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'smart-ai-art-auto-intent.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'smart-ai-art-auto-intent.workflow.js'),
    ],
  },
  {
    label: 'novaflow-smart-ai.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'novaflow-smart-ai.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'novaflow-smart-ai.js'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'novaflow-smart-ai.js',
      ),
    ],
  },
  {
    label: 'novaflow-source-upload-island-bridge.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'novaflow-source-upload-island-bridge.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'novaflow-source-upload-island-bridge.js'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'novaflow-source-upload-island-bridge.js',
      ),
    ],
  },
  {
    label: 'proxy-electron-api.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'proxy-electron-api.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'proxy-electron-api.js'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'proxy-electron-api.js',
      ),
    ],
  },
  {
    label: 'split-inpaint-nsfw-pixels.helper.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'split-inpaint-nsfw-pixels.helper.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'split-inpaint-nsfw-pixels.helper.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'split-inpaint-nsfw-pixels.helper.js'),
    ],
  },
  {
    label: 'split-inpaint-nsfw.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'split-inpaint-nsfw.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'split-inpaint-nsfw.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'split-inpaint-nsfw.workflow.js'),
    ],
  },
  {
    label: 'storyboard-director-quality.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'storyboard-director-quality.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'storyboard-director-quality.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'storyboard-director-quality.workflow.js'),
    ],
  },
  {
    label: 'storyboard-resource.workflow.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'storyboard-resource.workflow.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'storyboard-resource.workflow.js'),
      path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'storyboard-resource.workflow.js'),
    ],
  },
  {
    label: 'spine-split-runtime.js',
    sourcePath: path.join(repoRoot, 'particle-editor', 'spine-split-runtime.js'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'spine-split-runtime.js'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'spine-split-runtime.js',
      ),
    ],
  },
  {
    label: 'vendor/opencv/index.web.mjs',
    sourcePath: path.join(repoRoot, 'particle-editor', 'vendor', 'opencv', 'index.web.mjs'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'opencv', 'index.web.mjs'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'vendor',
        'opencv',
        'index.web.mjs',
      ),
    ],
  },
  {
    label: 'vendor/opencv/opencv_js.wasm',
    sourcePath: path.join(repoRoot, 'particle-editor', 'vendor', 'opencv', 'opencv_js.wasm'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'opencv', 'opencv_js.wasm'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'vendor',
        'opencv',
        'opencv_js.wasm',
      ),
    ],
    binary: true,
  },
  {
    label: 'vendor/opencv/LICENSE',
    sourcePath: path.join(repoRoot, 'particle-editor', 'vendor', 'opencv', 'LICENSE'),
    targetPaths: [
      path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'opencv', 'LICENSE'),
      path.join(
        repoRoot,
        'particle-editor-desktop',
        'dist',
        'win-unpacked',
        'resources',
        'app',
        'renderer',
        'vendor',
        'opencv',
        'LICENSE',
      ),
    ],
  },
]

const retiredRuntimeArtifacts = [
  path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-cloud-workflow.js'),
  path.join(
    repoRoot,
    'particle-editor-desktop',
    'dist',
    'win-unpacked',
    'resources',
    'app',
    'renderer',
    'ai-sequence-cloud-workflow.js',
  ),
  path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ui-design-layout-analysis.workflow.js'),
  path.join(
    repoRoot,
    'particle-editor-desktop',
    'dist',
    'win-unpacked',
    'resources',
    'app',
    'renderer',
    'ui-design-layout-analysis.workflow.js',
  ),
]

function relativePath(filePath) {
  return path.relative(repoRoot, filePath)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function assertUtf8(buffer) {
  new TextDecoder('utf-8', { fatal: true }).decode(buffer)
}

async function targetMode(targetPath, fallbackMode) {
  try {
    const existing = await stat(targetPath)
    return existing.mode
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error
    }
    return fallbackMode
  }
}

async function syncTarget(targetPath, sourceBuffer, sourceMode) {
  const mode = await targetMode(targetPath, sourceMode)
  const sourceHash = sha256(sourceBuffer)

  try {
    const existingBuffer = await readFile(targetPath)
    if (sha256(existingBuffer) === sourceHash) {
      console.log(`sync-runtime: up to date ${targetPath}`)
      return
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error
    }
  }

  console.log(`sync-runtime: overwriting ${targetPath}`)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, sourceBuffer)
  await chmod(targetPath, mode)

  const targetBuffer = await readFile(targetPath)
  const targetHash = sha256(targetBuffer)
  if (targetHash !== sourceHash) {
    throw new Error(`SHA256 mismatch after sync: ${relativePath(targetPath)}`)
  }
}

async function syncEntry(entry) {
  const sourceBuffer = await readFile(entry.sourcePath)
  if (!entry.binary) assertUtf8(sourceBuffer)

  const sourceStats = await stat(entry.sourcePath)
  const sourceHash = sha256(sourceBuffer)

  for (const targetPath of entry.targetPaths) {
    await syncTarget(targetPath, sourceBuffer, sourceStats.mode)
  }

  console.log(`sync-runtime: ${entry.label} SHA256 ${sourceHash}`)
}

async function main() {
  for (const entry of syncEntries) {
    await syncEntry(entry)
  }

  for (const artifactPath of retiredRuntimeArtifacts) {
    await rm(artifactPath, { force: true })
    console.log(`sync-runtime: removed retired artifact ${relativePath(artifactPath)}`)
  }

  console.log('sync-runtime: completed')
}

main().catch((error) => {
  console.error(`sync-runtime: ${error && error.message ? error.message : error}`)
  process.exitCode = 1
})
