import { Worker } from 'node:worker_threads';
import { geminiAdapter } from './gemini.mjs';
import { ModelError, parseDecision } from '../src/ai.ts';
const errors=new Set(['TIMEOUT','RATE_LIMIT','AUTH_FAILED','MODEL_UNAVAILABLE','MODEL_REQUEST_REJECTED','NETWORK_ERROR','FORMAT_ERROR','INVALID_MODEL_ACTION','STRATEGY_RESOURCE_ERROR']);
export function modelAdapter({apiKey=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL??'gemini-3.8-flash',timeout=30000,workerFactory=options=>new Worker(new URL('./gemini-live-worker.mjs',import.meta.url),options)}={}){
  if(model!=='gemini-3.8-live')return geminiAdapter({apiKey,model});
  if(!apiKey?.trim())return null;
  return {model,decide(input,signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(new ModelError('TIMEOUT'));return;}
      let worker,settled=false,timer,stage='connecting';
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(worker)void worker.terminate().catch(()=>{});error?reject(error):resolve(result);};
      const cancel=()=>{const e=new ModelError('TIMEOUT');e.stage=stage;finish(e);};
      signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(cancel,timeout);
      try{
        // Capture SDK stdout/stderr rather than forwarding anything to service logs.
        worker=workerFactory({workerData:{apiKey,model,input:structuredClone(input)},stdout:true,stderr:true});
        worker.stdout?.resume();worker.stderr?.resume();
        worker.on('message',message=>{
          if(['connecting','waiting_response','generating','correcting','validating'].includes(message.progress)){stage=message.progress;return;}
          if(message.error){const error=new ModelError(errors.has(message.error)?message.error:'NETWORK_ERROR');if(message.formatReason==='MISSING_TOOL_CALL')error.formatReason='MISSING_TOOL_CALL';finish(error);return;}
          try{finish(null,{decision:parseDecision(message.result?.decision,input),model,tokens:Number.isFinite(message.result?.tokens)?message.result.tokens:null});}
          catch{finish(new ModelError('FORMAT_ERROR'));}
        });
        worker.on('error',()=>finish(new ModelError('NETWORK_ERROR')));
        worker.on('exit',()=>finish(new ModelError('NETWORK_ERROR')));
      }catch{finish(new ModelError('NETWORK_ERROR'));}
    });
  }};
}
