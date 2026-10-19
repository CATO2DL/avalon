import { modelAdapter } from './model-adapter.mjs';
import { createRoomServer } from './room-server.mjs';
import { runAIMatch } from './ai-match.mjs';
import { fileURLToPath } from 'node:url';
const adapter=modelAdapter();
if(!adapter){console.error('MISSING_KEY：未发送请求。请填写新密钥后再验证。');process.exitCode=1;}
else{
  const server=createRoomServer({dbPath:fileURLToPath(new URL(`../.local/ai/real-match-${Date.now()}.sqlite`,import.meta.url)),aiAdapter:adapter,aiOptions:{maxCalls:process.env.AI_MAX_CALLS_PER_GAME??40,minInterval:process.env.AI_MIN_INTERVAL_MS??12000}});
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    console.log('开始真实模型验证：4个独立HTTP测试客户端 + Gemini；调用额度遵循配置（默认40，0表示本地不限），不会替换模型。');
    const result=await runAIMatch(`http://127.0.0.1:${server.address().port}`,{delay:250,maxSteps:4800,recoverAI:true,onRecovery:code=>console.log(`HOST_RECOVERY_ONCE：${code}；使用原任务重试，仍计调用上限。`)});
    console.log(`REAL_MODEL_MATCH_COMPLETE：${result.players}人，${result.outcome.reason}。真人多设备试玩仍需单独验证。`);
  }catch(e){const code=/^[A-Z_]+$/.test(e.message)?e.message:'VALIDATION_FAILED';console.error(`REAL_MODEL_MATCH_FAILED：${code}`);process.exitCode=1;}
  finally{server.closeIdleConnections();await new Promise(r=>server.close(r));}
}
