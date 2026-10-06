// Workflow selection and parameter injection (spec 10).
//
// The browser sends {task_type, parameters}. It never sees, sends or names a
// ComfyUI graph. The worker maps task_type -> workflows/<file>.json and binds
// the validated parameters into explicitly declared slots.
//
// Bindings are declarative rather than string placeholders so a template stays
// a valid ComfyUI API graph you can paste straight into ComfyUI to debug, and
// so an unknown parameter can never reach a node by accident.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TASK_TYPE_WORKFLOW } from '../../../packages/shared/src/protocol.mjs';
import { audioRepromptPrompt } from './audio-reprompt.mjs';

export async function loadWorkflow(workflowDir, taskType) {
  const file = TASK_TYPE_WORKFLOW[String(taskType)];
  if (!file) throw new Error('no workflow registered for task type ' + taskType);
  const raw = await readFile(join(workflowDir, file), 'utf8');
  const template = JSON.parse(raw);
  if (!template?.graph || typeof template.graph !== 'object') {
    throw new Error('workflow ' + file + ' has no graph');
  }
  return template;
}

/**
 * Bind parameters into a copy of the template graph.
 *
 * `extra` supplies values the control plane does not send but the worker
 * derives, e.g. the frame `length` for video and the resolved reference
 * filenames already uploaded into ComfyUI's input folder.
 */
export function buildGraph(template, parameters, extra = {}) {
  const graph = JSON.parse(JSON.stringify(template.graph));
  const values = { ...parameters, ...extra };

  for (const [key, binding] of Object.entries(template.bindings || {})) {
    if (!(key in values)) continue;
    const value = values[key];
    if (value === undefined || value === null) continue;
    const node = graph[binding.node];
    if (!node) throw new Error('workflow binding points at missing node ' + binding.node);
    node.inputs[binding.input] = value;
  }

  // A seed of -1 means "surprise me". Resolve it here so the value we report
  // back is the seed that actually ran.
  for (const [key, binding] of Object.entries(template.bindings || {})) {
    if (key !== 'seed') continue;
    const node = graph[binding.node];
    const current = Number(node.inputs[binding.input]);
    if (!Number.isFinite(current) || current < 0) {
      node.inputs[binding.input] = Math.floor(Math.random() * 2 ** 31);
    }
  }

  for (const ref of template.references || []) {
    const uploaded = (extra.referenceFilenames || [])[ref.index];
    if (!uploaded) continue;
    const node = graph[ref.node];
    if (node) node.inputs[ref.input] = uploaded;
  }

  return graph;
}

/** The seed that ended up in the graph, so it can be reported to the user. */
export function resolvedSeed(template, graph) {
  const binding = template.bindings?.seed;
  if (!binding) return null;
  return Number(graph[binding.node]?.inputs?.[binding.input] ?? 0);
}

/**
 * H3 counts frames, not seconds. Convert here rather than making the browser
 * know the model's frame arithmetic.
 */
export function videoFrameLength(durationSeconds, fps) {
  const frames = Math.round(Math.max(1, Number(durationSeconds) || 5) * (Number(fps) || 24));
  // The H3 pipeline wants 4n+... style lengths; the stable Desktop line uses
  // 124 for ~5s at 24fps. Snap to the same 4k+4 grid so the latent shape is
  // one the model accepts.
  return Math.max(4, Math.round(frames / 4) * 4 + 4);
}

/**
 * 音频: the caption the model reads and the length it renders.
 *
 * The model takes its target length from the text as well as from the latent,
 * so the two are written together here rather than trusted to the panel. A
 * loop renders longer than the loop itself: the seam node needs audio past
 * the cut point to blend the head into, and the model's own ending (a final
 * chord, a fade) must fall outside the loop.
 */
export function audioGraphExtras(taskType, parameters) {
  const p = parameters || {};
  const duration = Math.max(1, Number(p.duration_seconds) || 1);
  const music = String(taskType) === 'audio_music';
  const loop = music && p.loop !== false;
  const generateSeconds = loop
    ? Math.min(300, duration + Math.max(2, Math.round((Number(p.crossfade_ms) || 800) / 1000 + 2)))
    : duration;
  const body = String(p.prompt || '').trim().replace(/\s*Length:\s*\d+\s*seconds?\.?\s*$/i, '').replace(/[\s.,;]+$/, '');
  const caption = body + '. Length: ' + Math.round(generateSeconds) + ' seconds';
  return {
    caption_fallback: caption,
    generate_seconds: Math.round(generateSeconds * 10) / 10,
    caption_seconds: Math.round(generateSeconds * 10) / 10,
    caption_bpm: music ? Math.max(0, Math.floor(Number(p.bpm) || 0)) : 0,
    reprompt: p.reprompt !== false,
    reprompt_prompt: audioRepromptPrompt(music ? 'music' : 'sfx', body, generateSeconds)
  };
}
