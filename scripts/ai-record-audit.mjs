// Read-only local audit. Outputs only per-player historical inputs, never a full room or credentials.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {withStrategy} from './avalon-strategy.mjs';
process.umask(0o077);
const dbPath=process.argv[2],out=process.argv[3];if(!dbPath||!out)throw new Error('Usage: node scripts/ai-record-audit.mjs database.sqlite NEW-private-output-directory');
if(existsSync(out))throw new Error('Refusing to overwrite an earlier audit');
const db=new DatabaseSync(dbPath,{readOnly:true});
const hasDecision=db.prepare('PRAGMA table_info(ai_calls)').all().some(c=>c.name==='decision');
const rows=db.prepare(`SELECT c.rowid id,c.status,c.model,c.elapsed,c.input,${hasDecision?'c.decision':'NULL'} attemptDecision,j.result FROM ai_calls c JOIN ai_jobs j ON j.id=c.job ORDER BY c.rowid`).all();
const records=rows.map(r=>({id:r.id,status:r.status,model:r.model,elapsedMs:r.elapsed,input:JSON.parse(r.input),decision:r.attemptDecision?JSON.parse(r.attemptDecision):r.status==='done'&&r.result?JSON.parse(r.result):null}));
mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'records.json'),JSON.stringify(records,null,2),{mode:0o600});
// Freeze current strategy now; historical strategy remains in records[].input.strategy if present.
const cases=records.filter(r=>r.status==='done').map(r=>({id:`record-${r.id}`,source:'historical-filtered-input',baseline:withStrategy(r.input),original:r.decision}));
writeFileSync(resolve(out,'available-cases.json'),JSON.stringify(cases,null,2),{mode:0o600});
console.log(JSON.stringify({records:records.length,successful:cases.length,notice:'Private local outputs; select at most six cases before strategy editing. Failed attempts are not assigned a later successful result.'}));db.close();
