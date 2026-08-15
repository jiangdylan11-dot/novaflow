import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exportToSpine } from './SpineExporter';
import type { ParticleSystemConfig } from '../types';

function loadTemplate(basename: string): ParticleSystemConfig {
  const p = path.resolve(__dirname, '..', '..', '..', 'particle-editor-desktop', 'resources', 'initial-templates', basename);
  return JSON.parse(readFileSync(p, 'utf8'));
}

describe('SpineExporter internal fields', () => {
  it('does not leak internal markers into exported json (3.8)', () => {
    const cfg = loadTemplate('21_UI_按钮环绕流光.json');
    const jsonText = exportToSpine([cfg], '3.8');
    expect(jsonText.includes('"_inj"')).toBe(false);
  });

  it('does not leak internal markers into exported json (4.1)', () => {
    const cfg = loadTemplate('21_UI_按钮环绕流光.json');
    const jsonText = exportToSpine([cfg], '4.1');
    expect(jsonText.includes('"_inj"')).toBe(false);
  });
});

