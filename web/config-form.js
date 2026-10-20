import {el,button} from './ui.js';
import {roleAssets} from './asset-map.js';
export function configEditor(options,initial,onSave){
 const box=el('div','config-editor');let n=initial.playerCount,mode=initial.rejectionMode??'consecutive',counts={},config;
 const countRow=el('div','counter-row'),countText=el('strong');
 const step=(label,minus,plus,value)=>{const row=el('div','counter-row');const m=button('−',minus),p=button('+',plus);m.setAttribute('aria-label',`减少${label}`);p.setAttribute('aria-label',`增加${label}`);row.append(el('span','',label),m,value,p);return row;};
 const roster=el('div','role-counters'),summary=el('p','config-summary'),note=el('p','panel-note');summary.setAttribute('aria-live','polite');
 const save=button('确认配置',()=>onSave(config),'primary');
 const rules=()=>options.find(x=>x.rules.playerCount===n).rules;
 function load(roles){counts=Object.fromEntries(Object.keys(roleAssets).map(id=>[id,roles.filter(r=>r===id).length]));}
 function fill(){for(const [alignment,id] of [['正义','loyal'],['邪恶','minion']]){const limit=alignment==='正义'?rules().goodCount:rules().evilCount;counts[id]=Math.max(0,limit-Object.keys(counts).filter(k=>k!==id&&roleAssets[k].alignment===alignment).reduce((a,k)=>a+counts[k],0));}}
 function recommend(){load(options.find(x=>x.rules.playerCount===n).recommendedRoles);refresh();}
 const count=step('参与人数',()=>{if(n>5){n--;recommend();}},()=>{if(n<10){n++;recommend();}},countText);
 const modeLabel=el('label','field','组队否决规则'),modeSelect=el('select');modeSelect.setAttribute('aria-label','组队否决规则');
 for(const [id,text] of [['consecutive','标准 · 连续五次否决'],['cumulative','家规 · 全局累计五次否决']]){const o=el('option','',text);o.value=id;modeSelect.append(o);}modeSelect.value=mode;modeSelect.onchange=()=>{mode=modeSelect.value;refresh();};modeLabel.append(modeSelect);
 function refresh(){countText.textContent=`${n} 人`;count.querySelectorAll('button')[0].disabled=n===5;count.querySelectorAll('button')[1].disabled=n===10;roster.replaceChildren();
 for(const [id,role] of Object.entries(roleAssets)){const fixed=['merlin','assassin'].includes(id),ordinary=['loyal','minion'].includes(id);const value=el('strong','',String(counts[id]));
 const change=delta=>{counts[id]+=delta;if(!ordinary)fill();refresh();};const row=step(role.name,()=>change(-1),()=>change(1),value);row.querySelectorAll('button')[0].disabled=fixed||counts[id]===0;row.querySelectorAll('button')[1].disabled=fixed||counts[id]>=(ordinary?n:1);roster.append(row);}
 const good=Object.keys(counts).filter(id=>roleAssets[id].alignment==='正义').reduce((a,id)=>a+counts[id],0),evil=Object.values(counts).reduce((a,v)=>a+v,0)-good,r=rules(),valid=good===r.goodCount&&evil===r.evilCount;
 summary.textContent=`正义 ${good}/${r.goodCount} · 邪恶 ${evil}/${r.evilCount} · ${good+evil===n?'名额已满':good+evil<n?`剩余 ${n-good-evil} 人`:`超出 ${good+evil-n} 人`}${valid?'':'；人数或阵营比例不符，请调整或自动补齐'}`;
 note.textContent='调整特殊角色会自动补齐普通角色；普通角色也可手动加减。'+(counts.percival&&!counts.morgana?'没有莫甘娜时，派西维尔只看到梅林。':'');
 config={playerCount:n,roles:Object.entries(counts).flatMap(([id,k])=>Array(k).fill(id)),rejectionMode:mode};save.disabled=!valid;
 }
 load(initial.roles);box.append(count,roster,button('使用推荐配置',recommend),button('自动补齐普通角色',()=>{fill();refresh();}),summary,note,modeLabel,save);refresh();return box;
}
