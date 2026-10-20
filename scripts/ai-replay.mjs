// Local, opt-in bounded A/B replay. Never imports a Room or changes a live game.
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {withStrategy} from './avalon-strategy.mjs';
import {decisionBrief} from '../src/ai-brief.ts';
if(!isMainThread){
 try{
  const {GoogleGenAI}=await import('../.local/toolchain/node_modules/@google/genai/dist/node/index.mjs');
  const {liveDecision}=await import('./gemini-live-session.mjs');
  const client=new GoogleGenAI({apiKey:workerData.apiKey,vertexai:false,httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1}}});
  let turns=0;const connect=client.live.connect.bind(client.live);
  client.live.connect=async options=>{const session=await connect(options),send=session.sendClientContent.bind(session);session.sendClientContent=c=>{turns++;send(c);};return session;};
  const result=await liveDecision(client,workerData.model,workerData.input,undefined,{prepare:i=>i});
  parentPort.postMessage({result,turns});
 }catch(e){parentPort.postMessage({error:/^[A-Z_]+$/.test(e.message)?e.message:'CHECK_FAILED'});}
}else{
 process.umask(0o077);
 const casesPath=process.argv[2],out=process.argv[3];
 if(!casesPath||!out)throw new Error('Usage: node --env-file-if-exists=.env scripts/ai-replay.mjs cases.json output.json');
 if(existsSync(out))throw new Error('Output exists; refusing accidental repeated evaluation');
 const model=process.env.GEMINI_MODEL;if(model!=='gemini-3.8-live')throw new Error('REPLAY_MODEL_NOT_SUPPORTED: no model switch');
 if(!process.env.GEMINI_API_KEY)throw new Error('MISSING_KEY');
 const cases=JSON.parse(readFileSync(casesPath,'utf8'));if(!Array.isArray(cases)||cases.length>6)throw new Error('Budget: at most six paired cases, 12 sessions / 24 turns');
 const report={model,parameters:{responseModalities:['AUDIO'],maxOutputTokens:4096,timeoutMs:30000,temperature:'provider-default',strategyOnlyAndDerivedBrief:true},budget:{maxSessions:12,maxTurns:24,reservedTurns:0},results:[]};
 const save=()=>{mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2),{mode:0o600});};
 save();
 for(const [index,c] of cases.entries()){
  for(const variant of process.argv.includes('--candidate-only')?['candidate']:(index%2?['candidate','baseline']:['baseline','candidate'])){
   const input=variant==='baseline'?structuredClone(c.baseline):withStrategy({...structuredClone(c.baseline),context:{...c.baseline.context,brief:decisionBrief(c.baseline.view,c.baseline.publicMessages)}});
   if(!input.strategy?.text||input.view.roles||input.game||input.room)throw new Error('Invalid filtered replay input');
   report.budget.reservedTurns+=2;const row={caseId:c.id,source:c.source,variant,strategy:input.strategy.version,inputHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),status:'inflight'};report.results.push(row);save();
   const start=Date.now();
   const response=await new Promise(resolve=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{input,model,apiKey:process.env.GEMINI_API_KEY},stdout:true,stderr:true});worker.stdout.resume();worker.stderr.resume();let settled=false;
    const finish=r=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolve(r);};
    const timer=setTimeout(()=>finish({error:'TIMEOUT'}),30000);worker.on('message',finish);worker.on('error',()=>finish({error:'WORKER_ERROR'}));worker.on('exit',()=>finish({error:'WORKER_EXIT'}));
   });
   Object.assign(row,response.error?{status:'failed',error:response.error}:{status:'valid',decision:response.result.decision,tokens:response.result.tokens,turns:response.turns});row.elapsedMs=Date.now()-start;save();
   console.log(JSON.stringify({caseId:c.id,variant,status:row.status,error:row.error,elapsedMs:row.elapsedMs}));
  }
 }
}
