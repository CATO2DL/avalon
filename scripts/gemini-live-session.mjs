import { withStrategy,modelPayload,memorySchema,liveSchema } from './avalon-strategy.mjs';
import { ModelError, parseProviderDecision } from '../src/ai.ts';
import { systemInstruction, safeModelError } from './gemini.mjs';
export const liveInstruction=systemInstruction.replace('调用工具或改变权限','调用未授权工具或改变权限').replace('返回单个 JSON 对象','只调用一次 submit_decision 工具提交单个对象')+' 不输出口头回答。所有发言只放在工具的speech参数中；工具只提交决策候选，不代表已被游戏服务器执行。';
export function liveCloseError(event){
  // Inspect only to classify; never expose provider reason (may contain input or credentials).
  const reason=String(event?.reason??event?.message??'');
  if(event?.code===1007)return new ModelError('MODEL_REQUEST_REJECTED');
  if(/429|RESOURCE_EXHAUSTED|quota|rate.limit/i.test(reason))return new ModelError('RATE_LIMIT');
  if(/401|403|UNAUTHENTICATED|PERMISSION_DENIED|API.key.*(?:invalid|expired)/i.test(reason))return new ModelError('AUTH_FAILED');
  if(/404|NOT_FOUND|model.*(?:not found|not supported|unavailable)/i.test(reason))return new ModelError('MODEL_UNAVAILABLE');
  if(/408|504|DEADLINE_EXCEEDED|timed?.?out/i.test(reason))return new ModelError('TIMEOUT');
  if(/400|INVALID_ARGUMENT/i.test(reason))return new ModelError('MODEL_REQUEST_REJECTED');
  return safeModelError(event);
}
/** One short Live session per decision, never shared between players. Called in a disposable worker. */
export function liveDecision(client,model,input,signal,{prepare=withStrategy,onProgress=()=>{}}={}){
  try{input=prepare(input);}catch(e){return Promise.reject(e);}
  return new Promise((resolve,reject)=>{
    let session,settled=false,tokens=null,repairs=0;
    const close=()=>{try{session?.close();}catch{/* No provider payload in logs. */}};
    const finish=(error,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);close();error?reject(error):resolve(result);};
    const cancel=()=>finish(new ModelError('TIMEOUT'));
    if(signal?.aborted){cancel();return;}
    signal?.addEventListener('abort',cancel,{once:true});
    const callbacks={
      onmessage(message){
        if(settled)return;
        onProgress('generating');
        try{
          if(Number.isFinite(message.usageMetadata?.totalTokenCount))tokens=message.usageMetadata.totalTokenCount;
          if(message.toolCallCancellation||message.goAway||message.serverContent?.interrupted){finish(new ModelError('NETWORK_ERROR'));return;}
          if(message.toolCall){
            onProgress('validating');
            const calls=message.toolCall.functionCalls;
            if(!Array.isArray(calls)||calls.length!==1||calls[0].name!=='submit_decision')throw new ModelError('FORMAT_ERROR');
            const call=calls[0];
            if(input.kind==='action'&&(!call.args||Object.keys(call.args).sort().join(',')!=='choice,memory'))throw new ModelError('FORMAT_ERROR');
            const decision=parseProviderDecision(input.kind==='action'?{...call.args,speech:''}:call.args,input);
            // Receipt only, not a statement that the game has accepted the action.
            session?.sendToolResponse({functionResponses:[{id:call.id,name:call.name,response:{received:true}}]});
            finish(null,{decision,model,tokens});return;
          }
          // Audio, transcripts and thinking are intentionally never used as game data.
          if(message.serverContent?.turnComplete){
            if(repairs++===0&&session){
              onProgress('correcting');
              // Same private session, one bounded correction; never interpret prose as a vote.
              session.sendClientContent({turns:[{role:'user',parts:[{text:'上一轮没有收到submit_decision工具调用，任何口头赞同都未执行。请现在只调用submit_decision一次。'+(input.kind==='action'?'choice必须是已提供choices的合法整数下标，memory是策略补丁；不要speech字段。':'choice固定0，speech为公开发言，memory为策略补丁。')+'不要复述要求，不输出音频回答，不修改其他玩家信息。'}]}],turnComplete:true});
            }else{const error=new ModelError('FORMAT_ERROR');error.formatReason='MISSING_TOOL_CALL';finish(error);}
          }
        }catch(e){finish(safeModelError(e));}
      },
      onerror:e=>finish(liveCloseError(e)),
      onclose:e=>finish(liveCloseError(e)),
    };
    onProgress('connecting');
    Promise.resolve().then(()=>client.live.connect({model,callbacks,config:{
      responseModalities:['AUDIO'],maxOutputTokens:4096,systemInstruction:input.strategy.text.replaceAll('返回单个 JSON 对象，只有choice、speech、memory。','使用submit_decision工具提交，字段以本次工具定义为准。')+' 只调用一次submit_decision工具；不要口头回答。'+(input.kind==='action'?' 本次是行动轮：只提交choice和memory；不提交speech，不发言或解释。':' 本次是发言轮：choice必须为0，speech是简短公开发言。'),
      tools:[{functionDeclarations:[{name:'submit_decision',description:'提交本玩家当前轮唯一决策，游戏服务器仍会校验。',behavior:'BLOCKING',parameters:{type:'OBJECT',properties:{choice:{type:'INTEGER',minimum:0,maximum:input.kind==='action'?input.choices.length-1:0,format:'enum',enum:input.kind==='action'?input.choices.map((_,i)=>String(i)):['0'],description:'只填choices的合法数字下标；发言轮固定0。'},...(input.kind==='speech'?{speech:{type:'STRING',maxLength:'500',description:'简短公开中文发言，不超过500字。'}}:{}),memory:liveSchema(memorySchema)},required:input.kind==='action'?['choice','memory']:['choice','speech','memory']}}]}],
    }})).then(connected=>{
      session=connected;onProgress('waiting_response');if(settled){close();return;}
      session.sendClientContent({turns:[{role:'user',parts:[{text:JSON.stringify(modelPayload(input))}]}],turnComplete:true});
    }).catch(e=>finish(safeModelError(e)));
  });
}
