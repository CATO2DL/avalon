// Offline browser integration fixture. This mock is never served to ordinary clients.
import assert from 'node:assert/strict';
import { chromium } from '../.local/toolchain/node_modules/playwright/index.mjs';
import { expect } from '../.local/toolchain/node_modules/playwright/test.mjs';
import { createRoomServer } from './room-server.mjs';
import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const multi=process.argv.includes('--multi'),humanCount=multi?1:4;
const artifact=new URL(multi?'../.local/ai/multi/':'../.local/ai/',import.meta.url);await mkdir(artifact,{recursive:true});
let calls=0;
const adapter={model:'BROWSER-MOCK-ONLY',async decide(input){calls++;return {decision:{choice:0,speech:input.kind==='speech'?'先看这支队伍的表现。':'',memory:'PRIVATE_BROWSER_TEST'},model:'BROWSER-MOCK-ONLY',tokens:1};}};
const server=createRoomServer({dbPath:':memory:',aiAdapter:adapter,aiOptions:{minInterval:0}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'}),clients=[],errors=[];
try{
  for(let i=0;i<humanCount;i++){
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),c={context,page,snapshot:null};clients.push(c);
    page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(/\/api\/rooms\/[A-F0-9]{10}$/.test(r.url())&&r.request().method()==='GET'&&r.status()===200){try{c.snapshot=await r.json();assert.ok(!JSON.stringify(c.snapshot).includes('PRIVATE_BROWSER_TEST'));}catch(e){errors.push(e.message);}}});
    await page.goto(i===0?base:`${base}/?room=${clients[0].snapshot.room.code}`);await page.getByRole('textbox',{name:'昵称',exact:true}).fill(`真人${i+1}`);
    if(i===0){await page.getByRole('button',{name:'创建房间',exact:true}).click();await page.getByRole('combobox',{name:'参与人数'}).selectOption('5');await page.getByRole('button',{name:'确认配置',exact:true}).click();await expect(page.locator('#room-screen h2')).toContainText('房间');}
    else{await page.getByRole('button',{name:'加入房间',exact:true}).click();await page.getByRole('button',{name:`${i+1}号 · 点击入座 空位`,exact:true}).click();}
  }
  const host=clients[0];await expect.poll(()=>host.snapshot?.room.members.filter(p=>p.seat!==null).length).toBe(humanCount);
  for(let seat=humanCount+1;seat<=5;seat++){
    await host.page.getByRole('combobox',{name:'AI 座位'}).selectOption(String(seat));await host.page.getByRole('button',{name:'添加 AI 玩家',exact:true}).click();await expect(host.page.getByRole('button',{name:`移除 AI · ${seat}号`,exact:true})).toBeVisible();
  }
  if(multi){
    await host.page.getByRole('button',{name:'移除 AI · 3号',exact:true}).click();await expect(host.page.getByRole('button',{name:'移除 AI · 3号',exact:true})).toHaveCount(0);
    await expect(host.page.getByRole('button',{name:'移除 AI · 2号',exact:true})).toBeVisible();
    await host.page.getByRole('combobox',{name:'AI 座位'}).selectOption('3');await host.page.getByRole('button',{name:'添加 AI 玩家',exact:true}).click();await expect(host.page.getByRole('button',{name:'移除 AI · 3号',exact:true})).toBeVisible();
    await host.page.setViewportSize({width:320,height:844});assert.ok(await host.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await host.page.setViewportSize({width:390,height:844});
  }
  await host.page.screenshot({path:fileURLToPath(new URL('ai-lobby-mobile.png',artifact))});
  for(const c of clients)await c.page.getByRole('button',{name:'准备',exact:true}).click();await expect(host.page.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled();await host.page.getByRole('button',{name:'开始游戏',exact:true}).click();
  for(const c of clients){await expect(c.page.locator('#room-screen')).toContainText('确认你的身份',{timeout:12000});await c.page.locator('#room-screen').getByRole('button',{name:'查看我的身份',exact:true}).click();await c.page.getByRole('button',{name:'关闭面板'}).click();await c.page.getByRole('button',{name:'我已查看，确认身份',exact:true}).click();}
  let screenshot=false,reloaded=false,spoke=false;
  for(let loop=0;loop<150;loop++){
    await new Promise(r=>setTimeout(r,1100));if(clients.every(c=>c.snapshot?.room.status==='finished'))break;
    for(const c of clients){const s=c.snapshot,p=c.page,d=s?.room.discussion;
      if(d?.active&&d.speakerId===s.room.selfId){await p.getByRole('button',{name:'发言 / 跳过',exact:true}).click();await expect(p.getByRole('textbox',{name:'公开发言'})).toBeVisible();
        if(!screenshot){await p.getByRole('textbox',{name:'公开发言'}).fill('我想先看看这次队伍。');await p.waitForTimeout(350);await p.screenshot({path:fileURLToPath(new URL('ai-discussion-mobile.png',artifact))});screenshot=true;}
        if(!spoke){await p.getByRole('button',{name:'发送发言',exact:true}).click();spoke=true;}else await p.getByRole('button',{name:'跳过发言',exact:true}).click();await p.getByRole('button',{name:'关闭面板'}).click();continue;
      }
      const a=s?.player?.legalActions[0];if(!a)continue;
      if(a.type==='propose_team'){for(const id of a.candidateIds.slice(0,a.teamSize))await p.getByRole('button',{name:`选择${s.view.players.find(x=>x.id===id).name}`,exact:true}).click();await p.getByRole('button',{name:`确认队伍 ${a.teamSize} / ${a.teamSize}`,exact:true}).click();}
      else if(a.type==='vote'){await p.getByRole('button',{name:'赞成队伍',exact:true}).click();if(!reloaded){const id=s.player.self.playerId;await p.reload();await expect.poll(()=>c.snapshot?.player?.self?.playerId).toBe(id);reloaded=true;}}
      else if(a.type==='quest_card')await p.getByRole('button',{name:'任务成功',exact:true}).click();
      else{const name=s.view.players.find(x=>x.id===a.candidateIds[0]).name;await p.getByRole('button',{name:`选择目标${name}`,exact:true}).click();await p.getByRole('button',{name:'确认刺杀',exact:true}).click();}
    }
  }
  await expect(host.page.locator('.revealed-player')).toHaveCount(5);const widths=[];
  for(const width of [320,375,390,430]){await host.page.setViewportSize({width,height:844});assert.ok(await host.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));widths.push(width);}
  await host.page.setViewportSize({width:390,height:844});await host.page.screenshot({path:fileURLToPath(new URL('ai-end-mobile.png',artifact))});
  assert.ok(calls>0);assert.deepEqual(errors,[]);const proof={adapter:'OFFLINE MOCK, not Gemini',contexts:humanCount,aiPlayers:5-humanCount,players:5,calls,widths,discussion:true,reload:true,outcome:host.snapshot.view.outcome,errors};await writeFile(new URL('ai-browser-results.json',artifact),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}catch(e){for(let i=0;i<clients.length;i++)await clients[i].page.screenshot({path:fileURLToPath(new URL(`ai-failure-${i}.png`,artifact))}).catch(()=>{});throw e;}
finally{await browser.close();server.closeIdleConnections();await new Promise(r=>server.close(r));}
