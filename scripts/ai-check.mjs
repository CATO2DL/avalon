import {createTestGame} from '../src/testing.ts';
import {getPlayerView} from '../src/index.ts';
import {modelInput} from '../src/ai.ts';
import { providerRegistry } from './ai-providers.mjs';
// Exactly one short provider request; never echo provider errors or model content.
const profile=process.argv[2]??'gemini';
const adapter=providerRegistry().forProfile(profile);
if(!adapter){console.error('MISSING_KEY：请在本地 .env 填写新密钥。未发送请求。');process.exitCode=1;}
else{
  try{const game=createTestGame({playerCount:5},Array.from({length:5},(_,i)=>({id:`p${i}`,name:`测试玩家${i+1}`})),42);
    const input=modelInput(getPlayerView(game,'p0'),[],'','speech','connection-check');
    await adapter.decide(input,AbortSignal.timeout(30000));console.log('AI_CONNECTED：一次结构化响应通过；未验证完整对局或账号计费层。');}
  catch(e){console.error(`AI_CHECK_FAILED：${e.message}`);process.exitCode=1;}
}
