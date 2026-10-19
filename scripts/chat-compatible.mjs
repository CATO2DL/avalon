import {ModelError,parseProviderDecision} from '../src/ai.ts';
import {withStrategy,modelPayload} from './avalon-strategy.mjs';
/** Server-configured Chat Completions endpoint. No browser-provided URLs or keys. */
export function chatCompatibleAdapter({apiKey,model,baseURL,fetchImpl=fetch,timeout=30000}={}){
  if(!apiKey?.trim()||!model?.trim())return null;
  let url;try{url=new URL(baseURL);}catch{throw new Error('INVALID_AI_ENDPOINT');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('INVALID_AI_ENDPOINT');
  const endpoint=url.href.replace(/\/$/,'')+'/chat/completions';
  return {model,async decide(input,signal){
    input=withStrategy(input);
    const abort=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
    try{
      const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:abort,headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model,messages:[{role:'system',content:input.strategy.text},{role:'user',content:JSON.stringify(modelPayload(input))}],response_format:{type:'json_object'},stream:false,max_tokens:2048})});
      if(!response.ok)throw new ModelError(response.status===429?'RATE_LIMIT':[401,403].includes(response.status)?'AUTH_FAILED':response.status===404?'MODEL_UNAVAILABLE':response.status===400?'MODEL_REQUEST_REJECTED':response.status===408||response.status===504?'TIMEOUT':'NETWORK_ERROR');
      let data,raw;try{data=await response.json();if(data.choices?.[0]?.finish_reason!=='stop')throw new Error();raw=JSON.parse(data.choices[0].message.content);}catch{throw new ModelError('FORMAT_ERROR');}
      return {decision:parseProviderDecision(raw,input),model,tokens:Number.isFinite(data.usage?.total_tokens)?data.usage.total_tokens:null};
    }catch(e){if(e instanceof ModelError)throw e;throw new ModelError(abort.aborted?'TIMEOUT':'NETWORK_ERROR');}
  }};
}
