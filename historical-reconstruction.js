// Super Admin historical reconstruction / history repair UI.
// Historical stock movement is the source of truth before the migration boundary.
// This screen never creates stock movements when reconciling historical documents.
(function(){
  const H=window.historicalReconstructionUI||{type:'',classification:'',loaded:null,applying:false,review:null,reviewBusy:false};
  window.historicalReconstructionUI=H;

  const role=()=>String(state?.profile?.role||'');
  const canRepair=()=>typeof window.hasAppPermission==='function'?window.hasAppPermission('inventory.reconcile'):['admin','super_admin'].includes(role());
  const n=v=>Number(v||0);
  const escH=v=>typeof esc==='function'?esc(v==null?'':String(v)):String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtDate=v=>{
    if(!v)return '—';
    const d=new Date(String(v).length===10?v+'T00:00:00':v);
    return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  };
  const typeLabel=v=>({sales_delivery:'Sales OUT → Invoice',sales_return:'Return → CN',po_receipt:'Stock IN → PO'})[v]||v||'—';
  const classLabel=v=>({
    safe:'Safe Match',
    applied:'Applied',
    resolved:'Resolved Review',
    already_reconciled:'Already Reconciled',
    conflict:'Conflict / Review',
    unmatched:'Unmatched'
  })[v]||v||'—';

  function classBadge(v){
    const cls=v==='applied'?'bg-green-50 border-green-200 text-green-700':
      v==='resolved'?'bg-emerald-50 border-emerald-200 text-emerald-700':
      v==='safe'?'bg-blue-50 border-blue-200 text-blue-700':
      v==='already_reconciled'?'bg-purple-50 border-purple-200 text-purple-700':
      v==='conflict'?'bg-red-50 border-red-200 text-red-700':
      'bg-amber-50 border-amber-200 text-amber-800';
    return '<span class="inline-flex px-2 py-1 rounded-lg border text-[9px] font-bold '+cls+'">'+escH(classLabel(v))+'</span>';
  }

  function currentSearch(){
    return String(document.querySelector('.inv-search')?.value||'').trim();
  }

  async function loadPreview(){
    if(!canRepair())throw new Error('Historical reconciliation permission required.');
    const r=await db.rpc('get_historical_reconstruction_preview',{
      p_type:H.type||null,
      p_classification:H.classification||null,
      p_search:currentSearch()||null,
      p_limit:300
    });
    if(r.error)throw r.error;
    H.loaded=r.data||{};
    return H.loaded;
  }

  function card(label,value,sub,tone=''){
    return '<div class="inv-card '+tone+'"><div class="text-[9px] uppercase font-bold text-gray-400">'+escH(label)+'</div><div class="text-2xl font-black mt-1">'+Number(value||0).toLocaleString()+'</div><div class="text-[10px] text-gray-500 mt-1">'+escH(sub||'')+'</div></div>';
  }

  window.setHistoricalReconstructionType=function(v){
    H.type=v||'';
    if(typeof window.renderStockInventoryBody==='function')window.renderStockInventoryBody();
  };
  window.setHistoricalReconstructionClass=function(v){
    H.classification=v||'';
    if(typeof window.renderStockInventoryBody==='function')window.renderStockInventoryBody();
  };
  window.refreshHistoricalReconstruction=function(){
    H.loaded=null;
    if(typeof window.renderStockInventoryBody==='function')window.renderStockInventoryBody();
  };


  function rowDiagnosis(x){
    if(x.classification==='resolved')return {title:'Reviewed',text:'This movement has been manually resolved.',action:'View resolution',tone:'text-emerald-700'};
    if(x.classification==='applied')return {title:'Linked',text:'Already linked to a historical document line.',action:'No action',tone:'text-green-700'};
    if(x.classification==='safe')return {title:'Safe match',text:'Reference + Code and quantity fit the unresolved document.',action:'Apply safe match',tone:'text-blue-700'};
    if(x.classification==='unmatched')return {title:'No exact match',text:'No document line matches both the reference and Code.',action:'Verify source document',tone:'text-amber-700'};
    if(n(x.candidate_count)>1)return {title:'Multiple matching lines',text:n(x.candidate_count)+' lines share this reference + Code.',action:'Choose line or split Qty',tone:'text-red-700'};
    if(n(x.target_remaining_qty)<=0)return {title:'Already fully represented',text:'The matched document line has no remaining quantity.',action:'Check duplicate / already represented',tone:'text-red-700'};
    if(n(x.legacy_qty)>n(x.target_remaining_qty))return {title:'Qty does not fit',text:'History Qty '+n(x.legacy_qty)+' is greater than remaining '+n(x.target_remaining_qty)+'.',action:'Verify imported document Qty',tone:'text-red-700'};
    if(n(x.grouped_legacy_qty)>n(x.target_remaining_qty))return {title:'Grouped history exceeds Qty',text:'Several history movements point to the same line.',action:'Review group / duplicates',tone:'text-red-700'};
    return {title:'Needs review',text:'The source records disagree or need a manual decision.',action:'Review details',tone:'text-red-700'};
  }

  function rowReviewCell(x){
    const dg=rowDiagnosis(x);
    const btn=x.classification==='resolved'?'View Review':'Review';
    const red=x.classification==='conflict'?' border-red-200 bg-red-50 text-red-700':' bg-white';
    return classBadge(x.classification)
      +'<div class="mt-2 font-semibold '+dg.tone+'">'+escH(dg.title)+'</div>'
      +'<div class="text-[9px] text-gray-500 mt-1">'+escH(dg.text)+'</div>'
      +'<div class="text-[9px] font-semibold text-blue-700 mt-1">Suggest: '+escH(dg.action)+'</div>'
      +'<button onclick="openHistoricalReconstructionReview('+Number(x.legacy_history_id)+')" class="mt-2 w-full px-3 py-2 rounded-lg border'+red+' text-[10px] font-semibold">'+btn+'</button>';
  }

  function reviewActionLabel(v){
    return ({match:'Match this line',choose_or_split:'Choose a line or split Qty',verify_document_qty:'Verify / correct document Qty',review_group:'Review grouped movements',already_represented:'Likely already represented',leave_unresolved:'Verify source document',resolved:'Resolved'})[v]||'Review';
  }

  function reviewNote(){
    return String(document.getElementById('historyReviewNote')?.value||'').trim();
  }

  async function refreshAfterHistoryReview(message){
    H.review=null;H.loaded=null;closeModal();
    if(message)showToast(message);
    if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
    if(typeof window.renderStockInventoryBody==='function')await window.renderStockInventoryBody();
  }

  window.openHistoricalReconstructionReview=async function(id){
    if(!canRepair()||H.reviewBusy)return;
    H.reviewBusy=true;
    try{
      const r=await db.rpc('get_historical_reconstruction_review',{p_legacy_history_id:Number(id)});
      if(r.error)throw r.error;
      H.review=r.data||{};
      openModal('History Repair Review · #'+id,'');
      const shell=document.querySelector('#modal > div');if(shell)shell.style.maxWidth='1180px';
      renderHistoricalReviewModal();
    }catch(err){showToast(err.message||'Could not load historical review.','err')}
    finally{H.reviewBusy=false}
  };

  function reviewCandidateHtml(x,i,h,resolved){
    const id=String(x.target_item_id||''),canMatch=n(x.remaining_qty)>=n(h.qty)&&n(h.qty)>0&&!resolved;
    let s='<div class="p-4 grid xl:grid-cols-[1.2fr_1fr_130px_130px_150px] gap-3 items-center '+(n(x.remaining_qty)<=0?'bg-gray-50/60':'')+'">';
    s+='<div class="min-w-0"><div class="font-bold">'+escH(x.document_no||'Document')+' <span class="text-[9px] text-gray-400">Line '+escH(x.line_no||i+1)+'</span></div><div class="text-xs text-gray-500 truncate">'+escH(x.party||'')+' · '+escH(fmtDate(x.document_date))+'</div><div class="text-[10px] font-bold text-[#a77d1a] mt-1">'+escH(x.product_code||'')+'</div><div class="text-[10px] truncate">'+escH(x.item_name||'')+'</div></div>';
    s+='<div class="grid grid-cols-3 gap-1 text-center"><div class="rounded-lg border bg-white p-2"><div class="text-[8px] text-gray-400">Document Qty</div><b>'+n(x.document_qty)+'</b></div><div class="rounded-lg border bg-white p-2"><div class="text-[8px] text-gray-400">Reconciled</div><b>'+n(x.already_reconciled_qty)+'</b></div><div class="rounded-lg border '+(n(x.remaining_qty)>0?'bg-green-50 border-green-200':'bg-gray-50')+' p-2"><div class="text-[8px] text-gray-400">Remaining</div><b>'+n(x.remaining_qty)+'</b></div></div>';
    s+='<div><label class="text-[9px] font-bold text-gray-400">Split Qty</label><input id="hr-alloc-'+escH(id)+'" type="number" min="0" step="1" value="0" class="mt-1 w-full border rounded-lg px-2 py-2 text-xs"></div>';
    s+='<div><label class="text-[9px] font-bold text-gray-400">Correct Doc Qty</label><input id="hr-newqty-'+escH(id)+'" type="number" min="'+Math.max(0,n(x.already_reconciled_qty))+'" step="1" value="'+n(x.document_qty)+'" class="mt-1 w-full border rounded-lg px-2 py-2 text-xs"></div>';
    s+='<div class="flex flex-col gap-2"><button '+(canMatch?'':'disabled')+' onclick="historyReviewMatch(\''+escH(id)+'\')" class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-[10px] font-semibold disabled:opacity-30">Match This Line</button><button '+(resolved?'disabled':'')+' onclick="historyReviewCorrectQty(\''+escH(id)+'\')" class="px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-[10px] font-semibold disabled:opacity-30">Correct Imported Qty</button></div></div>';
    return s;
  }

  function renderHistoricalReviewModal(){
    const d=H.review||{},h=d.history||{},cands=Array.isArray(d.candidates)?d.candidates:[],body=document.getElementById('modalBody');if(!body)return;
    const resolved=!!d.resolution,audit=Array.isArray(d.audit)?d.audit:[];
    let html='<div class="space-y-4">';
    html+='<div class="rounded-xl border border-green-200 bg-green-50 p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><div class="text-[10px] uppercase font-bold text-green-700">Stock impact</div><div class="font-bold text-green-900">NONE — this review never creates, deletes or reverses a physical stock movement.</div></div><span class="px-3 py-1.5 rounded-lg bg-white border border-green-200 text-[10px] font-bold text-green-800">Historical relationship repair only</span></div>';
    html+='<div class="grid lg:grid-cols-[1fr_1.35fr] gap-4"><div class="rounded-2xl border p-4"><div class="text-[9px] uppercase font-bold text-gray-400">Historical stock movement</div><div class="mt-2 flex items-start justify-between gap-3"><div><div class="text-lg font-black">'+escH(h.reference_no||'No reference')+'</div><div class="text-xs text-gray-500">'+escH(h.counterparty||'')+'</div></div><div class="text-right"><div class="text-2xl font-black">'+escH(h.qty??0)+'</div><div class="text-[9px] text-gray-400">history Qty</div></div></div><div class="mt-3 grid grid-cols-2 gap-2 text-xs"><div class="rounded-lg bg-gray-50 p-2"><span class="text-gray-400">Date</span><div class="font-semibold">'+escH(fmtDate(h.movement_date))+'</div></div><div class="rounded-lg bg-gray-50 p-2"><span class="text-gray-400">Movement</span><div class="font-semibold">'+escH(String(h.movement_type||'').toUpperCase())+'</div></div><div class="rounded-lg bg-gray-50 p-2 col-span-2"><span class="text-gray-400">Code</span><div class="font-semibold text-[#a77d1a]">'+escH(h.product_code||'—')+'</div><div class="text-[10px]">'+escH(h.item_name||'')+'</div></div><div class="rounded-lg bg-gray-50 p-2"><span class="text-gray-400">Former location</span><div class="font-semibold">'+escH(h.location_code||'—')+'</div></div><div class="rounded-lg bg-gray-50 p-2"><span class="text-gray-400">History ID</span><div class="font-semibold">#'+escH(h.legacy_history_id||'')+'</div></div></div></div>';
    html+='<div class="rounded-2xl border border-red-100 bg-red-50/30 p-4"><div class="text-[9px] uppercase font-bold text-red-500">Why this needs review</div><div class="font-bold text-base mt-2">'+escH(d.reason||'Review required')+'</div><div class="text-xs text-gray-600 mt-2">'+escH(d.suggestion||'')+'</div><div class="mt-3 flex flex-wrap gap-2"><span class="px-2.5 py-1.5 rounded-lg border bg-white text-[10px]"><b>Candidates:</b> '+n(d.candidate_count)+'</span><span class="px-2.5 py-1.5 rounded-lg border bg-white text-[10px]"><b>Candidate remaining:</b> '+n(d.total_candidate_remaining)+'</span><span class="px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[10px]"><b>Auto Suggest:</b> '+escH(reviewActionLabel(d.suggested_action))+'</span></div></div></div>';
    html+='<div class="rounded-2xl border overflow-hidden"><div class="px-4 py-3 bg-gray-50 border-b"><div class="font-bold">Matching document lines</div><div class="text-[10px] text-gray-500 mt-1">Use Match when one line is correct. For multiple lines, enter allocation Qty beside each line and use Split / Apply Allocation.</div></div><div class="divide-y">';
    if(cands.length)cands.forEach((x,i)=>html+=reviewCandidateHtml(x,i,h,resolved));else html+='<div class="p-8 text-center text-sm text-gray-400">No exact reference + Code document line was found. Keep unresolved unless you can verify the source document.</div>';
    html+='</div></div>';
    if(cands.length>1&&!resolved)html+='<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><b class="text-blue-900">Split / allocation</b><div class="text-[10px] text-blue-700 mt-1">Enter Qty beside the correct lines. The allocation total must equal historical Qty '+n(h.qty)+'.</div></div><button onclick="historyReviewSplit()" class="px-4 py-2.5 rounded-xl bg-blue-700 text-white text-xs font-semibold">Split / Apply Allocation</button></div>';
    html+='<div><label class="text-xs font-semibold">Review Note</label><textarea id="historyReviewNote" class="mt-1 w-full border rounded-xl px-3 py-2 min-h-[70px]" placeholder="Optional: what you verified from the original invoice / PO / CN"></textarea></div>';
    if(resolved)html+='<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs"><b>Resolved:</b> '+escH(d.resolution?.resolution_type||'reviewed')+' · '+escH(d.resolution?.note||'No note')+'</div>';
    else html+='<div class="flex flex-wrap items-center justify-between gap-3"><div class="text-[10px] text-gray-500">If you are not certain, choose <b>Leave Unresolved</b>. The system will not guess.</div><div class="flex flex-wrap gap-2 justify-end"><button onclick="closeModal()" class="px-3 py-2.5 rounded-xl border text-xs font-semibold">Leave Unresolved</button><button onclick="historyReviewResolveSimple(\'already_represented\')" class="px-3 py-2.5 rounded-xl border border-purple-200 bg-purple-50 text-purple-700 text-xs font-semibold">Mark Already Represented</button><button onclick="historyReviewResolveSimple(\'duplicate_ignore\')" class="px-3 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-semibold">Duplicate / Ignore</button></div></div>';
    if(audit.length){html+='<details class="rounded-xl border bg-gray-50 p-3"><summary class="cursor-pointer text-xs font-semibold">Review Audit ('+audit.length+')</summary><div class="mt-2 space-y-2">';audit.forEach(a=>{html+='<div class="rounded-lg bg-white border p-2 text-[10px]"><b>'+escH(a.action||'Action')+'</b> · '+(a.acted_at?escH(new Date(a.acted_at).toLocaleString()):'')+'<div class="text-gray-500">'+escH(a.note||'')+'</div></div>'});html+='</div></details>'}
    html+='</div>';body.innerHTML=html;
  }

  async function callHistoryResolution(args){
    if(H.reviewBusy)return;H.reviewBusy=true;
    try{const r=await db.rpc('resolve_historical_reconstruction_review',args);if(r.error)throw r.error;await refreshAfterHistoryReview(r.data?.message||'History review saved. No physical stock changed.')}
    catch(err){showToast(err.message||'Could not save history review.','err')}
    finally{H.reviewBusy=false}
  }

  window.historyReviewResolveSimple=function(action){
    const h=H.review?.history||{},name=action==='duplicate_ignore'?'Duplicate / Ignore':'Already Represented';
    if(!confirm(name+' historical movement #'+(h.legacy_history_id||'')+'?\n\nThis records the review decision only.\nSTOCK IMPACT: NONE — no stock movement or current quantity will change.'))return;
    callHistoryResolution({p_legacy_history_id:Number(h.legacy_history_id),p_action:action,p_allocations:[],p_target_item_id:null,p_new_qty:null,p_note:reviewNote()||null});
  };
  window.historyReviewMatch=function(targetItemId){
    const h=H.review?.history||{},qty=n(h.qty);
    if(!confirm('Match historical Qty '+qty+' to this document line?\n\nSTOCK IMPACT: NONE — this creates only a historical reconciliation link. No Stock IN / OUT will be posted.'))return;
    callHistoryResolution({p_legacy_history_id:Number(h.legacy_history_id),p_action:'match_line',p_allocations:[{target_item_id:targetItemId,qty:qty}],p_target_item_id:null,p_new_qty:null,p_note:reviewNote()||null});
  };
  window.historyReviewSplit=function(){
    const h=H.review?.history||{},cands=Array.isArray(H.review?.candidates)?H.review.candidates:[],allocations=cands.map(x=>({target_item_id:x.target_item_id,qty:n(document.getElementById('hr-alloc-'+x.target_item_id)?.value)})).filter(x=>x.qty>0),total=allocations.reduce((sum,x)=>sum+x.qty,0);
    if(Math.abs(total-n(h.qty))>0.0001)return showToast('Split allocation total must equal historical Qty '+n(h.qty)+'.','err');
    if(!confirm('Split historical Qty '+n(h.qty)+' across '+allocations.length+' document line(s)?\n\nSTOCK IMPACT: NONE — this only reconciles history to the selected lines.'))return;
    callHistoryResolution({p_legacy_history_id:Number(h.legacy_history_id),p_action:'split',p_allocations:allocations,p_target_item_id:null,p_new_qty:null,p_note:reviewNote()||null});
  };
  window.historyReviewCorrectQty=function(targetItemId){
    const h=H.review?.history||{},x=(H.review?.candidates||[]).find(c=>String(c.target_item_id)===String(targetItemId));if(!x)return;
    const newQty=n(document.getElementById('hr-newqty-'+targetItemId)?.value);if(newQty<=0)return showToast('Enter a positive corrected document Qty.','err');
    if(!confirm('Correct imported document Qty from '+n(x.document_qty)+' to '+newQty+'?\n\nUse this only after checking the original invoice / PO / CN.\nPHYSICAL STOCK IMPACT: NONE.\nHowever, the historical document quantity and related document/report totals may change.\n\nAfter saving, review this movement again and match it if appropriate.'))return;
    callHistoryResolution({p_legacy_history_id:Number(h.legacy_history_id),p_action:'correct_document_qty',p_allocations:[],p_target_item_id:targetItemId,p_new_qty:newQty,p_note:reviewNote()||'Historical source document quantity verified and corrected.'});
  };

  window.applyHistoricalReconstructionSafeMatches=async function(){
    if(!canRepair()||H.applying)return;
    const s=H.loaded?.summary||{};
    const count=n(s.safe_rows);
    if(count<=0)return showToast('There are no safe historical matches waiting to apply.');
    const ok=confirm(
      'Apply '+count+' safe historical match(es)?\n\n'+
      'This reconciles old Sales / Returns / POs to the imported historical stock movement ledger.\n'+
      'NO new stock movement will be created and current stock quantity will not change.\n\n'+
      'Conflicts and unmatched rows will remain for review.'
    );
    if(!ok)return;
    H.applying=true;
    try{
      const types=H.type?[H.type]:['sales_delivery','sales_return','po_receipt'];
      const r=await db.rpc('apply_historical_reconstruction_safe_matches',{p_types:types});
      if(r.error)throw r.error;
      const x=r.data||{};
      showToast((x.success_count||0)+' historical match'+(Number(x.success_count||0)===1?'':'es')+' applied with no stock deduction/addition.');
      H.loaded=null;
      if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
      if(typeof window.renderStockInventoryBody==='function')await window.renderStockInventoryBody();
    }catch(err){showToast(err.message||'Historical reconstruction failed.','err')}
    finally{H.applying=false}
  };

  window.renderHistoricalReconstructionPanel=async function(){
    if(!canRepair())return '<div class="inv-card py-12 text-center text-sm text-gray-400">Historical reconciliation permission required.</div>';
    const d=await loadPreview();
    const cfg=d.config||{},s=d.summary||{},rows=Array.isArray(d.rows)?d.rows:[];
    const safe=n(s.safe_rows);
    return `
      <div class="space-y-4">
        <div class="rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
            <div>
              <div class="font-bold text-blue-900">Historical Reconstruction</div>
              <div class="text-xs text-blue-800 mt-1"><b>Historical stock movement is the source of truth through ${escH(fmtDate(cfg.boundary_date))}.</b> Live workflow starts ${escH(fmtDate(cfg.live_start_date))}. Matching old invoices, returns and POs here never changes today's physical stock.</div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button onclick="refreshHistoricalReconstruction()" class="px-3 py-2 rounded-xl border bg-white text-xs font-semibold">Refresh Preview</button>
              <button onclick="applyHistoricalReconstructionSafeMatches()" ${safe?'':'disabled'} class="px-3 py-2 rounded-xl bg-[#211d18] text-white text-xs font-semibold disabled:opacity-40">Apply Safe Matches ${safe?'('+safe+')':''}</button>
            </div>
          </div>
          <div class="mt-3 text-[10px] text-blue-700">Safe auto-match requires exact document/reference + Code and a quantity that does not exceed the unresolved document quantity. Ambiguous or oversized matches are never auto-applied.</div>
        </div>

        <div class="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
          ${card('Applied',s.applied_rows,'Historical rows already linked','border-green-100 bg-green-50/20')}
          ${card('Already Reconciled',s.already_reconciled_rows,'Resolved before reconstruction','border-purple-100 bg-purple-50/20')}
          ${card('Safe Waiting',s.safe_rows,'Can be applied without stock movement','border-blue-100 bg-blue-50/20')}
          ${card('Conflicts',s.conflict_rows,'Needs manual review','border-red-100 bg-red-50/20')}
          ${card('Unmatched',s.unmatched_rows,'No exact document + Code match','border-amber-100 bg-amber-50/20')}
        </div>

        <div class="rounded-xl border bg-white p-3 flex flex-wrap items-center gap-2">
          <select onchange="setHistoricalReconstructionType(this.value)" class="border rounded-xl px-3 py-2 bg-white text-xs">
            <option value="" ${!H.type?'selected':''}>All Types</option>
            <option value="sales_delivery" ${H.type==='sales_delivery'?'selected':''}>Sales OUT → Invoice</option>
            <option value="sales_return" ${H.type==='sales_return'?'selected':''}>Return → CN</option>
            <option value="po_receipt" ${H.type==='po_receipt'?'selected':''}>Stock IN → PO</option>
          </select>
          <select onchange="setHistoricalReconstructionClass(this.value)" class="border rounded-xl px-3 py-2 bg-white text-xs">
            <option value="" ${!H.classification?'selected':''}>All Results</option>
            <option value="applied" ${H.classification==='applied'?'selected':''}>Applied</option>
            <option value="already_reconciled" ${H.classification==='already_reconciled'?'selected':''}>Already Reconciled</option>
            <option value="safe" ${H.classification==='safe'?'selected':''}>Safe Waiting</option>
            <option value="conflict" ${H.classification==='conflict'?'selected':''}>Conflict / Review</option>
            <option value="unmatched" ${H.classification==='unmatched'?'selected':''}>Unmatched</option>
          </select>
          <div class="text-[10px] text-gray-400 ml-auto">Showing up to 300 rows. Use the Stock & Inventory search box above to narrow by reference, Code or customer/vendor.</div>
        </div>

        <div class="card rounded-2xl overflow-hidden">
          <div class="grid grid-cols-[105px_130px_1fr_1fr_95px_145px] gap-3 px-4 py-3 bg-gray-50 border-b text-[9px] uppercase font-bold text-gray-400">
            <div>Date</div><div>Historical Movement</div><div>Reference / Party</div><div>Matched Document</div><div>Qty</div><div>Result</div>
          </div>
          <div class="divide-y">
            ${rows.length?rows.map(x=>`
              <div class="grid grid-cols-[105px_130px_1fr_1fr_95px_145px] gap-3 px-4 py-3 items-center text-xs">
                <div><b>${escH(fmtDate(x.movement_date))}</b><div class="text-[9px] text-gray-400">History #${escH(x.legacy_history_id)}</div></div>
                <div><div class="font-semibold">${escH(String(x.movement_type||'').toUpperCase())}</div><div class="text-[9px] text-gray-400">${escH(typeLabel(x.target_type))}</div></div>
                <div class="min-w-0"><div class="font-semibold truncate">${escH(x.reference_no||'No reference')}</div><div class="text-[10px] text-gray-500 truncate">${escH(x.counterparty||'')}</div><div class="text-[9px] font-bold text-[#a77d1a] mt-1">${escH(x.product_code||'')}</div></div>
                <div class="min-w-0"><div class="font-semibold truncate">${escH(x.target_document_no||'—')}</div><div class="text-[10px] text-gray-500 truncate">${escH(x.target_party||'')}</div><div class="text-[9px] text-gray-400 mt-1">Target ${x.target_qty==null?'—':escH(x.target_qty)} · Remaining ${x.target_remaining_qty==null?'—':escH(x.target_remaining_qty)}</div></div>
                <div><b class="text-base">${escH(x.legacy_qty)}</b><div class="text-[9px] text-gray-400">history qty</div></div>
                <div>${classBadge(x.classification)}<div class="text-[9px] text-gray-400 mt-1">${escH(x.match_method||'')}</div>${n(x.candidate_count)>1?'<div class="text-[9px] text-red-500 mt-1">'+n(x.candidate_count)+' possible lines</div>':''}</div>
              </div>`).join(''):'<div class="py-12 text-center text-sm text-gray-400">No historical rows match this filter.</div>'}
          </div>
        </div>

        <div class="rounded-xl border bg-gray-50 p-3 text-[10px] text-gray-500">
          Customer Database, Showroom Visit, Online Customer, CRM assignments and current customer records are outside this reconstruction process and are not changed by this screen.
        </div>
      </div>`;
  };
})();