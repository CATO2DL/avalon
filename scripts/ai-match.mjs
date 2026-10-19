// Explicit validation driver: four independent HTTP human-test clients, never production clients.
import { randomUUID } from 'node:crypto';
export async function runAIMatch(base,{n=5,delay=100,maxSteps=12000,onStep=()=>{},recoverAI=false,onRecovery=()=>{}}={}){
  const clients=[];
  for(let i=0;i<n-1;i++){
    const res=await fetch(`${base}/api/session`),cookie=res.headers.get('set-cookie').split(';')[0];await res.json();
    const request=async(path,body)=>{const res=await fetch(base+path,{headers:{Cookie:cookie,Connection:'close',...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const data=await res.json();if(!res.ok)throw new Error(data.error);return data;};
    clients.push({request,cmd:(code,body)=>request(code?`/api/rooms/${code}`:'/api/rooms',{requestId:randomUUID(),...body}),state:code=>request(`/api/rooms/${code}`)});
  }
  const code=(await clients[0].cmd(null,{type:'create',name:'测试真人1',config:{playerCount:n,roleSet:'recommended'}})).code;
  for(let i=1;i<clients.length;i++){await clients[i].cmd(code,{type:'join',name:`测试真人${i+1}`});await clients[i].cmd(code,{type:'seat',seat:i+1});}
  let s=await clients[0].state(code);await clients[0].cmd(code,{type:'add_ai',seat:n,expectedRevision:s.revision});
  for(const c of clients)await c.cmd(code,{type:'ready',ready:true,configVersion:0});s=await clients[0].state(code);await clients[0].cmd(code,{type:'start',expectedRevision:s.revision});
  let rateLimitedAt=null,recoveryAttempts=0;
  for(let step=0;step<maxSteps;step++){
    for(const c of clients){const state=await c.state(code),r=state.room;await onStep(state);
      if(r.status==='finished')return {code,outcome:state.view.outcome,players:n};
      if(r.aiProblem==='RATE_LIMIT'){rateLimitedAt??=Date.now();if(Date.now()-rateLimitedAt>65000)throw new Error('AI_PAUSED_RATE_LIMIT');}
      else if(r.aiProblem){
        if(recoverAI&&recoveryAttempts<1&&['NETWORK_ERROR','TIMEOUT','FORMAT_ERROR','INVALID_MODEL_ACTION'].includes(r.aiProblem)){
          const latest=await clients[0].state(code);
          await clients[0].cmd(code,{type:'ai_retry',expectedRevision:latest.revision});
          recoveryAttempts++;onRecovery(r.aiProblem);continue;
        }
        throw new Error(`AI_PAUSED_${r.aiProblem}`);
      }
      else rateLimitedAt=null;
      const mine=r.members.find(p=>p.id===r.selfId);
      if(r.status==='revealing'&&state.serverNow>=r.revealAt&&!mine.confirmed){await c.cmd(code,{type:'confirm'});continue;}
      const d=r.discussion;if(d?.active&&d.speakerId===r.selfId){await c.cmd(code,{type:'speak',turnId:d.turnId,text:'先按这次队伍进行判断。'});continue;}
      const a=state.player?.legalActions[0];if(!a)continue;
      const requestId=randomUUID(),payload=a.type==='propose_team'?{type:a.type,team:a.candidateIds.slice(-a.teamSize)}:a.type==='vote'?{type:a.type,vote:'approve'}:a.type==='quest_card'?{type:a.type,card:'success'}:{type:a.type,targetId:a.candidateIds[0]};
      await c.cmd(code,{type:'action',requestId,roundId:state.roundId,action:{...payload,requestId,gameId:a.gameId,expectedVersion:a.expectedVersion}});
    }
    await new Promise(r=>setTimeout(r,delay));
  }
  throw new Error('MATCH_TIMEOUT');
}
