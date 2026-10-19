import {modelAdapter} from './model-adapter.mjs';
import {chatCompatibleAdapter} from './chat-compatible.mjs';
import {ModelError} from '../src/ai.ts';
export function providerRegistry(env=process.env){
  const definitions=[
    {id:'gemini',label:'Gemini',model:env.GEMINI_MODEL??'gemini-3.8-live',build:()=>modelAdapter({apiKey:env.GEMINI_API_KEY,model:env.GEMINI_MODEL??'gemini-3.8-live'})},
    ...[
      ['deepseek','DeepSeek','DEEPSEEK','https://api.deepseek.com'],
      ['qwen','通义千问','QWEN','https://dashscope-intl.aliyuncs.com/compatible-mode/v1'],
      ['compatible','兼容接口','COMPATIBLE',null],
    ].map(([id,label,prefix,base])=>({id,label,model:env[`${prefix}_MODEL`]??'',build:()=>!env[`${prefix}_API_KEY`]||!env[`${prefix}_MODEL`]||!(env[`${prefix}_BASE_URL`]||base)?null:chatCompatibleAdapter({apiKey:env[`${prefix}_API_KEY`],model:env[`${prefix}_MODEL`],baseURL:env[`${prefix}_BASE_URL`]||base})})),
  ];
  const adapters=new Map(),profiles=definitions.map(d=>{const a=d.build();if(a)adapters.set(d.id,a);return {id:d.id,label:d.label,model:d.model,available:!!a};});
  // The legacy no-profile seat always refers to Gemini, never silently changes provider.
  return {model:'multi-provider',profiles,available:adapters.size>0,forProfile(id='gemini'){return adapters.get(id)??null;},async decide(input,signal){const a=adapters.get('gemini');if(!a)throw new ModelError('AI_NOT_CONFIGURED');return a.decide(input,signal);}};
}
