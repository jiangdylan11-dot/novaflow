// Strip retired workflow templates out of the prebuilt React bundle.
//
// The bundle carries complete WAN 2.2 graphs as template-literal constants.
// WAN was removed from the product (its weights are parked in
// NovaFlow-retired), so these are dead code - but they are still workflows
// shipped to a browser, which spec 10 does not want.
//
// This is handled by name rather than by the general transform, because
// minified code has broken the general passes three separate ways. Even here
// the first attempt was wrong: walking back from a node name to "the nearest
// quote" lands on the JSON's OWN quotes, not the literal's boundary, and
// scatters fragments through the graph. The JSON is embedded raw, so the
// enclosing literal can only be a template - and that is what this looks for.
//
// Two guards make the edit safe to ship: the file must still parse afterwards,
// and the marker count must actually go DOWN. Failing either reverts.

import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { findMarkers } from './redact-workflow-module.mjs';

// A template holding this many nodes is a workflow, not a mention.
const MIN_NODES_FOR_A_GRAPH = 3;

/**
 * Every backtick template literal in `source`, as [start, end] inclusive of
 * the backticks. Respects escapes and `${...}` substitutions.
 */
export function templateLiterals(source) {
  const spans = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];

    // Skip quoted strings so a backtick inside one is not mistaken for a
    // template start.
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote || source[i] === '\n') { i += 1; break; }
        i += 1;
      }
      continue;
    }

    if (c === '`') {
      const start = i;
      let depth = 0;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '$' && source[i + 1] === '{') { depth += 1; i += 2; continue; }
        if (depth > 0 && source[i] === '}') { depth -= 1; i += 1; continue; }
        if (depth === 0 && source[i] === '`') break;
        i += 1;
      }
      if (i < n) spans.push([start, i]);
      i += 1;
      continue;
    }

    i += 1;
  }
  return spans;
}

export function redactDeadBundleWorkflow(source) {
  const spans = templateLiterals(source);
  const targets = spans.filter(([start, end]) => {
    const body = source.slice(start + 1, end);
    const nodes = (body.match(/class_type/g) || []).length;
    if (nodes < MIN_NODES_FOR_A_GRAPH) return false;
    // A template with substitutions is not a constant - the expressions inside
    // it are part of the program. Replacing one deletes live code, which is
    // how `Sr is not a function` appeared in the animation section.
    return !body.includes('${');
  });

  // Right to left, so earlier offsets stay valid.
  let out = source;
  for (const [start, end] of targets.slice().reverse()) {
    out = out.slice(0, start) + '`{}`' + out.slice(end + 1);
  }

  return { code: out, replaced: targets.length };
}

/**
 * Apply to a file, keeping the result only if it still parses AND actually
 * removed something. A bundle that no longer parses, or one that was churned
 * without benefit, is worse than one carrying a dead template.
 */
export function redactBundleFile(path) {
  const source = readFileSync(path, 'utf8');
  const markersBefore = findMarkers(source).length;
  const nodesBefore = (source.match(/class_type/g) || []).length;

  const { code, replaced } = redactDeadBundleWorkflow(source);
  if (!replaced) {
    return { replaced: 0, kept: false, reason: 'no graph template found', markersBefore, markersAfter: markersBefore, nodesBefore, nodesAfter: nodesBefore };
  }

  const nodesAfter = (code.match(/class_type/g) || []).length;
  if (nodesAfter >= nodesBefore) {
    return { replaced: 0, kept: false, reason: 'edit removed nothing', markersBefore, markersAfter: markersBefore, nodesBefore, nodesAfter: nodesBefore };
  }

  writeFileSync(path, code, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  } catch (error) {
    writeFileSync(path, source, 'utf8');
    return {
      replaced: 0,
      kept: false,
      reverted: true,
      reason: String(error.stderr || error.message || '').split('\n')[0].slice(0, 160),
      markersBefore, markersAfter: markersBefore, nodesBefore, nodesAfter: nodesBefore
    };
  }

  return {
    replaced,
    kept: true,
    markersBefore,
    markersAfter: findMarkers(code).length,
    nodesBefore,
    nodesAfter
  };
}
