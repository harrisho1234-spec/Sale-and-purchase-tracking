// Showroom quotation import staging + conversion workflow.
// Imports only after authenticated login, then reuses the existing Sales Order form/validation.
(function(){
  const SOURCE_SYSTEM='limperial-showroom';
  const SOURCE_API='https://script.google.com/macros/s/AKfycbwAah-oFIyiSON0jOhjWlL1lzlr0d354bq-1OxMDY2Qz-D-rzAYFaPzTkKDNlnfz1tk/exec';
  const TABLE='showroom_quotation_imports';
  const REGISTRY_TABLE='showroom_quotation_registry';
  let quotationSection='imports';
  let handoffBusy=false;
  let activeConversionId=null;
  const pendingDeletions=new Set();
  function canDeleteImportedQuotation(){
    const role=String(state?.profile?.role||'').toLowerCase();
    return ['super_admin','admin','manager'].includes(role);
  }

  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
  function num(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}
  function clampPct(v){return Math.max(0,Math.min(100,num(v,0)))}
  function lower(v){return String(v||'').trim().toLowerCase()}
  function actualPrice(item){
    const a=Number(item?.actualSalesPrice);if(Number.isFinite(a))return a;
    const b=Number(item?.price);if(Number.isFinite(b))return b;
    const c=Number(item?.salesPrice);return Number.isFinite(c)?c:0;
  }
  function parseState(record){
    if(record?.state&&typeof record.state==='object')return record.state;
    if(record?.payload&&typeof record.payload==='object')return record.payload;
    if(typeof record?.payload==='string'){try{return JSON.parse(record.payload)||{}}catch(_){}}
    return {};
  }
  function fieldValue(sourceState,id){
    const states=sourceState?.documentFormStates||{};
    const preferred=[states.quotation,states[sourceState?.documentType],states.sales_order,...Object.values(states)].filter(Boolean);
    for(const s of preferred){
      const f=s?.fields?.[id];
      if(f!=null){
        if(typeof f==='object'&&'value' in f)return String(f.value??'').trim();
        return String(f??'').trim();
      }
    }
    return '';
  }
  function buildQuoteLines(sourceState){
    const out=[];
    const cart=Array.isArray(sourceState?.cart)?sourceState.cart:[];
    cart.forEach((entry,index)=>{
      if(entry?.type==='set'){
        const setQty=Math.max(1,num(entry.quantity,1));
        const parts=Array.isArray(entry.items)?entry.items:[];
        const componentBase=parts.reduce((sum,p)=>sum+actualPrice(p?.item)*Math.max(1,num(p?.quantity,1)),0);
        const custom=entry.customPrice;
        const saved=entry.setPrice;
        const setUnitPrice=(custom!==null&&custom!==undefined&&Number.isFinite(Number(custom)))?Number(custom):(Number.isFinite(Number(saved))?Number(saved):componentBase);
        const ratio=componentBase>0?setUnitPrice/componentBase:0;
        const setDiscountPct=clampPct(entry.discount);
        parts.forEach((part,partIndex)=>{
          const item=part?.item||{};
          const qty=Math.max(0.01,num(part?.quantity,1))*setQty;
          const unitPrice=round2(actualPrice(item)*ratio);
          out.push({
            key:'set-'+index+'-'+partIndex,kind:'product',
            code:String(item.code||'').trim(),name:String(item.itemName||item.name||'').trim(),
            image:String(item.imgLink||item.image_url||'').trim(),className:String(item.class||'').trim(),
            qty:round2(qty),unitPrice,discountPct:setDiscountPct,
            discountAmount:round2(qty*unitPrice*setDiscountPct/100),
            forcePreorder:!!entry.forcePreorder,sourceSetName:String(entry.setName||entry.name||'Set').trim()
          });
        });
        return;
      }
      const item=entry?.item||{};
      const qty=Math.max(0.01,num(entry?.quantity,1));
      const custom=entry?.customPrice;
      const unitPrice=(custom!==null&&custom!==undefined&&Number.isFinite(Number(custom)))?Number(custom):actualPrice(item);
      const discountPct=clampPct(entry?.discount);
      const kind=entry?.type==='service'?'service':'product';
      out.push({
        key:'line-'+index,kind,
        code:String(item.code||(kind==='service'?'SERVICE-FEE':'')).trim(),
        name:String(item.itemName||item.name||(kind==='service'?'Service Fee':'')).trim(),
        image:String(item.imgLink||item.image_url||'').trim(),className:String(item.class||'').trim(),
        qty:round2(qty),unitPrice:round2(unitPrice),discountPct,
        discountAmount:round2(qty*unitPrice*discountPct/100),
        forcePreorder:!!entry?.forcePreorder,sourceSetName:''
      });
    });
    return out;
  }
  function quoteSummary(recordOrRow){
    const sourceState=recordOrRow?.source_payload||parseState(recordOrRow);
    const lines=buildQuoteLines(sourceState);
    const customerName=recordOrRow?.customer_name||fieldValue(sourceState,'quote-customer-input');
    const customerPhone=recordOrRow?.customer_phone||fieldValue(sourceState,'quote-tel-input');
    const customerAddress=recordOrRow?.customer_address||fieldValue(sourceState,'quote-address-input');
    const quoteNo=recordOrRow?.source_quote_no||fieldValue(sourceState,'quote-no-input');
    const salesperson=recordOrRow?.source_salesperson||fieldValue(sourceState,'quote-sales-input');
    const lineNet=round2(lines.reduce((sum,l)=>sum+Math.max(l.qty*l.unitPrice-l.discountAmount,0),0));
    const pct=clampPct(sourceState?.discountPctValue);
    const flat=Math.max(0,num(sourceState?.discountFlatValue,0));
    const orderDiscount=round2(Math.min(lineNet,lineNet*pct/100+flat));
    return {sourceState,lines,customerName,customerPhone,customerAddress,quoteNo,salesperson,lineNet,orderDiscount,total:round2(Math.max(lineNet-orderDiscount,0))};
  }
  function jsonpRecord(recordId){
    return new Promise((resolve,reject)=>{
      const cb='__limperialQuoteImport_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
      const script=document.createElement('script');let done=false;
      const finish=(err,data)=>{
        if(done)return;done=true;clearTimeout(timer);
        try{delete window[cb]}catch(_){window[cb]=undefined}
        script.remove();err?reject(err):resolve(data);
      };
      const timer=setTimeout(()=>finish(new Error('Showroom quotation service timed out.')),15000);
      window[cb]=data=>{
        if(data?.ok===false)return finish(new Error(data.error||'Could not read showroom quotation.'));
        finish(null,data?.record||null);
      };
      script.onerror=()=>finish(new Error('Could not reach the showroom quotation service.'));
      const q=new URLSearchParams({action:'get',recordId:String(recordId||''),callback:cb,_cb:String(Date.now())});
      script.src=SOURCE_API+'?'+q.toString();document.head.appendChild(script);
    });
  }
  async function loadOrderData(){if(typeof ensureOrderFormData==='function')await ensureOrderFormData()}
  async function importSavedRecord(recordId){
    const id=String(recordId||'').trim();if(!id)throw new Error('Missing showroom quotation ID.');
    const existing=await db.from(TABLE).select('*').eq('source_system',SOURCE_SYSTEM).eq('source_record_id',id).maybeSingle();
    if(existing.error)throw existing.error;
    if(existing.data)return existing.data;
    const record=await jsonpRecord(id);if(!record)throw new Error('The saved showroom quotation could not be found.');
    const sourceState=parseState(record);const summary=quoteSummary(record);
    const row={
      source_system:SOURCE_SYSTEM,source_record_id:id,source_name:String(record.name||'Saved quotation').trim(),
      source_saved_at:record.savedAt||null,source_document_type:String(sourceState.documentType||'quotation'),
      source_quote_no:summary.quoteNo||null,source_salesperson:summary.salesperson||null,source_payload:sourceState,
      // limperial-showroom is public/shared. These customer fields are reference hints only.
      // Never infer the official CRM customer or Sales Rep ownership from them.
      customer_name:summary.customerName||null,customer_phone:summary.customerPhone||null,
      customer_address:summary.customerAddress||null,customer_id:null,
      status:'imported_draft',imported_by:state.user.id
    };
    const inserted=await db.from(TABLE).insert(row).select().single();
    if(inserted.error){
      const msg=String(inserted.error.message||'');
      if(msg.toLowerCase().includes('duplicate'))throw new Error('This showroom quotation was already imported. Open Imported Quotations to review it.');
      throw inserted.error;
    }
    return inserted.data;
  }
  function badge(status){
    const s=String(status||'imported_draft');
    if(s==='converted')return '<span class="px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 text-[10px] font-bold">CONVERTED</span>';
    if(s==='ready')return '<span class="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">READY</span>';
    return '<span class="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">CUSTOMER NEEDED</span>';
  }
  function fmtDate(v){if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString()}
  async function getRows(){
    const r=await db.from(TABLE).select('*').order('imported_at',{ascending:false});
    if(r.error)throw r.error;return r.data||[];
  }
  function quotationTabs(){
    const importsActive=quotationSection==='imports';
    return '<div class="inline-flex rounded-xl border bg-white p-1 mb-5">'+
      '<button type="button" onclick="showQuotationSection(\'imports\')" class="px-4 py-2 rounded-lg text-xs font-semibold '+(importsActive?'bg-[#211d18] text-white':'text-gray-600 hover:bg-gray-50')+'">Imported Queue</button>'+
      '<button type="button" onclick="showQuotationSection(\'history\')" class="px-4 py-2 rounded-lg text-xs font-semibold '+(!importsActive?'bg-[#211d18] text-white':'text-gray-600 hover:bg-gray-50')+'">Quotation History</button>'+
      '</div>';
  }
  window.showQuotationSection=function(section){
    quotationSection=section==='history'?'history':'imports';
    renderImportedQuotations();
  };
  async function getRegistryRows(){
    const r=await db.from(REGISTRY_TABLE)
      .select('id,quote_no,source_record_id,source_name,issue_date,saved_at,customer_name,customer_phone,salesperson,amount,confirmed_at')
      .order('issue_date',{ascending:false})
      .order('sequence_no',{ascending:false});
    if(r.error)throw r.error;
    return r.data||[];
  }
  function historyStatus(importRow){
    if(!importRow)return '<span class="px-2 py-1 rounded-full bg-slate-50 text-slate-700 border border-slate-200 text-[10px] font-bold">SAVED</span>';
    if(importRow.status==='converted')return '<span class="px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 text-[10px] font-bold">CONVERTED</span>';
    if(importRow.status==='ready')return '<span class="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">READY</span>';
    return '<span class="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">IMPORTED</span>';
  }
  function jsonpMarkDelete(recordId){
    return new Promise((resolve,reject)=>{
      const cb='__limperialQuoteDelete_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
      const script=document.createElement('script');let done=false;
      const finish=(err,data)=>{
        if(done)return;done=true;clearTimeout(timer);
        try{delete window[cb]}catch(_){window[cb]=undefined}
        script.remove();err?reject(err):resolve(data);
      };
      const timer=setTimeout(()=>finish(new Error('Showroom quotation service timed out.')),15000);
      window[cb]=data=>{
        if(data?.ok===false)return finish(new Error(data.error||'Could not delete showroom quotation.'));
        finish(null,data||{});
      };
      script.onerror=()=>finish(new Error('Could not reach the showroom quotation service.'));
      const q=new URLSearchParams({action:'markDelete',recordId:String(recordId||''),callback:cb,_cb:String(Date.now())});
      script.src=SOURCE_API+'?'+q.toString();document.head.appendChild(script);
    });
  }
  window.importQuotationFromHistory=async function(sourceRecordId){
    if(typeof window.hasAppPermission==='function'&&!window.hasAppPermission('sales_orders.create')){
      showToast('Your role cannot import quotations for Sales Order conversion.','err');return;
    }
    try{
      const row=await importSavedRecord(sourceRecordId);
      quotationSection='imports';
      await renderImportedQuotations();
      showToast(row.status==='converted'?'Quotation was already converted.':'Quotation added to the Imported Queue.');
      setTimeout(()=>reviewImportedQuotation(row.id),100);
    }catch(err){showToast(err.message||'Could not import quotation.','err')}
  };
  window.reviewQuotationHistory=async function(id){
    const r=await db.from(REGISTRY_TABLE).select('*').eq('id',id).single();
    if(r.error)return showToast(r.error.message,'err');
    const row=r.data,s=quoteSummary(row);
    const imported=await db.from(TABLE).select('id,status,converted_sales_order_id').eq('source_record_id',row.source_record_id).maybeSingle();
    const importRow=imported.data||null;
    const lines=s.lines.map((l,i)=>'<div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 items-center py-2 border-b last:border-b-0"><div class="min-w-0"><div class="text-xs font-semibold truncate">'+esc(l.code||l.name||('Line '+(i+1)))+'</div><div class="text-[10px] text-gray-500 truncate">'+esc(l.name||'')+'</div></div><div class="text-xs text-right">'+l.qty+'</div><div class="text-xs text-right">'+money(l.unitPrice,'USD')+'</div><div class="text-xs text-right">'+money(Math.max(l.qty*l.unitPrice-l.discountAmount,0),'USD')+'</div></div>').join('');
    openModal('Quotation History',
      '<div class="space-y-4">'+
      '<div class="rounded-xl border bg-gray-50 p-4"><div class="flex flex-wrap gap-2 items-center">'+historyStatus(importRow)+'<b class="text-base">'+esc(row.quote_no)+'</b></div>'+
      '<div class="mt-2 text-xs text-gray-700"><b>Customer:</b> '+esc(row.customer_name||s.customerName||'Not entered')+(row.customer_phone?' · '+esc(row.customer_phone):'')+'</div>'+
      '<div class="mt-1 text-[10px] text-gray-500"><b>Salesperson:</b> '+esc(row.salesperson||s.salesperson||'Not entered')+' · <b>Issue date:</b> '+esc(row.issue_date||'')+'</div>'+
      '<div class="mt-1 text-[10px] text-gray-400">Source ID: '+esc(row.source_record_id)+'</div></div>'+
      '<div><div class="flex items-center justify-between mb-2"><b class="text-sm">Original quotation snapshot</b><span class="text-xs font-bold">'+money(row.amount??s.total,'USD')+'</span></div>'+
      '<div class="rounded-xl border overflow-hidden"><div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 bg-gray-50 px-3 py-2 text-[9px] uppercase font-bold text-gray-400"><div>Item</div><div class="text-right">Qty</div><div class="text-right">Price</div><div class="text-right">Net</div></div><div class="px-3">'+(lines||'<div class="p-4 text-xs text-gray-400">No item snapshot available.</div>')+'</div></div></div>'+
      '<div class="flex flex-wrap gap-2">'+
      (importRow?'<button type="button" onclick="closeModal();reviewImportedQuotation(\''+importRow.id+'\')" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Open Imported Record</button>':'<button type="button" onclick="closeModal();importQuotationFromHistory(\''+esc(row.source_record_id)+'\')" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Import to Sales Queue</button>')+
      (canDeleteImportedQuotation()?'<button type="button" onclick="closeModal();deleteQuotationHistory(\''+row.id+'\',\''+esc(row.source_record_id)+'\',\''+esc(row.quote_no)+'\')" class="px-4 py-2.5 rounded-xl border border-red-200 bg-white text-red-700 text-xs font-semibold">Delete Quotation</button>':'')+
      '</div></div>'
    );
  };
  window.deleteQuotationHistory=async function(id,sourceRecordId,quoteNo){
    if(!canDeleteImportedQuotation()){showToast('Only Super Admin, Admin, and Manager can delete quotation history.','err');return}
    const imported=await db.from(TABLE).select('id,status,converted_sales_order_id').eq('source_record_id',sourceRecordId).maybeSingle();
    if(imported.error)return showToast(imported.error.message,'err');
    const importRow=imported.data||null;
    const warning=importRow?.status==='converted'
      ? 'Delete '+quoteNo+' from permanent quotation history?\n\nThe official Sales Order and converted import audit will remain.'
      : 'Delete '+quoteNo+' permanently?\n\nIt will also be removed from the showroom saved quotation list.';
    if(!window.confirm(warning))return;
    try{
      const sourceResult=await jsonpMarkDelete(sourceRecordId);
      if(sourceResult?.ok!==true||sourceResult?.deleted!==true)throw new Error(sourceResult?.error||'Showroom did not confirm deletion.');
      if(importRow&&importRow.status!=='converted'){
        const q=await db.from(TABLE).delete().eq('id',importRow.id);
        if(q.error)throw q.error;
      }
      const r=await db.from(REGISTRY_TABLE).delete().eq('id',id).select('id');
      if(r.error)throw r.error;
      if(!r.data?.length)throw new Error('Delete was not permitted or the quotation no longer exists.');
      showToast(quoteNo+' deleted from quotation history.');
      await renderImportedQuotations();
    }catch(err){
      console.error('Quotation history deletion failed:',err);
      showToast(err.message||'Could not delete quotation history.','err');
    }
  };
  async function renderQuotationHistoryPage(){
    const [historyRows,imports]=await Promise.all([getRegistryRows(),getRows()]);
    const importBySource=new Map(imports.map(row=>[String(row.source_record_id||''),row]));
    const converted=historyRows.filter(row=>importBySource.get(String(row.source_record_id||''))?.status==='converted').length;
    const imported=historyRows.filter(row=>importBySource.has(String(row.source_record_id||''))).length;
    const canCreate=typeof window.hasAppPermission!=='function'||window.hasAppPermission('sales_orders.create');
    const canDelete=canDeleteImportedQuotation();
    const html=historyRows.map(row=>{
      const importRow=importBySource.get(String(row.source_record_id||''))||null;
      return '<div class="card rounded-2xl p-4 border border-[#ece6dc]"><div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">'+
        '<div class="min-w-0"><div class="flex flex-wrap items-center gap-2">'+historyStatus(importRow)+'<div class="font-bold text-base">'+esc(row.quote_no)+'</div></div>'+
        '<div class="text-xs text-gray-600 mt-2">'+esc(row.customer_name||'No customer name')+(row.customer_phone?' · '+esc(row.customer_phone):'')+'</div>'+
        '<div class="text-[10px] text-gray-400 mt-1">Issue '+esc(row.issue_date||'')+(row.salesperson?' · '+esc(row.salesperson):'')+' · '+money(row.amount||0,'USD')+'</div>'+
        '<div class="text-[10px] text-gray-400 mt-1">'+esc(row.source_name||'Saved quotation')+'</div></div>'+
        '<div class="flex flex-wrap gap-2 shrink-0"><button type="button" onclick="reviewQuotationHistory(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">View</button>'+
        (!importRow&&canCreate?'<button type="button" onclick="importQuotationFromHistory(\''+esc(row.source_record_id)+'\')" class="px-4 py-2.5 rounded-xl bg-[#17324d] text-white text-xs font-semibold">Import</button>':'')+
        (canDelete?'<button type="button" onclick="deleteQuotationHistory(\''+row.id+'\',\''+esc(row.source_record_id)+'\',\''+esc(row.quote_no)+'\')" class="px-4 py-2.5 rounded-xl border border-red-200 bg-white text-red-700 text-xs font-semibold">Delete</button>':'')+
        '</div></div></div>';
    }).join('');
    document.getElementById('content').innerHTML=
      '<div class="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-3"><div><h3 class="font-bold text-lg">Quotation History</h3><p class="text-xs text-gray-500 mt-1">Permanent showroom quotation register. Every new issued quotation keeps its original number and snapshot.</p></div><button onclick="refreshCurrentPage()" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Refresh</button></div>'+
      quotationTabs()+
      '<div class="grid grid-cols-3 gap-2 mb-5"><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Total Quotations</div><div class="text-xl font-bold mt-1">'+historyRows.length+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Imported</div><div class="text-xl font-bold mt-1">'+imported+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Converted</div><div class="text-xl font-bold mt-1">'+converted+'</div></div></div>'+
      '<div class="space-y-3">'+(html||'<div class="card rounded-2xl p-10 text-center text-sm text-gray-400">No permanent showroom quotations yet.</div>')+'</div>';
  }
  window.renderImportedQuotations=async function(){
    await loadOrderData();
    const rows=await getRows();
    const ready=rows.filter(x=>x.status==='ready').length;
    const draft=rows.filter(x=>x.status==='imported_draft').length;
    const converted=rows.filter(x=>x.status==='converted').length;
    const canDelete=canDeleteImportedQuotation();
    const html=rows.map(row=>{
      const s=quoteSummary(row);
      const customer=(state.customers||[]).find(c=>String(c.id)===String(row.customer_id));
      const itemCount=s.lines.reduce((n,l)=>n+Number(l.qty||0),0);
      const sourceLabel=row.source_quote_no||row.source_name||row.source_record_id;
      return '<div class="card rounded-2xl p-4 border border-[#ece6dc]"><div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"><div class="min-w-0">'+
        '<div class="flex flex-wrap items-center gap-2">'+badge(row.status)+'<div class="font-bold text-base truncate">'+esc(sourceLabel)+'</div></div>'+
        '<div class="text-xs text-gray-500 mt-2">'+esc(s.customerName||'No customer name')+(s.customerPhone?' · '+esc(s.customerPhone):'')+'</div>'+
        '<div class="text-[10px] text-gray-400 mt-1">'+itemCount+' quoted item'+(itemCount===1?'':'s')+' · '+money(s.total,'USD')+' · Imported '+esc(fmtDate(row.imported_at))+'</div>'+
        '<div class="text-[10px] mt-2 '+(customer?'text-green-700':'text-amber-700')+'">'+(customer?'Matched customer: <b>'+esc(customer.name)+'</b>':'No official CRM customer linked yet. The showroom details are reference only; select the customer manually before conversion.')+'</div></div>'+
        '<div class="flex gap-2 shrink-0"><button onclick="reviewImportedQuotation(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">'+(row.status==='converted'?'View':'Review / Convert')+'</button>'+
        (canDelete?'<button type="button" onclick="deleteImportedQuotation(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl border border-red-200 bg-white text-red-700 text-xs font-semibold hover:bg-red-50" title="Delete this imported record only">Delete</button>':'')+'</div></div></div>';
    }).join('');
    document.getElementById('content').innerHTML=
      '<div class="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-5"><div><h3 class="font-bold text-lg">Imported Quotations</h3><p class="text-xs text-gray-500 mt-1">Public/shared quotations from limperial-showroom stay as drafts here until a logged-in user manually links the official CRM customer and completes the TK/RK Sales Order.</p></div><button onclick="refreshCurrentPage()" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Refresh</button></div>'+
      '<div class="grid grid-cols-3 gap-2 mb-5"><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Customer Needed</div><div class="text-xl font-bold mt-1">'+draft+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Ready</div><div class="text-xl font-bold mt-1">'+ready+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Converted</div><div class="text-xl font-bold mt-1">'+converted+'</div></div></div>'+
      '<div class="space-y-3">'+(html||'<div class="card rounded-2xl p-10 text-center text-sm text-gray-400">No showroom quotations imported yet.</div>')+'</div>';
  };
  window.deleteImportedQuotation=async function(id){
    if(!canDeleteImportedQuotation()){
      showToast('Only Super Admin, Admin, and Manager can delete imported quotations.','err');
      return;
    }
    if(pendingDeletions.has(id))return;
    pendingDeletions.add(id);
    try{
      // Check live status first so converted records get a clear warning.
      const found=await db.from(TABLE).select('id,source_quote_no,source_name,status,converted_sales_order_id').eq('id',id).maybeSingle();
      if(found.error)throw found.error;
      const record=found.data;
      if(!record){
        showToast('This imported quotation no longer exists.','err');
        if(state.page==='quotation-imports')await renderImportedQuotations();
        return;
      }
      const name=record.source_quote_no||record.source_name||'this quotation';
      const message=record.status==='converted'
        ? 'Delete imported quotation "'+name+'"?\n\nThis removes the imported record and its link to the official Sales Order. The official Sales Order itself is NOT deleted.'
        : 'Delete imported quotation "'+name+'"?\n\nThis removes it from Imported Quotes. The saved quotation in the public showroom is NOT deleted.';
      if(!window.confirm(message))return;
      const removed=await db.from(TABLE).delete().eq('id',id).select('id');
      if(removed.error)throw removed.error;
      if(!removed.data?.length)throw new Error('Delete was not permitted, or this imported quotation no longer exists.');
      closeModal();
      showToast('Imported quotation deleted. The showroom quotation and official Sales Orders remain unchanged.');
      if(state.page==='quotation-imports')await renderImportedQuotations();
    }catch(err){
      console.error('Imported quotation deletion failed:',err);
      showToast(err.message||'Could not delete imported quotation.','err');
    }finally{
      pendingDeletions.delete(id);
    }
  };

  function customerOptions(selectedId){
    return '<option value="">-- Select existing customer --</option>'+(state.customers||[]).map(c=>'<option value="'+esc(c.id)+'" '+(String(c.id)===String(selectedId||'')?'selected':'')+'>'+esc(c.name)+(c.phone?' · '+esc(c.phone):'')+'</option>').join('');
  }
  window.reviewImportedQuotation=async function(id){
    await loadOrderData();
    const r=await db.from(TABLE).select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');
    const row=r.data;const s=quoteSummary(row);
    const canCreate=typeof window.hasAppPermission!=='function'||window.hasAppPermission('sales_orders.create');
    const canDelete=canDeleteImportedQuotation();
    const linked=(state.customers||[]).find(c=>String(c.id)===String(row.customer_id));
    let convertedOrderNo='';
    if(row.converted_sales_order_id){
      const linkedOrder=await db.from('sales_orders').select('order_no').eq('id',row.converted_sales_order_id).maybeSingle();
      if(!linkedOrder.error)convertedOrderNo=String(linkedOrder.data?.order_no||'');
    }
    const lines=s.lines.map((l,i)=>'<div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 items-center py-2 border-b last:border-b-0"><div class="min-w-0"><div class="text-xs font-semibold truncate">'+esc(l.code||l.name||('Line '+(i+1)))+'</div><div class="text-[10px] text-gray-500 truncate">'+esc(l.name||'')+(l.sourceSetName?' · Set: '+esc(l.sourceSetName):'')+'</div></div><div class="text-xs text-right">'+l.qty+'</div><div class="text-xs text-right">'+money(l.unitPrice,'USD')+'</div><div class="text-xs text-right">'+money(Math.max(l.qty*l.unitPrice-l.discountAmount,0),'USD')+'</div></div>').join('');
    openModal('Imported Quotation',
      '<div class="space-y-5"><div class="rounded-xl border bg-gray-50 p-4"><div class="flex flex-wrap items-center gap-2">'+badge(row.status)+'<span class="px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold">PUBLIC / SHARED SHOWROOM</span><b>'+esc(row.source_quote_no||row.source_name||row.source_record_id)+'</b></div>'+
      '<div class="mt-3 text-[10px] uppercase tracking-wide font-bold text-gray-400">Showroom information · reference only</div>'+
      '<div class="text-xs text-gray-700 mt-1"><b>Entered customer:</b> '+esc(s.customerName||'Not entered')+(s.customerPhone?' · '+esc(s.customerPhone):'')+'</div>'+
      (s.customerAddress?'<div class="text-[10px] text-gray-500 mt-1"><b>Entered address:</b> '+esc(s.customerAddress)+'</div>':'')+
      (s.salesperson?'<div class="text-[10px] text-gray-500 mt-1"><b>Showroom salesperson text:</b> '+esc(s.salesperson)+' · reference only, does not assign ownership</div>':'')+
      (row.converted_sales_order_id?'<div class="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[10px] text-green-800">Converted to official Sales Order'+(convertedOrderNo?' <b>'+esc(convertedOrderNo)+'</b>':'')+'.'+(convertedOrderNo?' <button type="button" onclick="closeModal();openDashboardSalesOrder(\''+row.converted_sales_order_id+'\')" class="underline font-semibold ml-1">Open order</button>':'')+'</div>':'')+
      '<div class="text-[9px] text-gray-400 mt-2">Source ID: '+esc(row.source_record_id)+'</div></div>'+
      '<div><div class="flex items-center justify-between mb-2"><b class="text-sm">Quoted items</b><span class="text-xs font-bold">'+money(s.total,'USD')+'</span></div>'+
      '<div class="rounded-xl border overflow-hidden"><div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 bg-gray-50 px-3 py-2 text-[9px] uppercase font-bold text-gray-400"><div>Item</div><div class="text-right">Qty</div><div class="text-right">Price</div><div class="text-right">Net</div></div><div class="px-3">'+(lines||'<div class="p-4 text-xs text-gray-400">No items in this quotation.</div>')+'</div></div>'+
      (s.orderDiscount>0?'<div class="text-[10px] text-right text-gray-500 mt-2">Quotation-level discount carried to Sales Order: '+money(s.orderDiscount,'USD')+'</div>':'')+'</div>'+
      '<div class="rounded-xl border border-blue-100 bg-blue-50/30 p-4"><div class="text-[10px] uppercase tracking-wide font-bold text-blue-700">Official Customer · CRM</div><label class="text-xs font-semibold block mt-2">Select the official customer manually</label><select id="importQuoteCustomer" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">'+customerOptions(row.customer_id)+'</select>'+
      '<div class="text-[10px] mt-2 '+(linked?'text-green-700':'text-amber-700')+'">'+(linked?'Official CRM customer: <b>'+esc(linked.name)+'</b>.':'No official customer linked. We do not auto-match public showroom names or phone numbers.')+'</div>'+
      '<div class="text-[10px] text-gray-500 mt-1">If the customer does not exist yet, create/link the customer in the normal Customer workflow, then return here and select it.</div>'+
      '<div class="flex flex-wrap gap-2 mt-3"><button '+(!canCreate?'disabled':'')+' onclick="saveImportedQuotationCustomer(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl text-xs font-semibold '+(!canCreate?'bg-gray-200 text-gray-400 cursor-not-allowed':'bg-[#17324d] text-white')+'">'+(canCreate?'Link Official Customer':'View Only')+'</button><button onclick="closeModal();go(\'customers\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Create / Find Customer</button></div></div>'+
      '<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>Official Sales Order rule:</b> conversion opens your normal Sales Order form. You must choose TK or RK and enter its official number; the existing duplicate, product, payment, DO, and role validations still run.</div>'+
      (!canCreate?'<div class="rounded-xl border bg-gray-50 p-3 text-xs text-gray-600">Your current role can review this quotation but cannot create Sales Orders.</div>':'')+
      '<button '+(!canCreate||!row.customer_id||row.status==='converted'?'disabled':'')+' onclick="convertImportedQuotation(\''+row.id+'\')" class="w-full rounded-xl py-3 font-semibold '+(!canCreate||!row.customer_id||row.status==='converted'?'bg-gray-200 text-gray-400 cursor-not-allowed':'bg-[#211d18] text-white')+'">'+(row.status==='converted'?'Already Converted':(!canCreate?'View Only':'Convert to Official Sales Order'))+'</button>'+
      (canDelete?'<button type="button" onclick="deleteImportedQuotation(\''+row.id+'\')" class="w-full rounded-xl border border-red-200 bg-white py-2.5 text-red-700 text-xs font-semibold">Delete Imported Quotation</button>':'')+'</div>'
    );
  };
  window.saveImportedQuotationCustomer=async function(id){
    if(typeof window.hasAppPermission==='function'&&!window.hasAppPermission('sales_orders.create'))return showToast('Your role cannot create Sales Orders.','err');
    const customerId=document.getElementById('importQuoteCustomer')?.value||null;
    if(!customerId)return showToast('Select the official CRM customer first. If the customer does not exist, create/link it in Customers and then return here.','err');
    const r=await db.from(TABLE).update({customer_id:customerId,status:'ready',updated_at:new Date().toISOString()}).eq('id',id).select().single();
    if(r.error)return showToast(r.error.message,'err');
    showToast('Official CRM customer linked. This quotation is ready for conversion.');await reviewImportedQuotation(id);
  };
  function fillProductRow(row,line,product){
    row.querySelector('.product-id').value=product?.id||'';
    row.querySelector('.product-code').value=product?.code||line.code||'';
    row.querySelector('.product-name').value=product?.item_name||line.name||'';
    row.querySelector('.product-image').value=product?.image_url||line.image||'';
    row.querySelector('.product-class').value=product?.class||line.className||'';
    if(row.querySelector('.product-type'))row.querySelector('.product-type').value='';
    const search=row.querySelector('.product-search-input');if(search)search.value=product?(String(product.code||'')+' · '+String(product.item_name||'')):String(line.code||line.name||'');
    row.querySelector('.qty').value=String(line.qty);row.querySelector('.unit-price').value=String(line.unitPrice);row.querySelector('.line-discount').value=String(line.discountAmount);
    row.dataset.discountBasis='amount';
    if(typeof updateSalesProductPhotoPreview==='function')updateSalesProductPhotoPreview(row,product?.image_url||line.image||'');
    const classLabel=row.querySelector('.product-class-label');if(classLabel)classLabel.textContent=product?.class||line.className||'Unclassified';
    const typeLabel=row.querySelector('.product-type-label');if(typeLabel)typeLabel.textContent=product?'Matched':'Needs product match';
  }
  function fillServiceRow(row,line){
    const name=line.name||'Service Fee';const sel=row.querySelector('.service-fee-type');
    if(sel){sel.value=['Service Fee','Maintenance Fee','Cleaning Fee','Delivery / Installation','Other Fee'].includes(name)?name:'Other Fee';if(typeof serviceFeeChanged==='function')serviceFeeChanged(sel)}
    const nameInput=row.querySelector('.service-name');if(nameInput){nameInput.value=name;if(typeof serviceFeeNameChanged==='function')serviceFeeNameChanged(nameInput)}
    row.querySelector('.qty').value=String(line.qty);row.querySelector('.unit-price').value=String(line.unitPrice);row.querySelector('.line-discount').value=String(line.discountAmount);row.dataset.discountBasis='amount';
  }
  window.convertImportedQuotation=async function(id){
    if(typeof window.hasAppPermission==='function'&&!window.hasAppPermission('sales_orders.create'))return showToast('Your role cannot create Sales Orders.','err');
    await loadOrderData();
    const r=await db.from(TABLE).select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');
    const draft=r.data;
    if(draft.status==='converted')return showToast('This quotation has already been converted.','err');
    if(!draft.customer_id)return showToast('Link an existing customer before converting this quotation.','err');
    const customer=(state.customers||[]).find(c=>String(c.id)===String(draft.customer_id));
    if(!customer)return showToast('The linked customer is not available to your account. Create/link or request access first.','err');
    const s=quoteSummary(draft);closeModal();await openNewOrder();
    const form=document.getElementById('orderForm');if(!form)return showToast('Could not open the Sales Order form.','err');
    const select=document.getElementById('orderCustomer');
    if(select){select.value=customer.id;select.dispatchEvent(new Event('change',{bubbles:true}))}
    const search=document.getElementById('orderCustomerSearch');if(search){search.value=customer.name||'';search.dataset.customerId=customer.id}
    const flow=document.getElementById('salesFlowType');if(flow){flow.value='stock_sale';flow.dispatchEvent(new Event('change',{bubbles:true}))}
    const doc=document.getElementById('salesDocumentNo');if(doc)doc.value='';
    const wrap=document.getElementById('orderItems');if(wrap)wrap.innerHTML='';
    let unmatched=0;
    s.lines.forEach(line=>{
      if(line.kind==='service'){
        addServiceFeeRow();const row=wrap?.lastElementChild;if(row)fillServiceRow(row,line);return;
      }
      addOrderItemRow();const row=wrap?.lastElementChild;
      const product=(state.products||[]).find(p=>lower(p.code)===lower(line.code));
      if(!product)unmatched++;if(row)fillProductRow(row,line,product);
    });
    if(!s.lines.length)addOrderItemRow();
    const discount=document.getElementById('orderDiscount');if(discount)discount.value=String(s.orderDiscount);
    const notes=document.getElementById('orderNotes');
    if(notes)notes.value=['Imported from limperial-showroom',draft.source_quote_no?('Quotation: '+draft.source_quote_no):'',draft.source_name?('Saved list: '+draft.source_name):''].filter(Boolean).join(' · ');
    if(typeof salesEntryRecalc==='function')salesEntryRecalc();
    if(typeof updateSalesCustomerReviewHint==='function')updateSalesCustomerReviewHint();
    activeConversionId=id;
    const title=document.getElementById('modalTitle');if(title)title.textContent='Convert Quotation → Official Sales Order';
    const hint=document.getElementById('salesFlowHint');
    if(hint)hint.innerHTML='<b>Imported quotation:</b> review all lines, choose <b>TK or RK</b>, then enter the official number. '+(unmatched?'<span class="text-red-700"><b>'+unmatched+' product line'+(unmatched===1?' is':'s are')+' not matched yet.</b> Select the matching catalog product before saving.</span>':'All product codes matched the current catalog.');
    if(doc)doc.focus();
  };

  const baseCloseModal=window.closeModal;
  if(typeof baseCloseModal==='function'){
    window.closeModal=function(){
      // If a quotation conversion form is abandoned, clear its context so a later
      // unrelated Sales Order can never mark the old quotation as converted.
      if(activeConversionId && document.getElementById('orderForm')) activeConversionId=null;
      return baseCloseModal.apply(this,arguments);
    };
  }

  const previousAfterCreate=window.afterSalesOrderCreated;
  window.afterSalesOrderCreated=async function(so,meta){
    if(typeof previousAfterCreate==='function')await previousAfterCreate(so,meta);
    if(!activeConversionId)return;
    const id=activeConversionId;activeConversionId=null;
    const r=await db.from(TABLE).update({status:'converted',converted_sales_order_id:so.id,converted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);
    if(r.error)throw r.error;
  };

  const oldNavItems=window.navItems;
  if(typeof oldNavItems==='function'){
    window.navItems=function(){
      const items=oldNavItems.apply(this,arguments)||[];
      const allowed=typeof window.hasAppPermission!=='function'||window.hasAppPermission('sales_orders.view');
      if(!allowed||items.some(x=>x[0]==='quotation-imports'))return items;
      const out=[];items.forEach(item=>{out.push(item);if(item[0]==='sales-orders')out.push(['quotation-imports','Imported Quotes','⇢'])});return out;
    };
  }
  const oldGo=window.go;
  if(typeof oldGo==='function'){
    window.go=async function(page){
      if(page!=='quotation-imports')return oldGo.apply(this,arguments);
      if(typeof window.hasAppPermission==='function'&&!window.hasAppPermission('sales_orders.view')){showToast('You do not have access to Sales Orders.','err');return oldGo('dashboard')}
      state.page=page;renderNav();
      document.getElementById('pageTitle').textContent='Imported Quotations';
      document.getElementById('pageSubtitle').textContent='Review showroom quotations before creating official TK/RK Sales Orders';
      document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
      try{await renderImportedQuotations()}catch(err){document.getElementById('content').innerHTML='<div class="card rounded-xl p-5 text-red-600">Error: '+esc(err.message||String(err))+'</div>'}
    };
  }
  async function processHandoff(){
    if(handoffBusy)return;
    const params=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
    const recordId=params.get('showroom-quote');if(!recordId||!state?.user||!state?.profile)return;
    handoffBusy=true;
    try{
      const row=await importSavedRecord(recordId);
      history.replaceState(null,'',location.pathname+location.search);
      await go('quotation-imports');
      showToast(row.status==='converted'?'Quotation already converted.':(row.status==='ready'?'Quotation opened with its previously linked official customer.':'Public showroom quotation imported. Select the official CRM customer before conversion.'));
      setTimeout(()=>{try{reviewImportedQuotation(row.id)}catch(_){}},150);
    }catch(err){
      console.error('Showroom quotation import failed:',err);
      // Stop automatic retry loops. The user can send the quotation again from the showroom after fixing the issue.
      history.replaceState(null,'',location.pathname+location.search);
      showToast(err.message||'Could not import showroom quotation.','err');
    }
    finally{handoffBusy=false}
  }
  if(String(location.hash||'').includes('showroom-quote=')){
    const timer=setInterval(()=>{
      if(!String(location.hash||'').includes('showroom-quote=')){clearInterval(timer);return}
      if(state?.user&&state?.profile)processHandoff();
    },700);
    setTimeout(()=>{if(state?.user&&state?.profile)processHandoff()},0);
  }
})();
