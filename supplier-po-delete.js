// Safe Supplier PO deletion for Admin / Super Admin.
(function(){
  function canDeletePO(){
    return ['admin','super_admin'].includes(state.profile?.role||'');
  }

  window.deleteSupplierPO=async function(poId,label='Supplier PO'){
    if(!canDeletePO())return showToast('Admin or Super Admin access required.','err');

    const name=String(label||'Supplier PO');
    const ok=confirm(
      'Delete '+name+'?\n\n'+
      'This will delete the PO and its PO item rows.\n'+
      'Deletion will be blocked automatically if supplier payments or SR allocations exist.\n\n'+
      'This action cannot be undone.'
    );
    if(!ok)return;

    try{
      const {data,error}=await db.rpc('delete_supplier_po_safe',{p_po_id:poId});
      if(error)throw error;

      const result=data||{};
      if(result.blocked||result.deleted===false){
        return openModal('PO Cannot Be Deleted',`<div class="space-y-4">
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">${esc(result.message||'This PO has protected records and cannot be deleted.')}</div>
          <div class="grid sm:grid-cols-3 gap-3">
            <div class="rounded-xl border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">PO Items</div><div class="text-lg font-bold mt-1">${Number(result.item_count||0)}</div></div>
            <div class="rounded-xl border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Supplier Payments</div><div class="text-lg font-bold ${Number(result.supplier_payment_count||0)>0?'text-red-600':''} mt-1">${Number(result.supplier_payment_count||0)}</div></div>
            <div class="rounded-xl border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">SR Allocations</div><div class="text-lg font-bold ${Number(result.sr_allocation_count||0)>0?'text-red-600':''} mt-1">${Number(result.sr_allocation_count||0)}</div></div>
          </div>
          <div class="text-xs text-gray-500">Remove/reverse the protected records first, then try deleting the PO again.</div>
          <button onclick="closeModal()" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Close</button>
        </div>`);
      }

      let fileWarning='';
      if(result.document_path){
        const rm=await db.storage.from('po-documents').remove([result.document_path]);
        if(rm.error){
          console.warn('PO document cleanup failed:',rm.error.message);
          fileWarning=' The PO was deleted, but its uploaded document could not be removed from storage.';
        }
      }

      closeModal();
      if(window.documentFlowState)window.documentFlowState.loaded=false;
      showToast(
        'Supplier PO deleted'+
        (Number(result.item_count||0)>0? ` with ${Number(result.item_count)} item${Number(result.item_count)===1?'':'s'}`:'')+
        '.'+fileWarning,
        fileWarning?'err':undefined
      );
      await go('procurement');
    }catch(err){
      showToast(err.message||'Could not delete Supplier PO','err');
    }
  };
})();