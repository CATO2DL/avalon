// Three bounded synthetic speech cases, not a complete-match or win-rate benchmark.
import {mkdir,writeFile} from 'node:fs/promises';
import {providerRegistry} from './ai-providers.mjs';
import {modelInput} from '../src/ai.ts';
import {getPlayerView} from '../src/index.ts';
import {fixture,roleId,playQuest} from '../tests/helpers.mjs';
const id=process.argv[2]??'gemini',adapter=providerRegistry().forProfile(id);
if(!adapter){console.error('AI_NOT_CONFIGURED');process.exitCode=1;}
else{
 const initial=fixture(6,92),success=playQuest(initial,0),report={provider:id,model:adapter.model,scope:'synthetic speech samples; manual review required; no win-rate claim',cases:[]};
 for(const [name,g,role] of [['merlin-opening',initial,'merlin'],['merlin-after-success',success,'merlin'],['loyal-after-success',success,'loyal']]){
  const actor=roleId(g,role),other=g.players.find(p=>p.id!==actor).id;
  const messages=name==='merlin-opening'?[]:[{playerId:other,text:'首轮任务成功，原车全是正义，继续原车就稳了。',turnId:'synthetic-claim'}];
  const input=modelInput(getPlayerView(g,actor),messages,'','speech','speech-evaluation');const start=Date.now();
  try{const r=await adapter.decide(input,AbortSignal.timeout(30000));report.cases.push({name,status:'valid',speech:r.decision.speech,elapsedMs:Date.now()-start,tokens:r.tokens});}
  catch(e){report.cases.push({name,status:'failed',code:/^[A-Z_]+$/.test(e.message)?e.message:'CHECK_FAILED'});process.exitCode=1;}
 }
 await mkdir(new URL('../.local/ai/',import.meta.url),{recursive:true});await writeFile(new URL('../.local/ai/speech-evaluation.json',import.meta.url),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify(report.cases.map(({name,status,code,elapsedMs})=>({name,status,code,elapsedMs}))));
}
