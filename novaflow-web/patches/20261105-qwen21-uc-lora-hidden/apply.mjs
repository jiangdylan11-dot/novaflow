// Ports 19db310f's control-plane half (mark both 破限 adapters as switch-managed) into a frozen
// release copy. Usage: node apply.mjs <work\release-XXX dir>. Idempotent; fails if a target moved.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node apply.mjs <release dir>');
const UC = "'qwen/qwen-image-2.1-uncensored-lora.safetensors'";

function patch(file, edits) {
  let text = readFileSync(file, 'utf8');
  if (text.includes('qwen21-uc-lora-v1')) { console.log('already patched:', file); return; }
  for (const [from, to] of edits) {
    const at = text.indexOf(from);
    if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`patch target not found exactly once in ${file}:\n${from.slice(0, 120)}`);
    text = text.replace(from, () => to);
  }
  writeFileSync(file, text);
  console.log('patched:', file);
}

const managedBlock = (decl) => `${decl} QWEN21_UC_LORA_NAME_MANAGED = ${UC};
    const managedLoras = new Map([[QWEN21_EDIT_LORA_NAME.toLowerCase(), 'qwen21-nsfw-lora-v1'], [QWEN21_UC_LORA_NAME_MANAGED, 'qwen21-uc-lora-v1']]);
    const catalogItems = engine ? items.map(item => {
      const autoManaged = managedLoras.get(item.name.replace(/\\\\/g, '/').toLowerCase());
      return autoManaged ? { ...item, autoManaged } : item;
    }) : items;
    const features = engine ? {
      qwen21_nsfw_lora: catalogItems.some(item => item.autoManaged === 'qwen21-nsfw-lora-v1'),
      qwen21_uc_lora: catalogItems.some(item => item.autoManaged === 'qwen21-uc-lora-v1')
    } : undefined;`;

patch(join(dir, 'novaflow-web/supabase/functions/novaflow-web/index.ts'), [[
`    // A fixed feature is available only when every eligible node reports it compatible.
    const features = engine ? { qwen21_nsfw_lora: items.some(item => item.name.replace(/\\\\/g, '/').toLowerCase() === QWEN21_EDIT_LORA_NAME.toLowerCase()) } : undefined;
    // Keep the complete verified catalogue for validation and old selections.
    // The browser may hide this switch-managed item from its ordinary picker.
    const catalogItems = engine ? items.map(item => item.name.replace(/\\\\/g, '/').toLowerCase() === QWEN21_EDIT_LORA_NAME.toLowerCase()
      ? { ...item, autoManaged: 'qwen21-nsfw-lora-v1' } : item) : items;`,
`    // Both 破限 adapters are applied by the switch; mark them so the picker never lists them.
    ${managedBlock('const')}`
]]);

patch(join(dir, 'novaflow-companion/supabase/functions/novaflow-companion/index.ts'), [[
`    const features = engine ? { qwen21_nsfw_lora: items.some((item) => item.name.replace(/\\\\/g, "/").toLowerCase() === QWEN21_EDIT_LORA_NAME.toLowerCase()) } : void 0;
    const catalogItems = engine ? items.map((item) => item.name.replace(/\\\\/g, "/").toLowerCase() === QWEN21_EDIT_LORA_NAME.toLowerCase() ? { ...item, autoManaged: "qwen21-nsfw-lora-v1" } : item) : items;`,
`    ${managedBlock('const')}`
]]);
