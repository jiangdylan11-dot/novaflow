// Explicit owner review utility. Preparing a report never publishes knowledge.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function artKnowledgeRelease(args,{fetchImpl=fetch,env=process.env}={}) {
  const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
  const mode=args.includes('--prepare')?'prepare':args.includes('--publish')?'publish':null;
  const base=option('--control'),reportPath=option('--report'),token=env.NOVAFLOW_ART_OWNER_TOKEN;
  if(!mode||!base||!reportPath||!token)throw Error('需要 --prepare 或 --publish、--control、--report，以及本机 NOVAFLOW_ART_OWNER_TOKEN；令牌不会写入报告');
  const url=new URL(base);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('控制面必须使用 HTTPS 或本机地址');
  let body;
  if(mode==='prepare') {
    const benchmarkBytes=await readFile(option('--benchmark')||''),benchmark=JSON.parse(benchmarkBytes);
    if(benchmark.passed!==true||!Array.isArray(benchmark.cases)||benchmark.cases.length<1)throw Error('固定基准尚未通过；不会准备正式发布批次');
    body={skillId:option('--skill')||'style-transfer',version:option('--version'),
      validation:{passed:true,cases:benchmark.cases.length,benchmarkSHA256:createHash('sha256').update(benchmarkBytes).digest('hex')}};
    if(option('--candidates'))body.candidateIds=option('--candidates').split(',');
  } else {
    const report=JSON.parse(await readFile(reportPath,'utf8'));
    if(!report.publishRequest||!report.batchSHA256||option('--approve-batch')!==report.batchSHA256)throw Error('必须审核报告后显式提供 --approve-batch <报告摘要>；不会自动同意');
    body={...report.publishRequest,approval:{approved:true,batchSHA256:report.batchSHA256}};
  }
  const res=await fetchImpl(base.replace(/\/+$/,'')+'/api/web/art-knowledge/'+mode,{method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const result=await res.json();if(!res.ok||!result.ok)throw Error(result.error||'经验审核请求失败');
  if(mode==='prepare') {
    await writeFile(reportPath,JSON.stringify(result,null,2));
    const rows=result.selected.map(c=>`- ${c.id}: ${c.method}\n  满意/采用 ${c.positive_count}，不满意/修改 ${c.negative_count}，正面用户 ${c.positive_users}；${c.reviewNotes.join('，')}`);
    await writeFile(reportPath+'.md',`# 经验发布待审清单\n\n状态：等待本人确认，尚未发布。\n\n正式版本 ${result.baseVersion} → ${body.version}\n\n批次摘要：${result.batchSHA256}\n\n${rows.join('\n\n')||'没有符合条件的新方法，本次无需发布。'}\n\n自动过滤 ${result.excluded.length} 条；剩余待审 ${result.remaining} 条。\n\n固定基准摘要：${body.validation.benchmarkSHA256}\n\n${result.excluded.map(c=>`- ${c.id}: ${c.reason}`).join('\n')}\n`);
  }
  return {mode,status:result.status||'published',version:result.version||body.version,selected:result.selected?.length,reportPath};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)artKnowledgeRelease(process.argv.slice(2))
  .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
