import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildGrokImageReverseRequest } from './smart-ai-grok.workflow.mjs';

const images = Array.from({ length: 16 }, (_, index) => ({
  imageUrl: `data:image/png;base64,${Buffer.from(String(index + 1)).toString('base64')}`,
  label: `图${index + 1}`,
  role: index === 0 ? 'layout' : index === 1 ? 'style' : 'subject'
}));

for (const [surface, purpose] of [['ui-design', 'ui-design-reference'], ['art', 'roleReference']]) {
  test(`${surface} cloud analysis sends all sixteen references in order`, () => {
    const result = buildGrokImageReverseRequest({
      surface, purpose, scenario: 'role_reference', sourceCount: images.length,
      currentPrompt: '融合给定布局、风格和元素', images
    });
    const sent = result.body.input.flatMap(message => message.content)
      .filter(item => item.type === 'input_image');
    assert.deepEqual(sent.map(item => item.image_url), images.map(item => item.imageUrl));
    assert.equal(result.inputMeta.imageCount, 16);
    assert.equal(result.inputMeta.sourceImageCount, 16);
    assert.throws(() => buildGrokImageReverseRequest({
      surface, purpose, scenario: 'role_reference', images: [images[0], {}]
    }), /未截断提交/);
  });
}

test('cloud and maintained admin use the same reference normalization', () => {
  const edge = readFileSync(new URL('./smart-ai-grok.workflow.mjs', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../../../novaflow-web/admin/admin-server/server.js', import.meta.url), 'utf8');
  const block = source => source.slice(source.indexOf('function normalizeGrokSmartAiImage('),
    source.indexOf('function selectGrokSmartAiImageScenario(')).replaceAll('\r\n', '\n');
  assert.equal(block(edge), block(admin));
});
