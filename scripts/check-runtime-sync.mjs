#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spineWebpRuntimeFiles } from './spine-webp-runtime-files.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const runtimeGroups = [
  ...[...spineWebpRuntimeFiles, 'main/birefnet-runner.py', 'main/cutout-raw-encoder.js', 'main/cutout-mask-stream.js'].map((file) => ({
    name: file,
    files: [
      { label: 'desktop runtime file', path: path.join(repoRoot, 'particle-editor-desktop', file), dependencyManifest: file.endsWith('/package.json') },
      { label: 'win-unpacked runtime file', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', file), dependencyManifest: file.endsWith('/package.json') },
    ],
  })),
  {
    name: 'electron-main.js',
    files: [
      {
        label: 'desktop main',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main.js'),
      },
      {
        label: 'win-unpacked main',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main.js'),
      },
    ],
  },
  {
    name: 'client-auth-direct.js',
    files: [
      {
        label: 'desktop direct auth backend',
        path: path.join(repoRoot, 'particle-editor-desktop', 'client-auth-direct.js'),
      },
      {
        label: 'win-unpacked direct auth backend',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'client-auth-direct.js'),
      },
    ],
  },
  {
    name: 'main/single-instance-policy.js',
    files: [
      {
        label: 'desktop single-instance policy',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'single-instance-policy.js'),
      },
      {
        label: 'win-unpacked single-instance policy',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'single-instance-policy.js'),
      },
    ],
  },
  {
    name: 'main/runtime-lifecycle.js',
    files: [
      {
        label: 'desktop Runtime lifecycle',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'runtime-lifecycle.js'),
      },
      {
        label: 'win-unpacked Runtime lifecycle',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'runtime-lifecycle.js'),
      },
    ],
  },
  {
    name: 'main/spine-atlas-webp-converter.js',
    files: [
      {
        label: 'desktop SPINE atlas WebP converter',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'spine-atlas-webp-converter.js'),
      },
      {
        label: 'win-unpacked SPINE atlas WebP converter',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'spine-atlas-webp-converter.js'),
      },
    ],
  },
  {
    name: 'electron-preload.js',
    files: [
      {
        label: 'desktop preload',
        path: path.join(repoRoot, 'particle-editor-desktop', 'preload.js'),
      },
      {
        label: 'win-unpacked preload',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'preload.js'),
      },
    ],
  },
  {
    name: 'prompt-assistant-service.py',
    files: [
      {
        label: 'desktop prompt assistant service',
        path: path.join(repoRoot, 'particle-editor-desktop', 'prompt-assistant-service.py'),
      },
      {
        label: 'win-unpacked prompt assistant service',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'prompt-assistant-service.py'),
      },
    ],
  },
  ...[
    '__init__.py',
    'art_prompt_contract.py',
    'visual_contract.py',
    'qwen3_vl_adapter.py',
    'h3_prompt_enhance.py',
    'h3_prompt_enhance_policy.json',
  ].map((fileName) => ({
    name: `prompt_assistant/${fileName}`,
    files: [
      {
        label: `desktop prompt assistant ${fileName}`,
        path: path.join(repoRoot, 'particle-editor-desktop', 'prompt_assistant', fileName),
      },
      {
        label: `win-unpacked prompt assistant ${fileName}`,
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'prompt_assistant', fileName),
      },
    ],
  })),
  {
    name: 'admin-server/server.js',
    files: [
      {
        label: 'desktop admin server',
        path: path.join(repoRoot, 'particle-editor-desktop', 'admin-server', 'server.js'),
      },
      {
        label: 'win-unpacked admin server',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'admin-server', 'server.js'),
      },
    ],
  },
  {
    name: 'admin-server/h3-prompt-enhance.js',
    files: [
      { label: 'desktop H3 optimizer', path: path.join(repoRoot, 'particle-editor-desktop', 'admin-server', 'h3-prompt-enhance.js') },
      { label: 'runtime H3 optimizer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'admin-server', 'h3-prompt-enhance.js') },
    ],
  },
  {
    name: 'admin-server/storyboard-grok.workflow.js',
    files: [
      {
        label: 'desktop Grok storyboard workflow',
        path: path.join(repoRoot, 'particle-editor-desktop', 'admin-server', 'storyboard-grok.workflow.js'),
      },
      {
        label: 'win-unpacked Grok storyboard workflow',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'admin-server', 'storyboard-grok.workflow.js'),
      },
    ],
  },
  {
    name: 'license-admin-gui/admin-data.js',
    files: [
      {
        label: 'desktop admin data',
        path: path.join(repoRoot, 'particle-editor-desktop', 'license-admin-gui', 'admin-data.js'),
      },
      {
        label: 'win-unpacked admin data',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'license-admin-gui', 'admin-data.js'),
      },
    ],
  },
  {
    name: 'license-admin-gui/renderer.js',
    files: [
      {
        label: 'desktop admin renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'license-admin-gui', 'renderer.js'),
      },
      {
        label: 'win-unpacked admin renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'license-admin-gui', 'renderer.js'),
      },
    ],
  },
  {
    name: 'renderer/index.html',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'index.html'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'index.html'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html'),
      },
    ],
  },
  {
    name: 'main/minimax-h3-runtime-lifecycle.js',
    files: [
      {
        label: 'desktop MiniMax H3 Runtime lifecycle',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'minimax-h3-runtime-lifecycle.js'),
      },
      {
        label: 'win-unpacked MiniMax H3 Runtime lifecycle',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'minimax-h3-runtime-lifecycle.js'),
      },
    ],
  },
  {
    name: 'main/minimax-h3-output-publisher.js',
    files: [
      {
        label: 'desktop MiniMax H3 output publisher',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'minimax-h3-output-publisher.js'),
      },
      {
        label: 'win-unpacked MiniMax H3 output publisher',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'minimax-h3-output-publisher.js'),
      },
    ],
  },
  {
    name: 'main/minimax-h3-lora-catalog.js',
    files: [
      {
        label: 'desktop MiniMax H3 LoRA catalog',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'minimax-h3-lora-catalog.js'),
      },
      {
        label: 'win-unpacked MiniMax H3 LoRA catalog',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'minimax-h3-lora-catalog.js'),
      },
    ],
  },
  {
    name: 'main/qwen-lora-catalog.js',
    files: [
      {
        label: 'desktop Qwen LoRA catalog',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'qwen-lora-catalog.js'),
      },
      {
        label: 'win-unpacked Qwen LoRA catalog',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'qwen-lora-catalog.js'),
      },
    ],
  },  {
    name: 'main/wan22-lora-catalog.js',
    files: [
      {
        label: 'desktop Wan2.2 LoRA catalog',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'wan22-lora-catalog.js'),
      },
      {
        label: 'win-unpacked Wan2.2 LoRA catalog',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'wan22-lora-catalog.js'),
      },
    ],
  },
  {
    name: 'main/temp-session-lifecycle.js',
    files: [
      {
        label: 'desktop temp session lifecycle',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'temp-session-lifecycle.js'),
      },
      {
        label: 'win-unpacked temp session lifecycle',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'temp-session-lifecycle.js'),
      },
    ],
  },
  {
    name: 'main/video-compositor-export.js',
    files: [
      {
        label: 'desktop video compositor export',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'video-compositor-export.js'),
      },
      {
        label: 'win-unpacked video compositor export',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'video-compositor-export.js'),
      },
    ],
  },
  {
    name: 'main/video-resource-media.js',
    files: [
      {
        label: 'desktop video resource media',
        path: path.join(repoRoot, 'particle-editor-desktop', 'main', 'video-resource-media.js'),
      },
      {
        label: 'win-unpacked video resource media',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'main', 'video-resource-media.js'),
      },
    ],
  },
  ...[
    'aifx-prompt.workflow.js',
    'aifx-local.workflow.js',
    'aifx-generate.workflow.js',
    'aifx-temporal-conform.workflow.js',
    'aifx-material-identity.resource.js',
    'aifx-material-reconstruct.workflow.js',
    'aifx-export.workflow.js',
    'aifx-repaint-runtime.js',
  ].map((fileName) => ({
    name: `renderer/${fileName}`,
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', fileName) },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', fileName) },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', fileName) },
    ],
  })),
  {
    name: 'renderer/assets/index-BbIa-2NM.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'assets', 'index-BbIa-2NM.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'assets', 'index-BbIa-2NM.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'assets', 'index-BbIa-2NM.js') },
    ],
  },
  {
    name: 'runtime-fetch-proxy.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'runtime-fetch-proxy.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'runtime-fetch-proxy.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'runtime-fetch-proxy.js'),
      },
    ],
  },
  {
    name: 'comfyui-workflow-credit-cost.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'comfyui-workflow-credit-cost.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'comfyui-workflow-credit-cost.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'comfyui-workflow-credit-cost.js'),
      },
    ],
  },
  {
    name: 'art-generate-lora.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-generate-lora.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-lora.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-lora.js') },
    ],
  },
  {
    name: 'art-generate-model.resource.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-generate-model.resource.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-model.resource.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-model.resource.js') },
    ],
  },
  {
    name: 'art-generate-ideogram.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-generate-ideogram.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-ideogram.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-ideogram.workflow.js') },
    ],
  },
  {
    name: 'art-generate-provider.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-generate-provider.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-provider.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-provider.workflow.js') },
    ],
  },
  {
    name: 'left-panel-accordion.helper.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'left-panel-accordion.helper.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'left-panel-accordion.helper.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'left-panel-accordion.helper.js') },
    ],
  },
  {
    name: 'art-generate-mode.tool.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-generate-mode.tool.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-mode.tool.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-mode.tool.js') },
    ],
  },
  {
    name: 'art-generate-credit-pricing.tool.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-generate-credit-pricing.tool.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-credit-pricing.tool.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-credit-pricing.tool.js') },
    ],
  },
  {
    name: 'novaflow-client-auth.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'novaflow-client-auth.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'novaflow-client-auth.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'novaflow-client-auth.js') },
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
    name: fileName,
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', fileName) },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', fileName) },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', fileName) },
    ],
  })),
  {
    name: 'primary-entry-transition.preview.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'primary-entry-transition.preview.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'primary-entry-transition.preview.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'primary-entry-transition.preview.js') },
    ],
  },
  {
    name: 'primary-entry-transition.bridge.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'primary-entry-transition.bridge.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'primary-entry-transition.bridge.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'primary-entry-transition.bridge.js') },
    ],
  },
  {
    name: 'export-progress.dialog.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'export-progress.dialog.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'export-progress.dialog.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'export-progress.dialog.js') },
    ],
  },
  {
    name: 'art-generate-reference-drop.tool.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-generate-reference-drop.tool.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-generate-reference-drop.tool.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-generate-reference-drop.tool.js') },
    ],
  },
  ...[
    'ai-sequence-green-screen-matting.js',
    'ai-sequence-matting-worker.js',
    'ai-sequence-cutout-pipeline.js',
    'ai-sequence-state-machine-runtime.js',
    'ai-sequence-video-merge.resource.js',
    'ai-sequence-video-merge.resource-bridge.js',
    'ai-sequence-video-merge.mask.tool.js',
    'ai-sequence-video-merge.preview.js',
    'ai-sequence-video-merge-export.workflow.js',
    'ai-sequence-video-merge.workspace.js',
    'ai-sequence-video-merge.tool.js',
  ].map((fileName) => ({
    name: fileName,
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', fileName) },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', fileName) },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', fileName) },
    ],
  })),
  {
    name: 'novaflow-brand-runtime.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'novaflow-brand-runtime.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'novaflow-brand-runtime.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
          repoRoot,
          'particle-editor-desktop',
          'dist',
          'win-unpacked',
          'resources',
          'app',
          'renderer',
          'novaflow-brand-runtime.js',
        ),
      },
    ],
  },
  {
    name: 'ai-sequence-input-compat.tool.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'ai-sequence-input-compat.tool.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-input-compat.tool.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ai-sequence-input-compat.tool.js') },
    ],
  },
  {
    name: 'resource-mention.tool.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'resource-mention.tool.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'resource-mention.tool.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'resource-mention.tool.js') },
    ],
  },
  {
    name: 'resource-mention.tool.css',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'resource-mention.tool.css') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'resource-mention.tool.css') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'resource-mention.tool.css') },
    ],
  },
  {
    name: 'ai-sequence-frame-mode.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'ai-sequence-frame-mode.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-frame-mode.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ai-sequence-frame-mode.js') },
    ],
  },
  ...[
    'ai-sequence-minimax-h3.resource.js',
    'ai-sequence-minimax-h3-output.resource.js',
    'ai-sequence-minimax-h3-lora.resource.js',
    'ai-sequence-wan22-lora.resource.js',
    'ai-sequence-wan22-lora.workflow.js',
    'h3-prompt-format.js',
    'ai-sequence-minimax-h3-prompt.workflow.js',
    'ai-sequence-minimax-h3-reverse.workflow.js',
    'ai-sequence-minimax-h3.workflow.js',
  ].map((fileName) => ({
    name: fileName,
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', fileName) },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', fileName) },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', fileName) },
    ],
  })),
  {
    name: 'ai-sequence-outpaint.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'ai-sequence-outpaint.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-outpaint.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ai-sequence-outpaint.workflow.js') },
    ],
  },
  {
    name: 'ai-sequence-credit-pricing.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'ai-sequence-credit-pricing.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ai-sequence-credit-pricing.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
          repoRoot,
          'particle-editor-desktop',
          'dist',
          'win-unpacked',
          'resources',
          'app',
          'renderer',
          'ai-sequence-credit-pricing.js',
        ),
      },
    ],
  },
  {
    name: 'vendor/jsonata/jsonata.min.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'vendor', 'jsonata', 'jsonata.min.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'jsonata', 'jsonata.min.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
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
      },
    ],
  },
  {
    name: 'vendor/jsonata/LICENSE',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'vendor', 'jsonata', 'LICENSE'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'jsonata', 'LICENSE'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
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
      },
    ],
  },
  {
    name: 'art-quality-profile.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-quality-profile.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-quality-profile.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-quality-profile.workflow.js') },
    ],
  },
  {
    name: 'art-reference-compiler.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'art-reference-compiler.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'art-reference-compiler.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'art-reference-compiler.workflow.js') },
    ],
  },
  {
    name: 'smart-ai-art-auto-intent.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'smart-ai-art-auto-intent.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'smart-ai-art-auto-intent.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'smart-ai-art-auto-intent.workflow.js') },
    ],
  },
  {
    name: 'novaflow-smart-ai.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'novaflow-smart-ai.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'novaflow-smart-ai.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
          repoRoot,
          'particle-editor-desktop',
          'dist',
          'win-unpacked',
          'resources',
          'app',
          'renderer',
          'novaflow-smart-ai.js',
        ),
      },
    ],
  },
  {
    name: 'novaflow-source-upload-island-bridge.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'novaflow-source-upload-island-bridge.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'novaflow-source-upload-island-bridge.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
          repoRoot,
          'particle-editor-desktop',
          'dist',
          'win-unpacked',
          'resources',
          'app',
          'renderer',
          'novaflow-source-upload-island-bridge.js',
        ),
      },
    ],
  },
  {
    name: 'proxy-electron-api.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'proxy-electron-api.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'proxy-electron-api.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
          repoRoot,
          'particle-editor-desktop',
          'dist',
          'win-unpacked',
          'resources',
          'app',
          'renderer',
          'proxy-electron-api.js',
        ),
      },
    ],
  },
  {
    name: 'split-inpaint-nsfw-pixels.helper.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'split-inpaint-nsfw-pixels.helper.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'split-inpaint-nsfw-pixels.helper.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'split-inpaint-nsfw-pixels.helper.js') },
    ],
  },
  {
    name: 'split-inpaint-nsfw.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'split-inpaint-nsfw.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'split-inpaint-nsfw.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'split-inpaint-nsfw.workflow.js') },
    ],
  },
  {
    name: 'storyboard-director-quality.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'storyboard-director-quality.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'storyboard-director-quality.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'storyboard-director-quality.workflow.js') },
    ],
  },
  {
    name: 'storyboard-resource.workflow.js',
    files: [
      { label: 'source', path: path.join(repoRoot, 'particle-editor', 'storyboard-resource.workflow.js') },
      { label: 'desktop renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'storyboard-resource.workflow.js') },
      { label: 'win-unpacked renderer', path: path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'storyboard-resource.workflow.js') },
    ],
  },
  {
    name: 'spine-split-runtime.js',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'spine-split-runtime.js'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'spine-split-runtime.js'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
          repoRoot,
          'particle-editor-desktop',
          'dist',
          'win-unpacked',
          'resources',
          'app',
          'renderer',
          'spine-split-runtime.js',
        ),
      },
    ],
  },
  {
    name: 'vendor/opencv/index.web.mjs',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'vendor', 'opencv', 'index.web.mjs'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'opencv', 'index.web.mjs'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
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
      },
    ],
  },
  {
    name: 'vendor/opencv/opencv_js.wasm',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'vendor', 'opencv', 'opencv_js.wasm'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'opencv', 'opencv_js.wasm'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
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
      },
    ],
  },
  {
    name: 'vendor/opencv/LICENSE',
    files: [
      {
        label: 'source',
        path: path.join(repoRoot, 'particle-editor', 'vendor', 'opencv', 'LICENSE'),
      },
      {
        label: 'desktop renderer',
        path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'vendor', 'opencv', 'LICENSE'),
      },
      {
        label: 'win-unpacked renderer',
        path: path.join(
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
      },
    ],
  },
]

