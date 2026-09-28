(function(){
const raw=db.rpc.bind(db);
function e(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function social(m){const a=Object.entries(m||{}).filter(([k,v])=>v&&k!=='other_label').map(([k,v])=>'<div class="rounded-lg border bg-white px-3 py-2"><b class="text-[10px]">'+e(k==='other'?(m.other_label||'Other'):k)+'</b><div class="text-xs mt-1 break-all">'+e(v)+'</div></div>');return a.length?'<div class="grid md:grid-cols-2 gap-2">'+a.join('')+'</div>':'<div class="text-xs text-gray-400">No social account recorded.</div>'}
const old=window.openActivityCustomerMasterRequest;
if(old)window.openActivityCustomerMasterRequest=function(id){
 const out=old.apply(this,arguments);
 setTimeout(async()=>{
  const f=document.getElementById('activityCustomerMasterRequestForm');if(!f)return;
  const w=f.querySelector('.border-amber-200');
  if(w)w.innerHTML='<b>CRM stage first → Manager/Admin approval.</b><div class="mt-1">This customer is already in Customer Database at the selected stage. Every Showroom/Online Convert / Link request waits for review before Customer Master is finalized.</div>';
  const r=await raw('get_customer_activity_contact_profile',{p_activity_id:id});
  if(!r.error&&r.data){const x=document.createElement('div');x.className='rounded-xl border bg-[#faf9f6] p-3';x.innerHTML='<div class="text-[10px] uppercase font-bold text-gray-400 mb-2">Contact Identity</div>'+social(r.data.contact_methods||{});document.getElementById('activityCustomerMasterRequestNote')?.parentElement?.before(x)}
 },0);
 return out;
};
})();