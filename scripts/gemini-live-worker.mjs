import { parentPort, workerData } from 'node:worker_threads';
import { GoogleGenAI } from '../.local/toolchain/node_modules/@google/genai/dist/node/index.mjs';
import { liveDecision } from './gemini-live-session.mjs';
import { safeModelError } from './gemini.mjs';
// SDK 2.30 Live connect cannot close a socket until setupComplete. The parent always
// terminates this worker on result/timeout/abort, including a stalled handshake.
try{
  const client=new GoogleGenAI({apiKey:workerData.apiKey,vertexai:false,httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1}}});
  const result=await liveDecision(client,workerData.model,workerData.input,undefined,{onProgress:stage=>parentPort.postMessage({progress:stage})});
  parentPort.postMessage({result});
}catch(e){parentPort.postMessage({error:safeModelError(e).message,...(e.formatReason==='MISSING_TOOL_CALL'?{formatReason:e.formatReason}:{})});}
