const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function extract(file,name){const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let text;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)text=node.getText(ast);else ts.forEachChild(node,visit);}visit(ast);assert.ok(text,name);return vm.runInNewContext('('+text+')');}
const root=path.resolve(__dirname,'../..');
const metadata=extract(path.join(root,'particle-editor-desktop/main.js'),'promptAssistantFailureMetadata');
const label=extract(path.join(root,'particle-editor/novaflow-smart-ai.js'),'smartAiFailureCategoryLabel');
test('safe diagnostic category survives service to main to UI without changing failure status',()=>{
 const result=metadata({errorCode:'visual-contract-semantic-invalid',failure:{requestedVisualSchema:'nf.h3.visual.v1',failureCategory:'semantic_contract',validationLeaf:'visual-person-count'}});
 assert.equal(result.validationLeaf,'visual-person-count');
 assert.equal(result.errorCode,'visual-contract-semantic-invalid');
 assert.equal(label(result),'视觉分析的人物数量校验未通过');
});
test('unknown model details are not forwarded as diagnostic categories',()=>{
 for(const validationLeaf of ['raw model output','visual-person-count extra','<script>',''])assert.equal(metadata({validationLeaf}).validationLeaf,undefined);
 assert.equal(label(metadata({requestedVisualSchema:'nf.h3.visual.v1',failureCategory:'semantic_contract'})),'生成结果未通过 MiniMax H3 协议校验');
});
