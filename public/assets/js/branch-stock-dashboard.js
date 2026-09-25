import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
const tabsCss=document.createElement('link');tabsCss.rel='stylesheet';tabsCss.href='assets/css/branch-stock-tabs.css?v=1';document.head.appendChild(tabsCss);
const dashboardCss=document.createElement('link');dashboardCss.rel='stylesheet';dashboardCss.href='assets/css/branch-stock-dashboard.css?v=2';document.head.appendChild(dashboardCss);
const supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const branches=[['branch-1','ទីតាំងទី ១','ABA Grand Phnom Penh'],['branch-2','ទីតាំងទី ២','Russey Keo (598)'],['branch-3','ទីតាំងទី ៣','AEON Mall Sen Sok']];
let products=[];let quantities={};let activeBranch='branch-1';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
async function load(){
  const [{data:ps,error:pe},{data:q,error:qe}]=await Promise.all([supabase.from('products').select('*').order('sort_order',{ascending:true}),supabase.from('site_settings').select('value').eq('key','branch_menu_quantities').maybeSingle()]);
  if(pe||qe) throw pe||qe;
  products=ps||[]; try{quantities=q?.value?JSON.parse(q.value):{}}catch{quantities={}}; render();
  document.getElementById('stockStatus').textContent=`Updated ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`;
}
function render(){const tabs=document.getElementById('branchStockTabs');if(!tabs)return;tabs.innerHTML=branches.map(([id,name])=>`<button class="branchStockTab${id===activeBranch?' active':''}" data-branch-tab="${id}" type="button">${name}</button>`).join('');const [id,name,address]=branches.find(item=>item[0]===activeBranch)||branches[0];const map=quantities[id]||{};const items=products.filter(p=>Object.prototype.hasOwnProperty.call(map,p.id));const total=items.reduce((s,p)=>s+Math.max(0,Number(map[p.id])||0),0);document.getElementById('branchStockGrid').innerHTML=`<article class="branchStockCard"><header class="branchStockHead"><div><h2>${name}</h2><small>${address}</small></div><div class="branchStockTotal"><strong>${total}</strong><span>portions left</span></div></header><div class="branchStockList">${items.map(p=>{const n=Math.max(0,Number(map[p.id])||0);return `<div class="stockItem"><img src="${esc(p.image_url||'img/placeholder.jpg')}" alt=""><div><strong>${esc(p.name||p.id)}</strong><small>${esc(p.id)}</small></div><span class="stockQty${n===0?' empty':''}">${n}</span></div>`}).join('')||'<p class="stockEmpty">No menu selected today</p>'}</div></article>`}
document.getElementById('branchStockTabs').addEventListener('click',e=>{const tab=e.target.closest('[data-branch-tab]');if(tab){activeBranch=tab.dataset.branchTab;render()}});
document.getElementById('stockRefresh').addEventListener('click',()=>load().catch(e=>document.getElementById('stockStatus').textContent=e.message));
supabase.channel('branch-stock-dashboard').on('postgres_changes',{event:'*',schema:'public',table:'site_settings'},p=>{if((p.new?.key||p.old?.key)==='branch_menu_quantities')load().catch(()=>{})}).subscribe();
load().catch(e=>document.getElementById('stockStatus').textContent=e.message);setInterval(()=>load().catch(()=>{}),15000);
