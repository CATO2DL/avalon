// Explicit user-requested independent browser-context E2E. All game actions use UI.
// Test clients only; not imported or exposed by either game server.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from '../.local/toolchain/node_modules/playwright/index.mjs';
import { expect } from '../.local/toolchain/node_modules/playwright/test.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp,rm,mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const artifact=new URL('../.local/multiplayer/',import.meta.url);await mkdir(artifact,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'avalon-web-'));const port=4182,base=`http://127.0.0.1:${port}`;
let child;
async function start(){child=spawn(process.execPath,['scripts/room-server.mjs','--lan'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),AVALON_DB:join(temp,'rooms.sqlite')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{if(b.toString().includes('阿瓦隆真人联机'))resolve();});child.stderr.on('data',b=>{if(b.toString().includes('EADDRINUSE'))reject(new Error(b));});child.once('exit',code=>reject(new Error(`server exited ${code}`)));});}
async function kill(){if(!child||child.exitCode!==null)return;const exit=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exit;}
await start();
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'});
const errors=[],clients=[],proof={contexts:5,steps:[],widths:[]};
try{
  for(let i=0;i<5;i++){
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const client={context,page,snapshot:null};clients.push(client);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',async response=>{if(/\/api\/rooms\/[A-F0-9]{10}$/.test(response.url())&&response.request().method()==='GET'&&response.status()===200){try{client.snapshot=await response.json();}catch{}}});
    await page.goto(i===0?base:clients[0].snapshot.inviteUrl);await page.getByRole('textbox',{name:'昵称',exact:true}).fill(`测试${i+1}`);
    if(i===0){await page.getByRole('button',{name:'创建房间',exact:true}).click();await page.getByRole('combobox',{name:'参与人数'}).selectOption('5');await page.getByRole('button',{name:'确认配置',exact:true}).click();await expect(page.locator('#room-screen h2')).toContainText('房间');}
    else{await new Promise(r=>setTimeout(r,1200));await expect(page.getByRole('textbox',{name:'昵称',exact:true})).toHaveValue(`测试${i+1}`);await expect(page.getByRole('textbox',{name:'房间码',exact:true})).toHaveValue(clients[0].snapshot.room.code);await page.getByRole('button',{name:'加入房间',exact:true}).click();await page.getByRole('button',{name:`${i+1}号 · 点击入座 空位`,exact:true}).click();}
    await page.getByRole('button',{name:'准备',exact:true}).click();await expect(page.getByRole('button',{name:'取消准备',exact:true})).toBeVisible();
  }
  const cookies=await Promise.all(clients.map(c=>c.context.cookies()));assert.equal(new Set(cookies.map(c=>c.find(x=>x.name.startsWith('avalon_room_')).value)).size,5);
  const host=clients[0];await expect(host.page.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled();
  await host.page.screenshot({path:fileURLToPath(new URL('lobby-mobile.png',artifact))});
  await host.page.getByRole('button',{name:'邀请朋友',exact:true}).click();await expect(host.page.locator('.invite-qr')).toBeVisible();await host.page.waitForFunction(()=>document.querySelector('.invite-qr')?.naturalWidth>0);await host.page.screenshot({path:fileURLToPath(new URL('invite.png',artifact))});await host.page.getByRole('button',{name:'关闭面板'}).click();
  await host.page.getByRole('button',{name:'开始游戏',exact:true}).click();
  for(const c of clients){await expect(c.page.locator('#room-screen')).toContainText('确认你的身份',{timeout:10000});await c.page.locator('#room-screen').getByRole('button',{name:'查看我的身份',exact:true}).click();await expect(c.page.getByRole('dialog')).toContainText('技能说明');await c.page.getByRole('button',{name:'关闭面板'}).click();await c.page.getByRole('button',{name:'我已查看，确认身份',exact:true}).click();}
  await expect(host.page.locator('.screen-layout')).toBeVisible();proof.steps.push('five isolated browsers: create/join/claim/ready/reveal/confirm');console.log('Browser lobby and identity confirmation passed');
  const original=host.snapshot.player.self;await host.page.reload();await expect(host.page.locator('.screen-layout')).toBeVisible();assert.deepEqual(host.snapshot.player.self,original);
  await host.context.setOffline(true);await new Promise(r=>setTimeout(r,1200));await host.context.setOffline(false);await expect(host.page.locator('#error')).toBeHidden({timeout:12000});assert.deepEqual(host.snapshot.player.self,original);proof.steps.push('reload/offline/reconnect same seat and role');
  let restarted=false,historyChecked=false,dropped=false;
  for(let loop=0;loop<120;loop++){
    await new Promise(r=>setTimeout(r,1100));
    if(clients.every(c=>c.snapshot?.view?.phase==='ended'))break;
    const active=clients.filter(c=>c.snapshot?.player?.legalActions.length);
    for(const c of active){
      const s=c.snapshot,a=s.player.legalActions[0],p=c.page;
      if(a.type==='propose_team'){
        for(const id of a.candidateIds.slice(0,a.teamSize)){const name=s.view.players.find(x=>x.id===id).name;await p.getByRole('button',{name:`选择${name}`,exact:true}).click();}
        await p.getByRole('button',{name:`确认队伍 ${a.teamSize} / ${a.teamSize}`,exact:true}).click();
      }else if(a.type==='vote'){
        if(!dropped){dropped=true;let once=true;await p.route('**/api/rooms/*',async route=>{if(once&&route.request().method()==='POST'){once=false;await route.fetch();await route.abort('failed');}else await route.continue();});proof.steps.push('lost action response retried with same persisted request ID');}
        await p.getByRole('button',{name:'赞成队伍',exact:true}).click();
        if(!restarted){
          await expect.poll(()=>c.snapshot.player.self.ownVote,{timeout:10000}).toBe('approve');const saved=c.snapshot.player.self;
          await kill();await start();await expect.poll(()=>c.snapshot?.player?.self.ownVote,{timeout:12000}).toBe('approve');
          await p.reload();await expect(p.locator('.screen-layout')).toBeVisible();assert.deepEqual(c.snapshot.player.self,saved);restarted=true;proof.steps.push('SIGKILL + new server process restores partial ballot and cookie');console.log('Browser process-restart recovery passed');
        }
      }else if(a.type==='quest_card'){await p.getByRole('button',{name:'任务成功',exact:true}).click();}
      else{const id=a.candidateIds[0],name=s.view.players.find(x=>x.id===id).name;await p.getByRole('button',{name:`选择目标${name}`,exact:true}).click();await p.getByRole('button',{name:'确认刺杀',exact:true}).click();}
    }
    if(!historyChecked&&host.snapshot.view.quests.length){await host.page.getByRole('button',{name:/第1次任务历史/}).click();await expect(host.page.getByRole('dialog')).toContainText('匿名汇总');await host.page.getByRole('button',{name:'关闭面板'}).click();historyChecked=true;}
  }
  assert.ok(clients.every(c=>c.snapshot.view.phase==='ended'));proof.steps.push('three successful quests, assassination and terminal reveal on all five browsers');
  for(const width of [320,375,390,430]){
    await host.page.setViewportSize({width,height:width===320?568:844});await expect(host.page.locator('.revealed-player')).toHaveCount(5);
    const layout=await host.page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:document.querySelectorAll('.revealed-player').length,loaded:[...document.querySelectorAll('.revealed-player img')].every(i=>i.complete&&i.naturalWidth>0)}));assert.ok(layout.scroll<=layout.width);assert.equal(layout.loaded,true);proof.widths.push(layout);
  }
  await host.page.setViewportSize({width:390,height:844});await host.page.screenshot({path:fileURLToPath(new URL('multiplayer-end.png',artifact))});
  await host.page.getByRole('button',{name:'查看我的身份',exact:true}).click();await expect(host.page.getByRole('dialog')).toContainText('技能说明');await host.page.screenshot({path:fileURLToPath(new URL('multiplayer-identity.png',artifact))});await host.page.getByRole('button',{name:'关闭面板'}).click();
  await host.page.route('**/assets/roles/*',route=>route.abort());await host.page.reload();await expect(host.page.locator('.screen-layout')).toBeVisible();await host.page.getByRole('button',{name:'查看我的身份',exact:true}).click();await expect(host.page.locator('#panel .image-fallback')).toBeVisible();await expect(host.page.getByRole('dialog')).toContainText('技能说明');await host.page.getByRole('button',{name:'关闭面板'}).click();await host.page.unroute('**/assets/roles/*');proof.steps.push('role image failure preserves ability text and neutral fallback');
  assert.deepEqual(errors,[]);proof.errors=errors;await writeFile(new URL('browser-results.json',artifact),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}catch(e){for(let i=0;i<clients.length;i++)await clients[i].page.screenshot({path:fileURLToPath(new URL(`failure-${i}.png`,artifact))}).catch(()=>{});throw e;}
finally{await browser.close();await kill();await rm(temp,{recursive:true,force:true});}
