import { withStrategy } from './avalon-strategy.mjs';
import { commitMemory } from '../src/ai-memory.ts';
import { createHash } from 'node:crypto';
import { getPlayerView } from '../src/index.ts';
import { roundId, RoomError, fields } from '../src/rooms.ts';
import { modelInput, parseDecision, ModelError } from '../src/ai.ts';
import { safeModelError } from './gemini.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const safeCodes=new Set(['RATE_LIMIT','RATE_LIMIT_EXHAUSTED','AUTH_FAILED','MODEL_UNAVAILABLE','TIMEOUT','MODEL_REQUEST_REJECTED','NETWORK_ERROR','FORMAT_ERROR','INVALID_MODEL_ACTION','CALL_LIMIT','UNCERTAIN_REQUEST','STRATEGY_RESOURCE_ERROR']);
/** One scheduler per single-instance SQLite server. Provider calls are never part of an open DB transaction. */
export class AIRuntime {
  constructor(store,adapter,{maxCalls=40,minInterval=12000,timeout=30000}={}){
    this.store=store;this.db=store.db;this.adapter=adapter;this.maxCalls=(maxCalls===0||maxCalls==='0')?Infinity:Math.floor(Math.min(100,Math.max(1,Number(maxCalls)||40)));this.minInterval=Math.max(0,Number(minInterval)||0);this.timeout=timeout;this.busy=false;this.closed=false;
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_jobs(id TEXT PRIMARY KEY, code TEXT NOT NULL, game TEXT NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, input TEXT NOT NULL, result TEXT, error TEXT, retryAt INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ai_memory(game TEXT NOT NULL, actor TEXT NOT NULL, memory TEXT NOT NULL, PRIMARY KEY(game,actor));
      CREATE TABLE IF NOT EXISTS ai_calls(job TEXT NOT NULL, attempt INTEGER NOT NULL, model TEXT NOT NULL, started INTEGER NOT NULL, elapsed INTEGER, tokens INTEGER, cost TEXT NOT NULL DEFAULT 'unknown', status TEXT NOT NULL, input TEXT NOT NULL, action TEXT, PRIMARY KEY(job,attempt));`);
    store.aiAvailable=!!adapter&&adapter.available!==false;store.aiRuntime=this;
    // Startup room cleanup may have run before these optional AI tables existed.
    this.transaction(()=>{
      this.db.exec('DELETE FROM ai_calls WHERE job IN (SELECT id FROM ai_jobs WHERE code NOT IN (SELECT code FROM rooms)); DELETE FROM ai_jobs WHERE code NOT IN (SELECT code FROM rooms);');
      const games=new Set(this.db.prepare('SELECT data FROM rooms').all().map(row=>JSON.parse(row.data).game?.id));
      for(const row of this.db.prepare('SELECT DISTINCT game FROM ai_memory').all())if(!games.has(row.game))this.db.prepare('DELETE FROM ai_memory WHERE game=?').run(row.game);
    });
    // An external request may have completed before a crash. Never silently repeat it.
    for(const row of this.db.prepare("SELECT * FROM ai_jobs WHERE status='inflight'").all())this.fail(row,'UNCERTAIN_REQUEST');
    this.transaction(()=>{for(const row of this.db.prepare('SELECT data FROM rooms').all()){
      const room=JSON.parse(row.data);if(!['revealing','playing'].includes(room.status)||!room.members.some(p=>p.kind==='ai'))continue;
      if(!adapter)this.problem(room.code,'AI_NOT_CONFIGURED');
      else if(room.aiProblem==='AI_NOT_CONFIGURED')this.problem(room.code,this.db.prepare("SELECT error FROM ai_jobs WHERE code=? AND status='failed' ORDER BY rowid DESC LIMIT 1").get(room.code)?.error??null);
      // A raised/disabled local cap can release only unsent tasks blocked by that cap.
      // Timeout, auth, uncertain and exhausted requests remain paused for the host.
      if(adapter&&this.calls(room.game?.id)<this.maxCalls){
        const released=this.db.prepare("UPDATE ai_jobs SET status='queued',error=NULL WHERE code=? AND game=? AND status='failed' AND error='CALL_LIMIT' AND attempts=0").run(room.code,room.game.id).changes;
        if(released)this.problem(room.code,this.db.prepare("SELECT error FROM ai_jobs WHERE code=? AND status='failed' ORDER BY rowid DESC LIMIT 1").get(room.code)?.error??null);
      }
    }});
  }
  adapterFor(actor){return this.adapter?.forProfile?this.adapter.forProfile(actor?.aiProfile??'gemini'):this.adapter;}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
  saveRoom(room){room.revision++;room.updatedAt=this.store.clock();this.db.prepare('UPDATE rooms SET data=? WHERE code=?').run(JSON.stringify(room),room.code);}
  problem(code,error){const r=this.store.load(code);if(r.aiProblem!==error){r.aiProblem=error;this.saveRoom(r);}}
  fail(job,code){const error=safeCodes.has(code)?code:'INVALID_MODEL_ACTION';this.transaction(()=>{
    this.db.prepare("UPDATE ai_jobs SET status='failed',error=? WHERE id=?").run(error,job.id);
    this.db.prepare("UPDATE ai_calls SET status=? WHERE job=? AND attempt=?").run(error,job.id,job.attempts);
    this.problem(job.code,error);
  });}
  retry(session,room,body){
    fields(body,['requestId','type','expectedRevision']);
    if(room.members.find(p=>p.session===session)?.id!==room.hostId)throw new RoomError('HOST_REQUIRED');
    if(body.expectedRevision!==room.revision)throw new RoomError('STALE_ROOM');
    if(!this.adapter)throw new RoomError('AI_NOT_CONFIGURED');
    const job=this.db.prepare("SELECT * FROM ai_jobs WHERE code=? AND status='failed' ORDER BY rowid DESC LIMIT 1").get(room.code);
    // A deliberate server model change may recover one exhausted transient failure.
    // Keep the same job, ledger and game budget; never reset attempts or auto-retry it.
    const selectedAdapter=this.adapterFor(room.members.find(p=>p.id===job?.actor));
    if(!selectedAdapter)throw new RoomError('AI_NOT_CONFIGURED');
    const previous=job?this.db.prepare('SELECT model FROM ai_calls WHERE job=? ORDER BY attempt DESC LIMIT 1').get(job.id):null;
    const switchedModelRecovery=job?.attempts===2&&previous&&previous.model!==selectedAdapter.model&&['TIMEOUT','NETWORK_ERROR','MODEL_UNAVAILABLE'].includes(job.error);
    if(!job||(this.maxCalls!==Infinity&&job.attempts>=2&&!switchedModelRecovery)||this.calls(room.game?.id)>=this.maxCalls)throw new RoomError('AI_RETRY_LIMIT');
    this.db.prepare("UPDATE ai_jobs SET status='queued',error=NULL WHERE id=?").run(job.id);room.aiProblem=null;return room;
  }
  calls(game){return this.db.prepare('SELECT coalesce(sum(attempts),0) n FROM ai_jobs WHERE game=?').get(game).n;}
  task(room,actor){
    if(room.status!=='playing'||!room.game)return null;
    const view=getPlayerView(room.game,actor.id),d=room.discussion;
    const free=view.public.phase==='assassination';
    const freeSpeech=free&&view.self.alignment==='evil'&&!view.legalActions.length&&!(room.messages??[]).some(m=>m.playerId===actor.id&&m.phase==='assassination');
    const speaking=free?freeSpeech:d&&d.cursor<d.order.length;
    if(speaking&&!free&&d.order[d.cursor]!==actor.id)return null;
    if(!speaking&&!view.legalActions.length)return null;
    const kind=speaking?'speech':'action',turn=speaking?(free?`${roundId(room.game)}:free:${actor.id}`:`${d.roundId}:${d.cursor}`):roundId(room.game);
    if(speaking)view.legalActions=[];
    const memory=this.db.prepare('SELECT memory FROM ai_memory WHERE game=? AND actor=?').get(room.game.id,actor.id)?.memory??'';
    return {id:digest(`${room.game.id}:${actor.id}:${kind}:${turn}`),code:room.code,game:room.game.id,actor:actor.id,turn,input:modelInput(view,room.messages??[],memory,kind,room.code,!free&&d?{order:d.order,cursor:d.cursor,turnId:turn}:null)};
  }
  async tick(){
    if(this.busy||this.closed||!this.adapter)return;this.busy=true;
    try{
      roomsLoop: for(const row of this.db.prepare('SELECT data FROM rooms').all()){
        const initial=JSON.parse(row.data);
        if(!['revealing','playing'].includes(initial.status))continue;
        // Pause this room on an unresolved failure; another AI must not clear the error.
        if(initial.game?.phase!=='assassination'&&this.db.prepare("SELECT 1 FROM ai_jobs WHERE code=? AND status='failed' LIMIT 1").get(initial.code))continue;
        const delayed=this.db.prepare("SELECT actor FROM ai_jobs WHERE code=? AND status='queued' AND error='RATE_LIMIT' LIMIT 1").get(initial.code);
        const actors=initial.members.filter(p=>p.kind==='ai'&&(!delayed||p.id===delayed.actor));
        for(const selected of actors){
        if(this.closed)break roomsLoop;
        // Previous confirmation/action may have changed the room; never reuse its stale clone.
        const room=this.store.load(initial.code),actor=room.members.find(p=>p.id===selected.id);if(!actor)continue;
        if(room.status==='revealing'&&!actor.confirmed&&this.store.clock()>=room.revealAt){
          this.store.execute(actor.session,room.code,{type:'confirm',requestId:`ai-confirm-${room.game.id}`});continue;
        }
        const task=this.task(room,actor);if(!task)continue;
        const selectedAdapter=this.adapterFor(actor);if(!selectedAdapter){this.problem(room.code,'AI_NOT_CONFIGURED');continue;}
        let job=this.db.prepare('SELECT * FROM ai_jobs WHERE id=?').get(task.id);
        if(!job){this.db.prepare("INSERT INTO ai_jobs(id,code,game,actor,status,input) VALUES(?,?,?,?,'queued',?)").run(task.id,task.code,task.game,task.actor,JSON.stringify(task.input));job=this.db.prepare('SELECT * FROM ai_jobs WHERE id=?').get(task.id);}
        if(job.status==='responded'){this.commit(job);continue;}
        if(job.status!=='queued'||job.retryAt>this.store.clock())continue;
        if(this.calls(task.game)>=this.maxCalls){this.fail(job,'CALL_LIMIT');continue;}
        const last=this.db.prepare('SELECT max(started) t FROM ai_calls').get().t;
        if(last!==null&&this.store.clock()-last<this.minInterval)continue;
        try{
          const prepared=withStrategy(task.input);
          this.db.prepare('UPDATE ai_jobs SET input=? WHERE id=?').run(JSON.stringify(prepared),job.id);
          job=this.db.prepare('SELECT * FROM ai_jobs WHERE id=?').get(job.id);
        }catch{this.fail(job,'STRATEGY_RESOURCE_ERROR');continue;}
        this.transaction(()=>{
          this.db.prepare("UPDATE ai_jobs SET status='inflight',attempts=attempts+1 WHERE id=?").run(job.id);
          job=this.db.prepare('SELECT * FROM ai_jobs WHERE id=?').get(job.id);
          this.db.prepare("INSERT INTO ai_calls(job,attempt,model,started,status,input) VALUES(?,?,?,?,'inflight',?)").run(job.id,job.attempts,selectedAdapter.model,this.store.clock(),job.input);
          this.problem(room.code,null);
        });
        const started=Date.now(),input=JSON.parse(job.input),abort=new AbortController();this.abort=abort;
        let timer;
        try{
          const result=await Promise.race([selectedAdapter.decide(structuredClone(input),abort.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new ModelError('TIMEOUT'));},this.timeout);})]);
          if(this.closed)break;
          const decision=parseDecision(result.decision,input);
          this.transaction(()=>{
            this.db.prepare("UPDATE ai_jobs SET status='responded',result=? WHERE id=?").run(JSON.stringify(decision),job.id);
            this.db.prepare("UPDATE ai_calls SET status='responded',model=?,elapsed=?,tokens=?,action=? WHERE job=? AND attempt=?").run(String(result.model??selectedAdapter.model).slice(0,100),Date.now()-started,Number.isFinite(result.tokens)?result.tokens:null,input.kind==='action'?JSON.stringify(input.choices[decision.choice]):'speech',job.id,job.attempts);
          });
          this.commit(this.db.prepare('SELECT * FROM ai_jobs WHERE id=?').get(job.id));
        }catch(e){
          if(this.closed)break;
          const error=safeModelError(e).message;this.fail(job,error==='RATE_LIMIT'&&job.attempts>=2?'RATE_LIMIT_EXHAUSTED':error);
          this.db.prepare('UPDATE ai_calls SET elapsed=? WHERE job=? AND attempt=?').run(Date.now()-started,job.id,job.attempts);
          // Only a definitive rate rejection is automatically retried, once; timeout/auth/format await host.
          if(error==='RATE_LIMIT'&&job.attempts<2)this.transaction(()=>this.db.prepare("UPDATE ai_jobs SET status='queued',retryAt=? WHERE id=?").run(this.store.clock()+30000,job.id));
        }finally{clearTimeout(timer);this.abort=null;}
        break roomsLoop; // At most one provider call per tick across all rooms and AI players.
        }
      }
    }finally{this.busy=false;}
  }
  commit(job){
    const room=this.store.load(job.code),actor=room.members.find(p=>p.id===job.actor),task=actor?this.task(room,actor):null;
    if(!task||task.id!==job.id){this.db.prepare("UPDATE ai_jobs SET status='cancelled',result=NULL WHERE id=?").run(job.id);return;}
    const input=JSON.parse(job.input),decision=parseDecision(JSON.parse(job.result),input),requestId=`ai-${job.id}`;
    const body=input.kind==='speech'?{type:'speak',turnId:task.turn,text:decision.speech,requestId}:{type:'action',roundId:task.turn,requestId,action:{...input.choices[decision.choice],gameId:job.game,expectedVersion:input.view.public.version,requestId}};
    try{
      this.store.execute(actor.session,job.code,body,()=>{
        this.db.prepare("UPDATE ai_jobs SET status='done' WHERE id=?").run(job.id);
        this.db.prepare("UPDATE ai_calls SET status='done' WHERE job=? AND attempt=?").run(job.id,job.attempts);
        const updated=this.store.load(job.code);
        const memory=commitMemory(getPlayerView(updated.game,job.actor),updated.messages??[],input.memory,decision.memory,job.code);
        this.db.prepare('INSERT INTO ai_memory VALUES(?,?,?) ON CONFLICT(game,actor) DO UPDATE SET memory=excluded.memory').run(job.game,job.actor,JSON.stringify(memory));
      });
    }catch{this.fail(job,'INVALID_MODEL_ACTION');}
  }
  start(){this.timer=setInterval(()=>{this.tick().catch(()=>{/* fixed marker only; no provider/request payload */console.error('AI_SCHEDULER_ERROR');});},500);this.timer.unref();}
  close(){this.closed=true;clearInterval(this.timer);this.abort?.abort();}
}
