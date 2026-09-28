(function(){
const old=window.openCustomerLead;if(!old||!window.db)return;
const raw=db.rpc.bind(db);
function e(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
window.openCustomerLead=async function(id){
 const out=await old.apply(this,arguments);
 const r=await raw('get_customer_lead_contact_profile',{p_lead_id:id}),m=r.data?.contact_methods||{},body=document.getElementById('leadDetailBody');
 if(r.error||!body||!Object.keys(m).length||body.querySelector('[data-crm-social]'))return out;
 const labels={facebook:'Facebook / Messenger',telegram:'Telegram',instagram:'Instagram',whatsapp:'WhatsApp',wechat:'WeChat',line:'Line',email:'Email',other:'Other'};
 const rows=Object.entries(m).filter(([k,v])=>v&&k!=='other_label').map(([k,v])=>'<div class="rounded-lg border bg-white px-3 py-2"><div class="text-[9px] uppercase font-bold text-gray-400">'+e(k==='other'?(m.other_label||'Other'):(labels[k]||k))+'</div><div class="text-xs mt-1 break-all">'+e(v)+'</div></div>').join('');
 const box=document.createElement('div');box.dataset.crmSocial='1';box.className='rounded-xl border bg-[#faf9f6] p-4 mt-4';box.innerHTML='<div class="text-[10px] uppercase font-bold text-gray-400 mb-2">Contact / Social Accounts</div><div class="grid md:grid-cols-2 gap-2">'+rows+'</div>';
 const first=body.querySelector('.border-t');first?first.before(box):body.appendChild(box);
 return out;
};
})();