const retiredRuntimeArtifacts = [
  {
    label: 'source UI layout analysis workflow',
    path: path.join(repoRoot, 'particle-editor', 'ui-design-layout-analysis.workflow.js'),
  },
  {
    label: 'desktop renderer UI layout analysis workflow',
    path: path.join(repoRoot, 'particle-editor-desktop', 'renderer', 'ui-design-layout-analysis.workflow.js'),
  },
  {
    label: 'win-unpacked UI layout analysis workflow',
    path: path.join(
      repoRoot,
      'particle-editor-desktop',
      'dist',
      'win-unpacked',
      'resources',
      'app',
      'renderer',
      'ui-design-layout-analysis.workflow.js',
    ),
  },
]

function relativePath(filePath) {
  return path.relative(repoRoot, filePath)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function hashRuntimeFile(file) {
  try {
    let buffer = await readFile(file.path)
    if (file.dependencyManifest) {
      // electron-builder strips these development-only fields from dependencies.
      const manifest = JSON.parse(buffer.toString('utf8'))
      delete manifest.scripts
      delete manifest.keywords
      buffer = Buffer.from(JSON.stringify(manifest))
    }
    return {
      ...file,
      hash: sha256(buffer),
      ok: true,
    }
  } catch (error) {
    return {
      ...file,
      error,
      ok: false,
    }
  }
}

async function checkGroup(group) {
  const results = await Promise.all(group.files.map(hashRuntimeFile))
  const source = results[0]
  const failedReads = results.filter((result) => !result.ok)

  if (failedReads.length > 0 || !source.ok) {
    console.error(`[${group.name}]`)
    for (const result of failedReads) {
      const reason = result.error && result.error.message ? result.error.message : result.error
      console.error(`[MISSING] ${result.label}: ${relativePath(result.path)} (${reason})`)
    }
    return false
  }

  const mismatches = results.filter((result) => result.hash !== source.hash)

  if (mismatches.length > 0) {
    console.error(`[${group.name}]`)
    console.error(`[SOURCE] ${source.hash}  ${relativePath(source.path)}`)
    for (const result of mismatches) {
      console.error(`[MISMATCH] ${result.hash}  ${relativePath(result.path)}`)
    }
    return false
  }

  console.log(`[${group.name}]`)
  for (const result of results) {
    console.log(`${result.hash}  ${relativePath(result.path)}`)
  }
  return true
}

async function checkRetiredArtifact(artifact) {
  try {
    await readFile(artifact.path)
    console.error(`[RETIRED PRESENT] ${artifact.label}: ${relativePath(artifact.path)}`)
    return false
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`[RETIRED ABSENT] ${artifact.label}: ${relativePath(artifact.path)}`)
      return true
    }
    const reason = error && error.message ? error.message : error
    console.error(`[RETIRED CHECK FAILED] ${artifact.label}: ${relativePath(artifact.path)} (${reason})`)
    return false
  }
}

async function main() {
  const results = await Promise.all([
    ...runtimeGroups.map(checkGroup),
    ...retiredRuntimeArtifacts.map(checkRetiredArtifact),
  ])
  if (results.every(Boolean)) {
    console.log('PASS')
    return 0
  }
  console.error('FAIL')
  return 1
}

process.exitCode = await main()
