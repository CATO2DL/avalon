import { createGame, applyAction, getPlayerView, getPublicView, getRules, getRecommendedRoles, validateConfig, alignmentOf } from './index.ts';
import type { Game, ResolvedConfig, Action } from './types.ts';

export type RoomStatus = 'lobby' | 'revealing' | 'playing' | 'finished' | 'terminated';
export interface Member { id:string; session:string; name:string; seat:number|null; ready:boolean; confirmed:boolean; kind?:'ai'; aiProfile?:string }
/** Stored only on server; never serialize Room directly. */
export interface Speech { playerId:string; text:string; turnId:string; phase?:string; questNumber?:number }
export interface Discussion { roundId:string; order:string[]; cursor:number }
export interface Room {
  code:string; config:ResolvedConfig; configVersion:number; revision:number; hostId:string;
  members:Member[]; status:RoomStatus; game:Game|null; revealAt:number|null;
  createdAt:number; updatedAt:number; closedAt:number|null;
  discussion?:Discussion; messages?:Speech[]; aiProblem?:string|null;
}
export class RoomError extends Error { constructor(code:string){super(code);} }
const fail=(code:string):never=>{throw new RoomError(code);};
export function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail('INVALID_REQUEST');
  return value as Record<string,unknown>;
}
export function fields(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!(k in v)))fail('INVALID_REQUEST');}
export function nickname(value:unknown):string{
  if(typeof value!=='string'||!value.trim()||value.trim().length>20||/[\x00-\x1f\x7f]/.test(value))return fail('INVALID_NAME');
  return value.trim();
}
export const configOptions=()=>[5,6,7,8,9,10].map(n=>({rules:getRules(n),recommendedRoles:getRecommendedRoles(n)}));
export function newRoom(code:string,session:string,name:unknown,config:unknown,now:number):Room{
  const c=validateConfig(config), id=crypto.randomUUID();
  return {code,config:c,configVersion:0,revision:0,hostId:id,members:[{id,session,name:nickname(name),seat:1,ready:false,confirmed:false}],status:'lobby',game:null,revealAt:null,createdAt:now,updatedAt:now,closedAt:null};
}
export function joinRoom(room:Room,session:string,name:unknown):Room{
  if(room.status!=='lobby')return fail('ROOM_STARTED');
  if(room.members.some(p=>p.session===session))return fail('ALREADY_JOINED');
  if(room.members.length>=room.config.playerCount)return fail('ROOM_FULL');
  const r=structuredClone(room);r.members.push({id:crypto.randomUUID(),session,name:nickname(name),seat:null,ready:false,confirmed:false});return r;
}
export function roundId(game:Game):string{return `${game.id}:${game.phase}:${game.events.at(-1)!.sequence}`;}
export function changeRoom(room:Room,session:string,input:Record<string,unknown>,now:number):Room{
  const r=structuredClone(room), member=r.members.find(p=>p.session===session);
  if(!member)return fail('ROOM_ACCESS_DENIED');
  const host=()=>{if(member.id!==r.hostId)fail('HOST_REQUIRED');};
  const lobby=()=>{if(r.status!=='lobby')fail('LOBBY_REQUIRED');};
  const current=()=>{if(input.expectedRevision!==r.revision)fail('STALE_ROOM');};
  if(r.status==='terminated')return fail('ROOM_TERMINATED');
  switch(input.type){
    case 'add_ai': {
      fields(input,['requestId','type','seat','expectedRevision',...('aiProfile' in input?['aiProfile']:[])]);host();lobby();current();
      if('aiProfile' in input&& !['gemini','deepseek','qwen','compatible'].includes(String(input.aiProfile)))fail('INVALID_AI_PROFILE');
      if(r.members.length>=r.config.playerCount)fail('ROOM_FULL');
      if(!Number.isInteger(input.seat)||Number(input.seat)<1||Number(input.seat)>r.config.playerCount)fail('INVALID_SEAT');
      if(r.members.some(p=>p.seat===input.seat))fail('SEAT_TAKEN');
      r.members.push({id:crypto.randomUUID(),session:`ai:${crypto.randomUUID()}`,name:`Gemini ${input.seat}`,seat:Number(input.seat),ready:true,confirmed:false,kind:'ai',...('aiProfile' in input?{aiProfile:String(input.aiProfile),name:`${({gemini:'Gemini',deepseek:'DeepSeek',qwen:'千问',compatible:'AI'})[String(input.aiProfile) as 'gemini']} ${input.seat}`}:{})});
      r.members.filter(p=>p.kind!=='ai').forEach(p=>p.ready=false);break;
    }
    case 'remove_ai': {
      // A legacy single-AI client may omit targetId only when there is exactly one AI.
      fields(input,['requestId','type','expectedRevision',...('targetId' in input?['targetId']:[])]);host();lobby();current();
      const bots=r.members.filter(p=>p.kind==='ai');
      const target='targetId' in input?bots.find(p=>p.id===input.targetId):bots.length===1?bots[0]:undefined;
      if(!target)fail('INVALID_TARGET');
      r.members=r.members.filter(p=>p.id!==target!.id);r.members.filter(p=>p.kind!=='ai').forEach(p=>p.ready=false);break;
    }
    case 'chat': {
      fields(input,['requestId','type','text']);
      if(r.status!=='playing'||!r.game||(r.game.phase==='assassination'&&alignmentOf(r.game.roles.find(p=>p.playerId===member.id)!.role)!=='evil')||member.kind==='ai')fail('NOT_YOUR_TURN');
      if(typeof input.text!=='string'||!input.text.trim()||input.text.length>500||/[\x00-\x08\x0b-\x1f\x7f]/.test(input.text))fail('INVALID_SPEECH');
      (r.messages??=[]).push({playerId:member.id,text:(input.text as string).trim(),turnId:`chat:${input.requestId}`,phase:r.game!.phase,questNumber:r.game!.questNumber});break;
    }
    case 'speak': {
      fields(input,['requestId','type','turnId','text']);
      const d=r.discussion;
      const free=r.game?.phase==='assassination'&&alignmentOf(r.game.roles.find(p=>p.playerId===member.id)!.role)==='evil'&&input.turnId===`${roundId(r.game)}:free:${member.id}`;
      if(!free&&(r.status!=='playing'||!d||d.order[d.cursor]!==member.id||input.turnId!==`${d.roundId}:${d.cursor}`)||r.status!=='playing'||(r.game?.phase==='assassination'&&!free))fail('NOT_YOUR_TURN');
      if(typeof input.text!=='string'||input.text.length>500||/[\x00-\x08\x0b-\x1f\x7f]/.test(input.text))fail('INVALID_SPEECH');
      (r.messages??=[]).push({playerId:member.id,text:(input.text as string).trim(),turnId:String(input.turnId),...(r.game?{phase:r.game.phase,questNumber:r.game.questNumber}:{})});if(!free)d!.cursor++;break;
    }

    case 'seat':
      fields(input,['requestId','type','seat']);lobby();
      if(!Number.isInteger(input.seat)||Number(input.seat)<1||Number(input.seat)>r.config.playerCount)fail('INVALID_SEAT');
      if(r.members.some(p=>p.id!==member.id&&p.seat===input.seat))fail('SEAT_TAKEN');
      member.seat=input.seat as number;member.ready=false;break;
    case 'ready':
      fields(input,['requestId','type','ready','configVersion']);lobby();
      if(input.configVersion!==r.configVersion)fail('STALE_CONFIG');
      if(member.seat===null||typeof input.ready!=='boolean')fail('SEAT_REQUIRED');
      member.ready=input.ready as boolean;break;
    case 'config': {
      fields(input,['requestId','type','config','expectedRevision']);host();lobby();current();
      const c=validateConfig(input.config);
      if(r.members.length>c.playerCount||r.members.some(p=>(p.seat??0)>c.playerCount))fail('OCCUPIED_SEATS');
      r.config=c;r.configVersion++;r.members.forEach(p=>p.ready=p.kind==='ai');break;
    }
    case 'rematch':
      fields(input,['requestId','type','expectedRevision']);host();current();
      if(r.status!=='finished')fail('GAME_NOT_FINISHED');
      r.status='lobby';r.game=null;r.revealAt=null;r.closedAt=null;
      r.configVersion++;
      r.members.forEach(p=>{p.ready=p.kind==='ai';p.confirmed=false;});
      delete r.discussion;r.messages=[];r.aiProblem=null;break;
    case 'start':
      fields(input,['requestId','type','expectedRevision']);host();lobby();current();
      if(r.members.length!==r.config.playerCount||r.members.some(p=>!p.ready||p.seat===null))fail('NOT_ALL_READY');
      r.members.sort((a,b)=>a.seat!-b.seat!);
      r.game=createGame(r.config,r.members.map(p=>({id:p.id,name:p.name})));r.status='revealing';r.revealAt=now+3000;break;
    case 'confirm':
      fields(input,['requestId','type']);
      if(r.status!=='revealing')fail('NOT_REVEALING');
      if(now<r.revealAt!)fail('REVEAL_PENDING');
      member.confirmed=true;if(r.members.every(p=>p.confirmed))r.status='playing';break;
    case 'action': {
      fields(input,['requestId','type','roundId','action']);
      if(r.status!=='playing'||!r.game)fail('NOT_PLAYING');
      if(r.game!.phase!=='assassination'&&r.discussion&&r.discussion.cursor<r.discussion.order.length)fail('DISCUSSION_PENDING');
      const game=r.game!;const action=record(input.action);
      if(action.requestId!==input.requestId||input.roundId!==roundId(game))fail('STALE_ROUND');
      // Rebase only simultaneous submissions within this exact public phase/round.
      // The core remains strict-versioned; actor and legality are always rechecked.
      let normalized=action;
      if((action.type==='vote'&&game.phase==='voting')||(action.type==='quest_card'&&game.phase==='quest')){
        if(!Number.isSafeInteger(action.expectedVersion)||Number(action.expectedVersion)<game.events.at(-1)!.version||Number(action.expectedVersion)>game.version)fail('STALE_VERSION');
        normalized={...action,expectedVersion:game.version};
      }
      const result=applyAction(game,member.id,normalized as unknown as Action);
      if(!result.ok)fail(result.error);else r.game=result.game;
      if(r.game!.phase==='ended'){r.status='finished';r.closedAt=now;}break;
    }
    case 'transfer':
      fields(input,['requestId','type','targetId','expectedRevision']);host();lobby();current();
      if(!r.members.some(p=>p.id===input.targetId&&p.kind!=='ai'))fail('INVALID_TARGET');
      r.hostId=input.targetId as string;break;
    case 'leave':
      fields(input,['requestId','type']);lobby();
      r.members=r.members.filter(p=>p.id!==member.id);
      if(!r.members.some(p=>p.kind!=='ai')){r.status='terminated';r.closedAt=now;}
      else if(r.hostId===member.id)r.hostId=r.members.find(p=>p.kind!=='ai')!.id;
      break;
    case 'terminate':
      fields(input,['requestId','type','expectedRevision']);host();current();
      if(r.status==='finished')fail('GAME_FINISHED');
      r.status='terminated';r.closedAt=now;break;
    default:fail('INVALID_REQUEST');
  }
  if(r.status==='playing'&&r.game&&(r.game.phase==='proposal'&&r.members.some(p=>p.kind==='ai'))&&r.discussion?.roundId!==roundId(r.game)){
    const {players,leaderIndex}=r.game;
    const order=[...players.slice(leaderIndex),...players.slice(0,leaderIndex)].map(p=>p.id).filter(id=>r.game!.phase!=='assassination'||r.game!.roles.some(role=>role.playerId===id&&alignmentOf(role.role)==='evil'));
    r.discussion={roundId:roundId(r.game),order,cursor:0};
  }
  return r;
}
export function roomSnapshot(r:Room,session:string|null,now:number,online:(session:string)=>boolean){
  const mine=session?r.members.find(p=>p.session===session):undefined;
  if(session&&!mine)fail('ROOM_ACCESS_DENIED');
  const visible=r.game&&r.status!=='terminated'&&(r.status!=='revealing'||now>=r.revealAt!);
  const player=visible&&mine?getPlayerView(r.game!,mine.id):null;
  const discussing=r.game?.phase!=='assassination'&&!!r.discussion&&r.discussion.cursor<r.discussion.order.length;
  if(player&&(r.status!=='playing'||discussing))player.legalActions=[];
  const view=r.game&&r.status!=='terminated'?getPublicView(r.game):null;
  // No accurate assassin identity in public waiting lists.
  const waiting=r.status==='revealing'?r.members.filter(p=>!p.confirmed).map(p=>p.id):r.status==='playing'&&r.game?.phase!=='assassination'
    ?r.members.filter(p=>getPlayerView(r.game!,p.id).legalActions.length>0).map(p=>p.id):[];
  return {mode:'multiplayer',serverNow:now,revision:r.revision,room:{
    code:r.code,status:r.status,config:r.config,configVersion:r.configVersion,hostId:r.hostId,revealAt:r.revealAt,
    members:r.members.map(p=>({id:p.id,name:p.name,seat:p.seat,ready:p.ready,confirmed:p.confirmed,online:p.kind==='ai'||online(p.session),kind:p.kind??'human',...(p.kind==='ai'?{aiProfile:p.aiProfile??'gemini'}:{})})),
    selfId:mine?.id??null,waitingIds:discussing?[r.discussion!.order[r.discussion!.cursor]]:waiting,
    discussion:r.game?.phase==='assassination'?null:r.discussion?{active:discussing,speakerId:r.discussion.order[r.discussion.cursor]??null,turnId:`${r.discussion.roundId}:${r.discussion.cursor}`,participants:r.discussion.order.map((id,i)=>{const message=r.messages?.find(m=>m.turnId===`${r.discussion!.roundId}:${i}`);return {playerId:id,status:i<r.discussion!.cursor?(message?.text?'spoken':'skipped'):i===r.discussion!.cursor?(r.aiProblem&&r.members.find(p=>p.id===id)?.kind==='ai'?'failed':'waiting'):'pending'};})} : null,
    messages:r.messages??[],aiProblem:r.aiProblem??null,
  },rules:getRules(r.config.playerCount),configOptions:configOptions(),view,player,roundId:r.game?roundId(r.game):null};
}
