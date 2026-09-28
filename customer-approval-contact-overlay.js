(function(){
const raw=db.rpc.bind(db);
function e(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function patch(){document.querySelectorAll('.review-c-contact').forEach(row=>{const s=row.querySelector('.rc-type');if(!s)return;for(const t of ['facebook','instagram'])if(![...s.options].some(o=>o.value===t)){const o=document.createElement('option');o.value=t;o.textContent=t[0].toUpperCase()+t.slice(1);s.appendChild(o)}const l=(row.querySelector('.rc-label')?.value||'').toLowerCase();if(l.includes('facebook'))s.value='facebook';else if(l.includes('instagram'))s.value='instagram'})}
const old=window.openCustomerRequestDetail;
if(old)window.openCustomerRequestDetail=async function(id){
 const out=await old.apply(this,arguments);patch();
 const r=await raw('get_customer_request_activity_context',{p_request_id:id}),d=r.data||{},f=document.getElementById('reviewCustomerRequestForm');
 if(!r.error&&d.activity_type&&f&&!f.querySelector('[data-activity-context]')){
  const b=document.createElement('div');b.dataset.activityContext='1';b.className='md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-4';
  b.innerHTML='<div class="text-[10px] uppercase font-bold text-blue-500 mb-2">Showroom / Online CRM Context</div><div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs"><div>Type: <b>'+e(d.activity_type==='online'?'Online':'Showroom Visit')+'</b></div><div>Date: <b>'+e(d.activity_date||'-')+'</b></div><div>Stage: <b>'+e(d.stage||'-')+'</b></div><div>Business: <b>'+e(d.business||'-')+'</b></div><div>Source: <b>'+e(d.source||'-')+'</b></div><div class="sm:col-span-2">Interest: <b>'+e(d.interest||'-')+'</b></div><div class="sm:col-span-2">Remark: <b>'+e(d.remark||'-')+'</b></div></div>';
  f.insertBefore(b,f.children[1]||null);
 }
 return out;
};
const add=window.addReviewCustomerContact;if(add)window.addReviewCustomerContact=function(){const r=add.apply(this,arguments);patch();return r};
})();