import type {PlayerView} from './types.ts';
import type {Speech} from './rooms.ts';
/** Derived only from the already-filtered player view; no Room/Game or evaluator answers. */
export function decisionBrief(view:PlayerView,messages:Speech[]){
  const p=view.public,s=view.self;
  const knownEvil=new Set(s.knowledge.knownAlignments.filter(x=>x.alignment==='evil').map(x=>x.playerId));
  if(s.alignment==='evil')knownEvil.add(s.playerId);
  for(const x of s.assassinationRoles??[])if(x.alignment==='evil')knownEvil.add(x.playerId);
  return structuredClone({
    phase:p.phase,quest:p.questNumber,leaderId:p.leaderId,team:p.team,teamSize:p.teamSize,failThreshold:p.failThreshold,
    score:p.score,rejectionMode:p.config.rejectionMode??'consecutive',nextRejectionEndsGame:p.rejectionCount===4,
    selfFailureAloneFailsQuest:p.phase==='quest'&&s.alignment==='evil'&&p.failThreshold===1,
    failureWouldBeThird:p.score.evil===2,successWouldTriggerAssassination:p.score.good===2,
    knownEvilOnTeam:p.team.filter(id=>knownEvil.has(id)),
    excludedMerlinCandidates:p.phase==='assassination'?p.players.filter(x=>knownEvil.has(x.id)).map(x=>x.id):[],
    questEvidence:p.events.filter(e=>e.type==='quest_resolved').map(e=>({reference:`event:${e.sequence}`,quest:e.questNumber,team:e.team,failCount:e.failCount,success:e.succeeded,meaning:e.failCount===0?'零失败不证明全员正义':'至少有失败牌数这么多名邪恶；不能对应到个人'})),
    recentPublicClaims:messages.slice(-8).map(m=>({reference:`speech:${m.turnId}`,playerId:m.playerId,text:m.text,verifiedFact:false})),
    ownPublicStance:messages.filter(m=>m.playerId===s.playerId).slice(-4).map(m=>({reference:`speech:${m.turnId}`,text:m.text})),
    goalPolicy:'旧目标是可变计划，不是行动约束。每次先按当前阶段/比分更新目标；公开承诺与秘密任务选择分别判断。'
  });
}
