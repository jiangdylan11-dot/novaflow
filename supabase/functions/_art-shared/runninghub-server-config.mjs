// GENERATED COPY - source: packages/shared/src/runninghub-server-config.mjs
import {readRunningHubLlmConfig} from './runninghub-llm.mjs';

// Server/admin only. No browser-facing getter returns apiKey.
export function createRunningHubServerConfig({rpc,env}) {
  let snapshot=null;
  return {
    async refresh() {
      let result;
      try { result=await rpc('novaflow_runninghub_config_get',{}); }
      catch { throw Object.assign(new Error('服务器未能读取 RunningHub 配置，请检查后台同步状态'),{statusCode:503}); }
      if(result?.error)throw Object.assign(new Error('服务器未能读取 RunningHub 配置，请检查后台同步状态'),{statusCode:503});
      const value=Object.hasOwn(result || {},'data')?result.data:result;
      const row=Array.isArray(value)?value[0]:value;
      if(row && typeof row.api_key!=='string')throw Object.assign(new Error('服务器 RunningHub 配置格式无效'),{statusCode:503});
      snapshot=row || null;
      return this.read();
    },
    read() {
      return readRunningHubLlmConfig(name=>snapshot ? ({NOVAFLOW_RUNNINGHUB_API_KEY:snapshot.api_key,
        NOVAFLOW_RUNNINGHUB_LLM_BASE_URL:snapshot.llm_base_url,NOVAFLOW_RUNNINGHUB_LLM_MODEL:snapshot.llm_model})[name] || '' : env(name));
    },
    status(){return {source:snapshot?'server-config':'environment',revision:snapshot?.revision || 0,updatedAt:snapshot?.updated_at || null};}
  };
}
