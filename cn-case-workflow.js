// CN workflow: independent management approval, physical stock intake,
// explicit finance decision, and automatic case closure.
// All mutations are permission-checked in Supabase RPCs.
(function(){
'use strict';
const text=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roles=['manager','admin','super_admin'];
const canApprove=()=>roles.includes(state?.profile?.role)&&
 (typeof window.hasAppPermission!=='function'||window.hasAppPermission('returns.approve'));
let cases=new Map();
const get=id=>cases.get(String(id));
const badge=c=>{
 if(!c)return '';
 const closed=!!c.closed_at,pending=c.approval_status==='pending',
 rejected=c.approval_status==='rejected';
 const label=closed?'Case Closed':pending?'Awaiting CN Approval':rejected?'CN Rejected':!c.stock_complete?'Awaiting Stock Receipt':'Awaiting Financial Decision';
 const cls=closed?'bg-green-50 border-green-200 text-green-800':rejected?'bg-red-50 border-red-200 text-red-700':pending?'bg-amber-50 border-amber-200 text-amber-800':'bg-blue-50 border-blue-200 text-blue-800';
 return '<span class="inline-flex text-[10px] font-bold px-2.5 py-1 rounded-lg border '+cls+'">'+text(label)+'</span>';
};
async function load(){
 const r=await db.rpc('get_visible_cn_case_workflows');
 if(r.error)throw r.error;
 cases=new Map((Array.isArray(r.data)?r.data:[]).map(c=>[String(c.return_id),c]));
}
function labelFor(id){return badge(get(id))}
function actions(){
 document.querySelectorAll('#salesReturnRows > div').forEach(row=>{
   const trigger=row.querySelector('button[onclick^="viewSalesReturn("]');
   const id=String(trigger?.getAttribute('onclick')||'').match(/viewSalesReturn\('([^']+)'\)/)?.[1];
   if(!id)return;
   const c=get(id);if(!c)return;
   row.querySelectorAll('[data-cn-case]').forEach(x=>x.remove());
   const approvalBadge=document.createElement('div');approvalBadge.dataset.cnCase='1';
   const approval=c.approval_status==='approved'?'Approved':c.approval_status==='pending'?'Pending Approval':c.approval_status==='rejected'?'Rejected':'Unknown';
   const approvalTone=c.approval_status==='approved'?'bg-green-50 text-green-800 border-green-200':c.approval_status==='rejected'?'bg-red-50 text-red-800 border-red-200':'bg-amber-50 text-amber-900 border-amber-300';
   approvalBadge.innerHTML='<div class="text-[9px] uppercase font-bold text-gray-500 mb-1">CN Approval</div><span class="inline-flex rounded-md border px-2 py-1 text-[10px] font-bold '+approvalTone+'">'+text(approval)+'</span><div class="mt-1">'+badge(c)+'</div>';
   const statusHolder=[...row.querySelectorAll('div')].find(x=>x.classList.contains('flex-col')&&x.classList.contains('items-start'));
   if(statusHolder)statusHolder.prepend(approvalBadge);
   if(c.approval_status==='pending')row.classList.add('border-amber-300');
   const buttons=trigger.parentElement;
   if(!buttons)return;
   // Old "Received" button bypasses approval. The new process uses warehouse receipt.
   [...buttons.querySelectorAll('button')].forEach(b=>{
     const t=b.textContent.trim();
     if(t==='Received')b.style.display='none';
     if(['Edit','Cancel','Delete'].includes(t)&&c.approval_status==='approved')b.style.display='none';
     if(t==='Apply Customer Credit'&&
       (c.approval_status!=='approved'||!c.stock_complete||!!c.closed_at))b.style.display='none';
     if(t==='Remove Credit'&&!!c.closed_at)b.style.display='none';
   });
   const add=(title,fn,cls)=>{
     const b=document.createElement('button');b.type='button';
     b.dataset.cnCase='1';b.textContent=title;
     b.className='px-3 py-2 rounded-lg text-xs font-semibold border '+cls;
     b.onclick=fn;buttons.appendChild(b);
   };
   if(c.approval_status==='pending'&&canApprove()&&c.requested_by!==state.user?.id){
     add('Approve CN',()=>window.reviewCNCase(id,true),'border-green-200 bg-green-50 text-green-800');
     add('Reject CN',()=>window.reviewCNCase(id,false),'border-red-200 bg-red-50 text-red-700');
   }
   if(c.approval_status==='rejected'&&state.profile?.role!=='stock_controller'){
     add('Resubmit CN',()=>window.resubmitCNCase(id),'border-amber-200 bg-amber-50 text-amber-800');
   }
   if(c.approval_status==='approved'&&c.stock_complete&&c.financial_decision==='pending'&&canApprove()){
     add('Close Without Credit',()=>window.finalizeCNNoCredit(id),'border-blue-200 bg-blue-50 text-blue-800');
   }
 });
}
const priorRender=window.renderReturnsPage;
if(typeof priorRender==='function')window.renderReturnsPage=async function(){
 await priorRender.apply(this,arguments);
 try{
  await load();actions();
  const root=document.getElementById('salesReturnsRoot');
  const old=root?.querySelector('[data-cn-approval-summary]');
  if(old)old.remove();
  if(root&&canApprove()){
    const pending=[...cases.values()].filter(c=>c.approval_status==='pending'&&c.requested_by!==state.user?.id);
    if(pending.length){
      const panel=document.createElement('div');
      panel.dataset.cnApprovalSummary='1';
      panel.className='mb-4 p-4 rounded-xl border border-amber-200 bg-amber-50 flex flex-wrap justify-between items-center gap-3';
      panel.innerHTML='<div><b class="text-sm text-amber-900">Pending CN Approvals · '+pending.length+'</b>'+
       '<div class="text-xs text-amber-800 mt-1">These Credit Notes are already visible to Stock, but warehouse receipt is blocked until Manager/Admin approval.</div></div>'+
       '<div class="text-xs text-amber-700 font-semibold">'+pending.map(c=>text(c.cn_no)).join(' · ')+'</div>';
      root.insertBefore(panel,root.firstChild);
    }
  }
 }catch(err){console.warn('CN case status unavailable:',err.message)}
};
const priorFilter=window.filterSalesReturns;
if(typeof priorFilter==='function')window.filterSalesReturns=function(){
 const r=priorFilter.apply(this,arguments);actions();return r;
};
const priorView=window.viewSalesReturn;
if(typeof priorView==='function')window.viewSalesReturn=async function(id){
 await priorView.apply(this,arguments);
 const c=get(id);if(!c)return;
 const body=document.getElementById('modalBody');if(!body)return;
 body.querySelectorAll('[data-cn-case-detail]').forEach(x=>x.remove());
 const panel=document.createElement('section');panel.dataset.cnCaseDetail='1';
 panel.className='rounded-xl border border-blue-200 bg-[#f9fbff] p-4 space-y-3';
 panel.innerHTML='<div class="flex flex-wrap justify-between gap-2 items-center"><b class="text-sm">CN Approval & Case Progress</b>'+badge(c)+'</div>'+
  '<div class="grid sm:grid-cols-3 gap-2 text-xs">'+
  '<div class="bg-white border rounded-lg p-3"><div class="text-[10px] text-gray-500">Management Approval</div><b>'+text(c.approval_status)+'</b></div>'+
  '<div class="bg-white border rounded-lg p-3"><div class="text-[10px] text-gray-500">Stock Receipt</div><b>'+(cancellation?'Not required':c.stock_complete?'Completed':'Pending')+'</b></div>'+
  '<div class="bg-white border rounded-lg p-3"><div class="text-[10px] text-gray-500">Customer Credit Decision</div><b>'+text(c.financial_decision==='no_credit'?'No Credit':c.financial_decision==='credit_ar'?'Credit Approved':'Pending')+'</b></div></div>'+
  (c.approval_note?'<p class="text-xs text-gray-600">Manager note: '+text(c.approval_note)+'</p>':'')+
  '<p class="text-[11px] text-gray-600">'+(cancellation?'Approval cancels undelivered quantities, releases reservations, and applies credit to source invoices. Excess remains customer credit. No stock receipt; deposits and payments are preserved.':'Stock sees the CN immediately, but can receive saleable items only after Manager/Admin approves. The case closes after required stock receipts and an explicit credit/no-credit decision.')+'</p>'+
  '<div class="flex flex-wrap gap-2" id="cnCaseDetailActions"></div>';
 body.prepend(panel);
 const b=panel.querySelector('#cnCaseDetailActions');
 const add=(title,fun,cls)=>{const button=document.createElement('button');
 button.type='button';button.className='border rounded-lg px-3 py-2 text-xs font-bold '+cls;button.textContent=title;button.onclick=fun;b.appendChild(button)};
 if(c.approval_status==='pending'&&canApprove()&&c.requested_by!==state.user?.id){
  add('Approve CN',()=>window.reviewCNCase(id,true),'bg-green-50 text-green-800');
  add('Reject CN',()=>window.reviewCNCase(id,false),'bg-red-50 text-red-700');
 }
 if(c.approval_status==='rejected')add('Resubmit CN',()=>window.resubmitCNCase(id),'bg-amber-50 text-amber-800');
 if(c.approval_status==='approved'&&c.stock_complete&&c.financial_decision==='pending'&&canApprove()){
  add('Apply Customer Credit',()=>window.setSalesReturnFinancialTreatment(id,'credit_ar'),'bg-blue-50 text-blue-700');
  add('Close Without Credit',()=>window.finalizeCNNoCredit(id),'bg-white text-gray-700');
 }
 if(c.approval_status==='approved'){
   [...body.querySelectorAll('button')].forEach(button=>{
     if(['Edit CN','Cancel','Delete'].includes(button.textContent.trim()))button.style.display='none';
   });
 }
 [...body.querySelectorAll('button')].forEach(button=>{
  if(['Received','Remove Customer Credit','Apply Customer Credit'].includes(button.textContent.trim())&&
   (!c.stock_complete||c.approval_status!=='approved'||!!c.closed_at))button.style.display='none';
 });
};
window.reviewCNCase=async function(id,approve){
 if(!canApprove())return showToast('Manager/Admin CN approval is required.','err');
 const h=(window._visibleSalesReturns||[]).find(x=>x.return_id===id);
 const cancellation=h?.action==='cancel_undelivered';
 if(!confirm((approve?'Approve':'Reject')+' CN '+(h?.cn_no||'')+'? '+(cancellation?'Approval releases undelivered reservations and applies credit to source invoices. Excess remains customer credit; payments stay unchanged.':'Stock receipt cannot start before approval.')))return;
 const note=prompt(approve?'Optional approval note:':'Reason for rejection:')||'';
 if(!approve&&!note.trim())return showToast('Enter a rejection reason.','err');
 const r=await db.rpc('review_cn_case',{p_return_id:id,p_approve:approve,p_note:note||null});
 if(r.error)return showToast(r.error.message,'err');
 closeModal();showToast(approve?(cancellation?'Cancellation approved: reservations released and invoice credit applied.':'CN approved; Stock may now receive eligible returned goods.'):'CN rejected.');
 await window.renderReturnsPage();
};
window.resubmitCNCase=async function(id){
 if(!confirm('Resubmit this rejected CN for Manager/Admin review?'))return;
 const r=await db.rpc('resubmit_cn_case',{p_return_id:id});
 if(r.error)return showToast(r.error.message,'err');
 closeModal();showToast('CN resubmitted; awaiting Manager/Admin approval.');
 await window.renderReturnsPage();
};
window.finalizeCNNoCredit=async function(id){
 if(!canApprove())return showToast('Manager/Admin permission required.','err');
 if(!confirm('Finalize this CN with NO customer credit? Its stock handling must already be complete. The case will close.'))return;
 const r=await db.rpc('decide_cn_no_credit',{p_return_id:id,p_note:null});
 if(r.error)return showToast(r.error.message,'err');
 closeModal();showToast('No credit decision saved. CN case closed.');
 await window.renderReturnsPage();
};
})();
