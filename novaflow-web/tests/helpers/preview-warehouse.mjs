// Isolated UI acceptance: real browser-private file handles, no user files.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../../renderer/novaflow-web-warehouse.js', import.meta.url), 'utf8')).replace('novaflow-local-warehouse\', 1', 'novaflow-warehouse-ui-test\', 1');
const image = await readFile(new URL('../fixtures/generation-routes/source.png', import.meta.url));
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>仓库操作隔离验证</title><body style="background:#111"><script>
window.fixtureReady=(async()=>{
 const storage=await navigator.storage.getDirectory();
 const folder=await storage.getDirectoryHandle('warehouse-test-'+Date.now(),{create:true});
 // The production component asks for permission; OPFS is already origin-owned.
 FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';
 FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';
 window.showDirectoryPicker=async()=>folder;
 const file=await folder.getFileHandle('测试图片.png',{create:true});
 const stream=await file.createWritable();await stream.write(await (await fetch('/sample.png')).blob());await stream.close();
 return folder;
})();
</script><script src="/warehouse.js"></script><script>
(async()=>{await fixtureReady;await NovaFlowWebWarehouse.ready;await NovaFlowWebWarehouse.connect();await NovaFlowWebWarehouse.open();})();
</script></body></html>`;
const server = createServer((req,res)=>{
 if(req.url==='/warehouse.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(source);}
 else if(req.url==='/sample.png'){res.setHeader('Content-Type','image/png');res.end(image);}
 else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}
});
server.listen(0,'127.0.0.1',()=>console.log('Warehouse fixture: http://127.0.0.1:'+server.address().port));
