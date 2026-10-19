import { ModelError, parseProviderDecision } from '../src/ai.ts';
import { withStrategy,modelPayload,memorySchema,strategyContract } from './avalon-strategy.mjs';
export const systemInstruction=strategyContract;
export function safeModelError(e){
  if(e instanceof ModelError)return e;
  const status=Number(e?.status??e?.code);
  return new ModelError(status===429?'RATE_LIMIT':status===401||status===403?'AUTH_FAILED':status===404?'MODEL_UNAVAILABLE':status===408||status===504?'TIMEOUT':e?.name==='AbortError'||e?.name==='TimeoutError'?'TIMEOUT':status===400?'MODEL_REQUEST_REJECTED':'NETWORK_ERROR');
}
export function geminiAdapter({apiKey=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL??'gemini-3.8-flash',client}={}){
  if(!client&&!apiKey?.trim())return null;
  let sdk=client;
  return {model,async decide(input,signal){
    try{
      input=withStrategy(input);
      if(!sdk){const {GoogleGenAI}=await import('../.local/toolchain/node_modules/@google/genai/dist/node/index.mjs');sdk=new GoogleGenAI({apiKey,vertexai:false,httpOptions:{timeout:30000,retryOptions:{attempts:1}}});}
      const result=await sdk.models.generateContent({model,contents:JSON.stringify(modelPayload(input)),config:{systemInstruction:input.strategy.text,abortSignal:signal,httpOptions:{timeout:30000,retryOptions:{attempts:1}},responseMimeType:'application/json',responseJsonSchema:{type:'object',properties:{choice:{type:'integer',minimum:0},speech:{type:'string'},memory:memorySchema},required:['choice','speech','memory'],additionalProperties:false},maxOutputTokens:4096,thinkingConfig:{thinkingLevel:'LOW',includeThoughts:false}}});
      let raw;try{raw=JSON.parse(result.text);}catch{throw new ModelError('FORMAT_ERROR');}
      return {decision:parseProviderDecision(raw,input),model:result.modelVersion??model,tokens:result.usageMetadata?.totalTokenCount??null};
    }catch(e){throw safeModelError(e);}
  }};
}
