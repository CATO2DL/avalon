import type { ActionPayload, PlayerView } from './types.ts';
import type { Speech } from './rooms.ts';
import { emptyPatch, memoryFor, validateMemoryPatch } from './ai-memory.ts';
import type { PrivateMemory, MemoryPatch } from './ai-memory.ts';
import { getRules } from './config.ts';

/** The adapter boundary deliberately cannot accept a full Game or Room. */
export interface ModelInput {
  kind:'action'|'speech'; view:PlayerView; publicMessages:Speech[];
  memory:PrivateMemory; choices:ActionPayload[];
  context:{roomId:string;rules:ReturnType<typeof getRules>;nextLeaderId:string;discussion:{order:string[];cursor:number;turnId:string}|null};
  strategy?:{version:string;resources:string[];phase:string;text:string};
}
export interface ModelDecision { choice:number; speech:string; memory:MemoryPatch|string }
export interface ModelResult { decision:ModelDecision; model:string; tokens:number|null }
export interface ModelAdapter { model:string; decide(input:ModelInput,signal:AbortSignal):Promise<ModelResult> }
export class ModelError extends Error { constructor(code:string){super(code);} }
export function actionChoices(view:PlayerView):ActionPayload[]{
  const a=view.legalActions[0];if(!a)return [];
  if(a.type==='vote')return a.choices.map(vote=>({type:'vote',vote}));
  if(a.type==='quest_card')return a.choices.map(card=>({type:'quest_card',card}));
  if(a.type==='assassinate')return a.candidateIds.map(targetId=>({type:'assassinate',targetId}));
  const teams:string[][]=[];
  // Keep the discriminated union narrowed across the recursive callback.
  const candidates=a.candidateIds, size=a.teamSize;
  function combos(start:number,team:string[]){
    if(team.length===size){teams.push(team);return;}
    for(let i=start;i<candidates.length;i++)combos(i+1,[...team,candidates[i]!]);
  }
  combos(0,[]);return teams.map(team=>({type:'propose_team',team}));
}
export function modelInput(view:PlayerView,messages:Speech[],memory:unknown,kind:ModelInput['kind'],roomId='',discussion:ModelInput['context']['discussion']=null):ModelInput{
  const index=view.public.players.findIndex(p=>p.id===view.public.leaderId);
  return {kind,view:structuredClone(view),publicMessages:structuredClone(messages),memory:memoryFor(view,messages,memory,roomId),choices:kind==='action'?actionChoices(view):[],context:{roomId,rules:getRules(view.public.config.playerCount),nextLeaderId:view.public.players[(index+1)%view.public.players.length]!.id,discussion:structuredClone(discussion)}};
}
export function parseDecision(raw:unknown,input:ModelInput,strictMemory=false):ModelDecision{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ModelError('FORMAT_ERROR');
  const r=raw as Record<string,unknown>;
  if(Object.keys(r).sort().join(',')!=='choice,memory,speech'||!Number.isInteger(r.choice)||typeof r.speech!=='string'||r.speech.length>500||(typeof r.memory==='string'&&(strictMemory||r.memory.length>1000))||/[\x00-\x08\x0b-\x1f\x7f]/.test(r.speech))throw new ModelError('FORMAT_ERROR');
  if(input.kind==='action'&&(!input.choices[Number(r.choice)]||r.speech!==''))throw new ModelError('INVALID_MODEL_ACTION');
  if(input.kind==='speech'&&r.choice!==0)throw new ModelError('FORMAT_ERROR');
  let memory:MemoryPatch|string;
  try{memory=typeof r.memory==='string'?r.memory:validateMemoryPatch(r.memory,input.view,input.publicMessages);}catch{throw new ModelError('FORMAT_ERROR');}
  return {choice:Number(r.choice),speech:r.speech.trim(),memory};
}

/** Provider memory is advisory. Never repair an action or publish an unvalidated speech.
 * Discard an invalid patch as a whole; keep only the last server-validated patch.
 */
export function parseProviderDecision(raw:unknown,input:ModelInput):ModelDecision {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ModelError('FORMAT_ERROR');
  const r=raw as Record<string,unknown>;
  // Require the exact envelope even if its memory contents need discarding.
  if(Object.keys(r).sort().join(',')!=='choice,memory,speech')throw new ModelError('FORMAT_ERROR');
  const decision=parseDecision({...r,memory:emptyPatch()},input,true);
  try{decision.memory=validateMemoryPatch(r.memory,input.view,input.publicMessages);}
  catch{
    const m=memoryFor(input.view,input.publicMessages,input.memory,input.context.roomId);
    decision.memory={beliefs:m.beliefs,bluffs:m.bluffs,currentGoal:m.currentGoal,decisionTag:m.decisionTag};
  }
  return decision;
}
