import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createContext,runInContext} from 'node:vm';
const src=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');const a=src.indexOf('  function qwenImageEditLanguage('),b=src.indexOf('  // Result objects can only acquire',a);assert.ok(a>0&&b>a);const c={};createContext(c);runInContext(src.slice(a,b)+'\nglobalThis.lang=qwenImageEditLanguage;',c);
test('language uses changes first, excludes artwork quotations and leaves apostrophes in words',()=>{
 for(const [prompt,changes,language] of [['Add sign “春日”','','en'],["Add sign '春日'",'','en'],['添加写着“Hello”的牌子','','zh'],["添加写着'Hello'的牌子",'','zh'],['Add sign “春日」','','en'],["Don't change the colors",'','en'],['Add a red hat','改为蓝色','zh'],['一只猫','Make it blue','en']])assert.equal(c.lang(prompt,changes),language,prompt);
});
