// Super Admin historical reconstruction / history repair UI.
// Historical stock movement is the source of truth before the migration boundary.
// This screen never creates stock movements when reconciling historical documents.
(function(){
  const H=window.historicalReconstructionUI||{type:'',classification:'',loaded:null,applying:false};
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
    already_reconciled:'Already Reconciled',
    conflict:'Conflict / Review',
    unmatched:'Unmatched'
  })[v]||v||'—';

  function classBadge(v){
    const cls=v==='applied'?'bg-green-50 border-green-200 text-green-700':
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
          <div class="mt-3 text-[10px] text-blue-700">Safe auto-match requires exact document/reference + SKU and a quantity that does not exceed the unresolved document quantity. Ambiguous or oversized matches are never auto-applied.</div>
        </div>

        <div class="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
          ${card('Applied',s.applied_rows,'Historical rows already linked','border-green-100 bg-green-50/20')}
          ${card('Already Reconciled',s.already_reconciled_rows,'Resolved before reconstruction','border-purple-100 bg-purple-50/20')}
          ${card('Safe Waiting',s.safe_rows,'Can be applied without stock movement','border-blue-100 bg-blue-50/20')}
          ${card('Conflicts',s.conflict_rows,'Needs manual review','border-red-100 bg-red-50/20')}
          ${card('Unmatched',s.unmatched_rows,'No exact document + SKU match','border-amber-100 bg-amber-50/20')}
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
          <div class="text-[10px] text-gray-400 ml-auto">Showing up to 300 rows. Use the Stock & Inventory search box above to narrow by reference, SKU or customer/vendor.</div>
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