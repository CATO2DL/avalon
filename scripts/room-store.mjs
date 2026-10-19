import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { newRoom, joinRoom, changeRoom, roomSnapshot, RoomError, fields } from '../src/rooms.ts';
const hash=x=>createHash('sha256').update(x).digest('hex');
export class RoomStore {
  constructor(path,clock=Date.now){
    this.clock=clock;this.seen=new Map();
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(session TEXT NOT NULL, request TEXT NOT NULL, digest TEXT NOT NULL, code TEXT NOT NULL, PRIMARY KEY(session,request));`);
  }
  close(){this.db.close();}
  session(token){
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
    const id=hash(token);return this.db.prepare('SELECT id FROM sessions WHERE id=?').get(id)?.id??null;
  }
  newSession(){const token=randomBytes(32).toString('hex');const id=hash(token);this.db.prepare('INSERT INTO sessions VALUES(?,?)').run(id,this.clock());return token;}
  touch(session){this.seen.set(session,this.clock());}
  load(code){const row=this.db.prepare('SELECT data FROM rooms WHERE code=?').get(code);if(!row)throw new RoomError('ROOM_NOT_FOUND');return JSON.parse(row.data);}
  snapshot(code,session){if(session)this.touch(session);return roomSnapshot(this.load(code),session,this.clock(),id=>this.clock()-(this.seen.get(id)??0)<12000);}
  list(session){return this.db.prepare('SELECT data FROM rooms').all().map(x=>JSON.parse(x.data)).filter(r=>r.members.some(p=>p.session===session)).map(r=>({code:r.code,status:r.status}));}
  execute(session,code,body,onCommit){
    const request=body.requestId;if(typeof request!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(request))throw new RoomError('INVALID_REQUEST');
    const digest=hash(JSON.stringify({code,body}));
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const old=this.db.prepare('SELECT digest,code FROM requests WHERE session=? AND request=?').get(session,request);
      if(old){if(old.digest!==digest)throw new RoomError('REQUEST_ID_REUSED');this.db.exec('COMMIT');return {code:old.code,replayed:true};}
      const now=this.clock();let room;
      if(body.type==='create'){
        fields(body,['requestId','type','name','config']);
        if(this.list(session).some(r=>!['finished','terminated'].includes(r.status)))throw new RoomError('ACTIVE_ROOM_EXISTS');
        if(this.db.prepare('SELECT count(*) n FROM rooms').get().n>=1000)throw new RoomError('ROOM_LIMIT');
        do{code=randomBytes(5).toString('hex').toUpperCase();}while(this.db.prepare('SELECT 1 FROM rooms WHERE code=?').get(code));
        room=newRoom(code,session,body.name,body.config,now);
      }else{
        room=this.load(code);
        if(body.type==='join'){
          fields(body,['requestId','type','name']);
          if(this.list(session).some(r=>!['finished','terminated'].includes(r.status)))throw new RoomError('ACTIVE_ROOM_EXISTS');
          room=joinRoom(room,session,body.name);
        }else if(body.type==='ai_retry'){
          if(!this.aiRuntime)throw new RoomError('AI_NOT_CONFIGURED');
          room=this.aiRuntime.retry(session,room,body);
        }else{
          if(body.type==='start'&&room.members.some(p=>p.kind==='ai')&&!this.aiAvailable)throw new RoomError('AI_NOT_CONFIGURED');
          if(body.type==='add_ai'&&body.aiProfile&&!this.aiRuntime?.adapterFor({aiProfile:body.aiProfile}))throw new RoomError('AI_NOT_CONFIGURED');
          if(body.type==='start'&&room.members.some(p=>p.kind==='ai'&&!this.aiRuntime?.adapterFor(p)))throw new RoomError('AI_NOT_CONFIGURED');
          const changed=changeRoom(room,session,body,now);
          if(body.type==='rematch'&&room.members.some(p=>p.kind!=='ai'&&this.list(p.session).some(other=>other.code!==code&&!['finished','terminated'].includes(other.status))))throw new RoomError('MEMBER_IN_OTHER_ROOM');
          room=changed;
        }
      }
      room.revision++;room.updatedAt=now;
      this.db.prepare('INSERT INTO rooms VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data').run(code,JSON.stringify(room));
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(session,request,digest,code);
      onCommit?.();
      // Commit state, public history, pending secrets and idempotency receipt together.
      this.db.exec('COMMIT');this.touch(session);return {code,replayed:false};
    }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
  }
  cleanup(){
    const now=this.clock();this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const row of this.db.prepare('SELECT code,data FROM rooms').all()){
        const r=JSON.parse(row.data);
        const expired=(r.closedAt&&now-r.closedAt>7*86400000)||(r.status==='lobby'&&now-r.updatedAt>7*86400000);
        if(expired){if(this.aiRuntime){this.db.prepare('DELETE FROM ai_calls WHERE job IN (SELECT id FROM ai_jobs WHERE code=?)').run(row.code);this.db.prepare('DELETE FROM ai_jobs WHERE code=?').run(row.code);if(r.game)this.db.prepare('DELETE FROM ai_memory WHERE game=?').run(r.game.id);}
          this.db.prepare('DELETE FROM rooms WHERE code=?').run(row.code);this.db.prepare('DELETE FROM requests WHERE code=?').run(row.code);}
      }
      // Active/revealing games and their sessions are never age-evicted.
      const retained=new Set(this.db.prepare('SELECT data FROM rooms').all().flatMap(row=>JSON.parse(row.data).members.map(p=>p.session)));
      for(const s of this.db.prepare('SELECT id,created FROM sessions').all())if(!retained.has(s.id)&&now-s.created>30*86400000){this.db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);this.db.prepare('DELETE FROM requests WHERE session=?').run(s.id);this.seen.delete(s.id);}
      this.db.exec('COMMIT');
    }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
  }
}
