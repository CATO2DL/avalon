import type { PlayerView } from './types.ts';
import type { Speech } from './rooms.ts';

export interface MemoryPatch {
  beliefs:{playerId:string;hypothesis:string;confidence:'low'|'medium'|'high';supportIds:string[];counterIds:string[]}[];
  bluffs:{claim:string;target:string;status:'active'|'retired'}[];
  currentGoal:string;
  decisionTag:'normal'|'deliberate_bluff'|'cover'|'tactical_claim'|'revise_belief';
}
export interface PrivateMemory extends MemoryPatch {
  schemaVersion:1;
  scope:{roomId:string;gameId:string;playerId:string};
  knownFacts:{eventId:string;summary:string;visibility:'public'|'private'}[];
  publicStance:{turn:string;summary:string}[];
  lastProcessedEventId:string|null;
  legacyNote:string;
}
export const emptyPatch=():MemoryPatch=>({beliefs:[],bluffs:[],currentGoal:'',decisionTag:'normal'});
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,expected:string[])=>Object.keys(v).sort().join(',')===[...expected].sort().join(',');
const short=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length<=n&&!/[\x00-\x08\x0b-\x1f\x7f]/.test(v);
export function validateMemoryPatch(value:unknown,view:PlayerView,messages:Speech[]):MemoryPatch {
  const bad=()=>{throw new Error('FORMAT_ERROR');};
  if(!obj(value)||!keys(value,['beliefs','bluffs','currentGoal','decisionTag']))return bad();
  if(!Array.isArray(value.beliefs)||value.beliefs.length>10||!Array.isArray(value.bluffs)||value.bluffs.length>8||!short(value.currentGoal,250)||!['normal','deliberate_bluff','cover','tactical_claim','revise_belief'].includes(String(value.decisionTag)))return bad();
  const players=new Set(view.public.players.map(p=>p.id));
  const references=new Set(['self',...view.public.events.map(e=>`event:${e.sequence}`),...messages.map(m=>`speech:${m.turnId}`)]);
  const refs=(v:unknown)=>Array.isArray(v)&&v.length<=12&&v.every(x=>typeof x==='string'&&references.has(x));
  for(const b of value.beliefs){if(!obj(b)||!keys(b,['playerId','hypothesis','confidence','supportIds','counterIds'])||!players.has(String(b.playerId))||!short(b.hypothesis,220)||!['low','medium','high'].includes(String(b.confidence))||!refs(b.supportIds)||!refs(b.counterIds))return bad();}
  if(new Set(value.beliefs.map(b=>b.playerId)).size!==value.beliefs.length)return bad();
  for(const b of value.bluffs){if(!obj(b)||!keys(b,['claim','target','status'])||!short(b.claim,220)||!short(b.target,100)||!['all','self',...players].includes(b.target)||!['active','retired'].includes(String(b.status)))return bad();}
  return structuredClone(value) as unknown as MemoryPatch;
}
/** Facts and public stance are rebuilt from the authoritative filtered view/messages, never model text. */
export function memoryFor(view:PlayerView,messages:Speech[],stored:unknown,roomId=''):PrivateMemory {
  const scope={roomId,gameId:view.public.gameId,playerId:view.self.playerId};
  let previous:unknown=stored, legacyNote='';
  if(typeof stored==='string'){
    try{previous=JSON.parse(stored);}catch{previous=null;legacyNote=stored.slice(0,1000);}
  }
  let patch=emptyPatch();
  const previousScope=obj(previous)&&obj(previous.scope)?previous.scope:null;
  if(obj(previous)&&previousScope&&keys(previousScope,['roomId','gameId','playerId'])&&Object.entries(scope).every(([k,v])=>previousScope[k]===v)){
    try{patch=validateMemoryPatch({beliefs:previous.beliefs,bluffs:previous.bluffs,currentGoal:previous.currentGoal,decisionTag:previous.decisionTag},view,messages);}catch{/* Bad legacy claims never become facts. */}
    legacyNote=typeof previous.legacyNote==='string'?previous.legacyNote.slice(0,1000):'';
  }
  const knownFacts:PrivateMemory['knownFacts']=[{eventId:'self',visibility:'private',summary:JSON.stringify({role:view.self.role,alignment:view.self.alignment,knowledge:view.self.knowledge,...(view.self.assassinationRoles?{assassinationRoles:view.self.assassinationRoles}:{})})},...view.public.events.map(e=>({eventId:`event:${e.sequence}`,visibility:'public' as const,summary:JSON.stringify(e)}))];
  return {schemaVersion:1,scope,...patch,knownFacts,publicStance:messages.filter(m=>m.playerId===view.self.playerId).map(m=>({turn:m.turnId,summary:m.text})),lastProcessedEventId:view.public.events.length?`event:${view.public.events.at(-1)!.sequence}`:null,legacyNote};
}
export function commitMemory(view:PlayerView,messages:Speech[],previous:unknown,patch:MemoryPatch|string,roomId=''):PrivateMemory {
  const memory=memoryFor(view,messages,previous,roomId);
  if(typeof patch==='string')memory.legacyNote=patch.slice(0,1000); // migration / old pending decisions only
  else Object.assign(memory,validateMemoryPatch(patch,view,messages));
  return memory;
}
