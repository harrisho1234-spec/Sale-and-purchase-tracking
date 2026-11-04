// Showroom quotation import staging + conversion workflow.
// Imports only after authenticated login, then reuses the existing Sales Order form/validation.
(function(){
  const SOURCE_SYSTEM='limperial-showroom';
  const SOURCE_API='https://script.google.com/macros/s/AKfycbwAah-oFIyiSON0jOhjWlL1lzlr0d354bq-1OxMDY2Qz-D-rzAYFaPzTkKDNlnfz1tk/exec';
  const TABLE='showroom_quotation_imports';
  const REGISTRY_TABLE='showroom_quotation_registry';
  const REVISION_TABLE='showroom_quotation_revisions';
  let quotationSection='history';
  let handoffBusy=false;
  let activeConversionId=null;
  let activeConversionSnapshot=null;
  let conversionSaving=false;
  let quotationAnalyticsYear='all';
  let quotationAnalyticsRep='all';
  const pendingDeletions=new Set();
  function canViewQuotations(){
    return typeof window.hasAppPermission!=='function'||window.hasAppPermission('quotations.view');
  }
  function canCreateQuotations(){
    return typeof window.hasAppPermission!=='function'||window.hasAppPermission('quotations.create');
  }
  function canConvertQuotations(){
    const canCreateSales=typeof window.hasAppPermission!=='function'||window.hasAppPermission('sales_orders.create');
    return canCreateQuotations()&&canCreateSales;
  }
  function canDeleteImportedQuotation(){
    return typeof window.hasAppPermission!=='function'||window.hasAppPermission('quotations.delete');
  }

  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
  function num(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}
  function clampPct(v){return Math.max(0,Math.min(100,num(v,0)))}
  function lower(v){return String(v||'').trim().toLowerCase()}
  function quotationKind(no){
    return String(no||'').trim().toUpperCase().startsWith('P-')?'Project':'Showroom';
  }
  function quotationRevision(sourceState){
    const n=Number(sourceState?.quotationRevision||0);
    return Number.isFinite(n)&&n>0?Math.floor(n):0;
  }
  function quotationDisplay(no,sourceState){
    const base=String(no||'').trim();
    const rev=quotationRevision(sourceState);
    return base&&rev>0?base+' · Rev '+rev:base;
  }
  function revisionLabel(n){
    const rev=Math.max(0,Number(n)||0);
    return rev>0?'Rev '+rev:'Original';
  }
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
  // V4 captures the notes by each cart row's stable ID inside quotation form
  // state, not in the catalog item. Do not match by product code: the same
  // product may appear twice with different room, discount and note.
  function quotationFormState(sourceState){
    const states=sourceState?.documentFormStates||{};
    return (states.quotation?.initialized?states.quotation:null)||
      states[sourceState?.documentType]||states.quotation||{};
  }
  function quotationItemNote(sourceState,entry,index){
    const map=quotationFormState(sourceState)?.itemNotes||{};
    const key=String(entry?.id??entry?.item?.id??index);
    return Object.prototype.hasOwnProperty.call(map,key)?String(map[key]??'').trim():'';
  }
  function quotationItemSection(sourceState,entry){
    return String(entry?.documentSections?.quotation||
      entry?.documentSections?.[sourceState?.documentType]||'').trim();
  }
  function sourceItemNoteForOrder(line){
    return [line.section?'Floor / Room / Section: '+line.section:'',line.note||''].filter(Boolean).join(' · ');
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
        const setNote=quotationItemNote(sourceState,entry,index);
        const section=quotationItemSection(sourceState,entry);
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
            forcePreorder:!!entry.forcePreorder,sourceSetName:String(entry.setName||entry.name||'Set').trim(),
            section,note:partIndex===0?setNote:'',sourceCartId:String(entry?.id??index)
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
        forcePreorder:!!entry?.forcePreorder,sourceSetName:'',
        section:quotationItemSection(sourceState,entry),
        note:quotationItemNote(sourceState,entry,index),sourceCartId:String(entry?.id??entry?.item?.id??index)
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
    const gross=round2(lines.reduce((sum,l)=>sum+l.qty*l.unitPrice,0));
    const lineDiscounts=round2(lines.reduce((sum,l)=>sum+l.discountAmount,0));
    const lineNet=round2(lines.reduce((sum,l)=>sum+Math.max(l.qty*l.unitPrice-l.discountAmount,0),0));
    const pct=clampPct(sourceState?.discountPctValue);
    const flat=Math.max(0,num(sourceState?.discountFlatValue,0));
    const orderDiscount=round2(Math.min(lineNet,lineNet*pct/100+flat));
    return {sourceState,lines,customerName,customerPhone,customerAddress,quoteNo,salesperson,
      gross,lineDiscounts,lineNet,orderDiscountPct:pct,orderDiscountFlat:flat,
      orderDiscount,total:round2(Math.max(lineNet-orderDiscount,0))};
  }
  // Compare business fields, not JSON serialization order or transient UI flags.
  function quotationBusinessSignature(recordOrRow){
    const s=quoteSummary(recordOrRow);
    return JSON.stringify({
      number:s.quoteNo,revision:quotationRevision(s.sourceState),
      customer:s.customerName,phone:normalizeCustomerPhone(s.customerPhone),
      gross:s.gross,lineDiscounts:s.lineDiscounts,
      orderDiscount:s.orderDiscount,total:s.total,
      lines:s.lines.map(l=>[l.key,l.kind,l.code,l.name,l.qty,l.unitPrice,l.discountAmount,l.note,l.section,l.sourceSetName])
    });
  }
  function normalizeCustomerPhone(phone){
    let digits=String(phone||'').replace(/\D/g,'');
    if(digits.startsWith('00855'))digits=digits.slice(2);
    if(digits.startsWith('855'))digits='0'+digits.slice(3);
    if(digits.length<8||digits.length>12)return '';
    return digits;
  }
  function candidateCustomers(summary){
    const phone=normalizeCustomerPhone(summary.customerPhone);
    const name=lower(summary.customerName).replace(/\s+/g,' ').trim();
    return (state.customers||[]).map(c=>{
      const exactPhone=!!phone&&normalizeCustomerPhone(c.phone)===phone;
      const exactName=name.length>2&&lower(c.name).replace(/\s+/g,' ').trim()===name;
      return {customer:c,score:exactPhone?2:exactName?1:0,label:exactPhone?'Phone match':'Name match'};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
  }
  function quotationChangeNotice(snapshot,latest){
    if(!latest)return{changed:false,unchecked:true};
    const oldRev=quotationRevision(snapshot?.source_payload||{});
    const newerRev=quotationRevision(parseState(latest));
    const changed=quotationBusinessSignature(snapshot)!==quotationBusinessSignature(latest);
    return {changed,unchecked:false,newerRev,oldRev};
  }
  async function verifyQuotationSnapshot(row){
    const latest=await jsonpRecord(row.source_record_id);
    if(!latest)throw Error('Could not verify the latest saved Showroom quotation. Try again.');
    return quotationChangeNotice(row,latest);
  }
  window.refreshImportedQuotation=async function(id){
    if(!canCreateQuotations())return showToast('Quotation import permission required.','err');
    const row=await db.from(TABLE).select('id,status,source_record_id').eq('id',id).single();
    if(row.error)return showToast(row.error.message,'err');
    if(row.data.status==='converted')return showToast('Converted quotations are preserved and cannot be refreshed.','err');
    if(!window.confirm('Update this imported quotation from the latest saved Showroom revision? The prior snapshot remains in Quotation History. Any in-progress conversion should be reviewed again.'))return;
    try{
      await importSavedRecord(row.data.source_record_id);
      showToast('Latest Showroom quotation imported. Review the price, discounts, notes and customer before conversion.');
      await window.reviewImportedQuotation(id);
    }catch(e){showToast(e.message||'Could not update quotation','err')}
  };
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
  function jsonpSavedListIndex(){
    return new Promise((resolve,reject)=>{
      const cb='__limperialQuoteList_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
      const script=document.createElement('script');let done=false;
      const finish=(err,data)=>{
        if(done)return;done=true;clearTimeout(timer);
        try{delete window[cb]}catch(_){window[cb]=undefined}
        script.remove();err?reject(err):resolve(data);
      };
      const timer=setTimeout(()=>finish(new Error('Showroom quotation list timed out.')),15000);
      window[cb]=data=>{
        if(data?.ok===false)return finish(new Error(data.error||'Could not read showroom quotations.'));
        finish(null,Array.isArray(data?.lists)?data.lists:[]);
      };
      script.onerror=()=>finish(new Error('Could not reach the showroom quotation service.'));
      const q=new URLSearchParams({action:'list',callback:cb,_cb:String(Date.now())});
      script.src=SOURCE_API+'?'+q.toString();document.head.appendChild(script);
    });
  }

  async function confirmRegistryRevision(registryRow,record){
    const sourceState=parseState(record);
    const summary=quoteSummary(record);
    const revision=quotationRevision(sourceState);
    const current=Math.max(0,Number(registryRow?.current_revision)||0);
    if(!summary.quoteNo||summary.quoteNo!==registryRow.quote_no||revision<=current)return false;
    const confirmed=await db.rpc('confirm_showroom_quotation_v2',{
      p_source_record_id:registryRow.source_record_id,
      p_quote_no:registryRow.quote_no,
      p_source_payload:sourceState,
      p_source_name:String(record?.name||registryRow.source_name||'').trim()||null,
      p_saved_at:record?.savedAt||new Date().toISOString(),
      p_amount:summary.total
    });
    if(confirmed.error)throw confirmed.error;
    return confirmed.data===true;
  }

  async function syncRegistryRevisionsFromV4(rows){
    if(!Array.isArray(rows)||!rows.length)return false;
    const lists=await jsonpSavedListIndex();
    const byId=new Map(lists.map(x=>[String(x?.id||''),x]));
    let changed=false;
    for(const row of rows){
      const record=byId.get(String(row.source_record_id||''));
      if(!record)continue;
      try{
        if(await confirmRegistryRevision(row,record))changed=true;
      }catch(err){
        console.warn('Quotation revision sync skipped for '+row.quote_no+':',err?.message||err);
      }
    }
    return changed;
  }

  async function getRevisionRows(quotationId){
    const r=await db.from(REVISION_TABLE)
      .select('*')
      .eq('quotation_id',quotationId)
      .order('revision_no',{ascending:false});
    if(r.error)throw r.error;
    return r.data||[];
  }

  async function loadOrderData(){if(typeof ensureOrderFormData==='function')await ensureOrderFormData()}
  async function importSavedRecord(recordId){
    const id=String(recordId||'').trim();if(!id)throw new Error('Missing showroom quotation ID.');
    const existing=await db.from(TABLE).select('*').eq('source_system',SOURCE_SYSTEM).eq('source_record_id',id).maybeSingle();
    if(existing.error)throw existing.error;
    const record=await jsonpRecord(id);if(!record)throw new Error('The saved showroom quotation could not be found.');
    const sourceState=parseState(record);const summary=quoteSummary(record);
    if(summary.quoteNo){
      try{
        const confirmed=await db.rpc('confirm_showroom_quotation_v2',{
          p_source_record_id:id,
          p_quote_no:summary.quoteNo,
          p_source_payload:sourceState,
          p_source_name:String(record.name||'Saved quotation').trim(),
          p_saved_at:record.savedAt||new Date().toISOString(),
          p_amount:summary.total
        });
        if(confirmed.error)console.warn('Quotation history confirmation skipped:',confirmed.error.message);
      }catch(err){console.warn('Quotation history confirmation skipped:',err)}
    }

    if(existing.data){
      if(existing.data.status==='converted')return existing.data;
      const refreshed={
        source_name:String(record.name||existing.data.source_name||'Saved quotation').trim(),
        source_saved_at:record.savedAt||existing.data.source_saved_at||null,
        source_document_type:String(sourceState.documentType||'quotation'),
        source_quote_no:summary.quoteNo||existing.data.source_quote_no||null,
        source_salesperson:summary.salesperson||null,
        source_payload:sourceState,
        customer_name:summary.customerName||null,
        customer_phone:summary.customerPhone||null,
        customer_address:summary.customerAddress||null,
        updated_at:new Date().toISOString()
      };
      const updated=await db.from(TABLE).update(refreshed).eq('id',existing.data.id).select().single();
      if(updated.error)throw updated.error;
      return updated.data;
    }

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
    return '<div class="inline-flex flex-wrap rounded-xl border bg-white p-1 mb-5">'+
      [['history','Quotation History'],['imports','Imported Queue'],['analytics','Conversion Analytics']]
        .map(([key,label])=>'<button type="button" onclick="showQuotationSection(\''+key+'\')" class="px-4 py-2 rounded-lg text-xs font-semibold '+
          (quotationSection===key?'bg-[#211d18] text-white':'text-gray-600 hover:bg-gray-50')+'">'+label+'</button>').join('')+
      '</div>';
  }
  window.showQuotationSection=function(section){
    quotationSection=['history','imports','analytics'].includes(section)?section:'history';
    renderImportedQuotations();
  };
  async function getRegistryRows(){
    const r=await db.from(REGISTRY_TABLE)
      .select('id,quote_no,quote_prefix,quote_month,sequence_no,source_record_id,source_name,issue_date,saved_at,customer_name,customer_phone,salesperson,amount,confirmed_at,current_revision,source_payload')
      .order('issue_date',{ascending:false})
      .order('sequence_no',{ascending:false});
    if(r.error)throw r.error;
    return r.data||[];
  }
  async function linkedOrderMap(importRows){
    const ids=[...new Set((importRows||[]).filter(r=>r?.status==='converted'&&r.converted_sales_order_id)
      .map(r=>String(r.converted_sales_order_id)))];
    if(!ids.length)return new Map();
    const res=await db.from('sales_orders')
      .select('id,order_no,sr_no,invoice_no,order_date,sales_rep_name_snapshot,status,created_at')
      .in('id',ids);
    if(res.error){console.warn('Linked quotation orders unavailable:',res.error.message);return new Map()}
    return new Map((res.data||[]).map(o=>[String(o.id),o]));
  }
  function linkedOrderNo(o){
    return String(o?.order_no||o?.sr_no||o?.invoice_no||'').trim();
  }
  function linkedQuoteTimeline(row,order){
    if(!row)return '';
    const revision=quotationRevision(row.source_payload);
    return '<div class="rounded-xl border bg-[#faf9f6] p-3 text-xs space-y-1.5">'+
      '<b class="block text-sm">Quotation → Official Document History</b>'+
      '<div><b>Showroom saved:</b> '+esc(fmtDate(row.source_saved_at)||'Not recorded')+'</div>'+
      '<div><b>Imported:</b> '+esc(fmtDate(row.imported_at)||'Not recorded')+'</div>'+
      '<div><b>Source quotation revision:</b> '+esc(revisionLabel(revision))+' (preserved at conversion)</div>'+
      '<div><b>Converted:</b> '+esc(fmtDate(row.converted_at)||'Not yet converted')+'</div>'+
      (order?'<div><b>Official order:</b> '+esc(linkedOrderNo(order)||'Order')+' · '+esc(order.sales_rep_name_snapshot||'Sales representative not recorded')+'</div>'+
        '<button type="button" onclick="openLinkedQuotationOrder(\''+esc(order.id)+'\')" class="mt-2 px-3 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">Open Linked Sales Order</button>':
        row.status==='converted'?'<div class="text-amber-800">Official order is linked but not available in your current permissions.</div>':'')+
    '</div>';
  }
  window.openLinkedQuotationOrder=async function(id){
    // Respect existing Sales Order RLS and role permissions. The quotation's
    // reference ID alone must not reveal otherwise restricted Sales Orders.
    const res=await db.from('sales_orders').select('id').eq('id',id).maybeSingle();
    if(res.error||!res.data)return showToast('This Sales Order is not accessible with your account.','err');
    closeModal();
    if(typeof window.openDashboardSalesOrder==='function')return window.openDashboardSalesOrder(id);
    await go('sales-orders');
    showToast('Open the linked Sales Order in Sales & Customers.');
  };
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
        const msg=String(data?.error||data?.message||'').trim();
        const alreadyGone=/not found|already deleted|already removed|no longer exists|does not exist/i.test(msg);
        // Deletion is idempotent. Some older V4/Google Sheets responses return
        // {ok:true, deleted:false, error:"...not found..."} while newer ones may
        // return ok:false. In either case, "not found" means the V4 side is already
        // clean and must not block deletion of Sales & Order Management history.
        if(alreadyGone){
          return finish(null,{ok:true,deleted:true,alreadyDeleted:true,message:msg});
        }
        if(data?.ok===false)return finish(new Error(msg||'Could not delete showroom quotation.'));
        finish(null,data||{});
      };
      script.onerror=()=>finish(new Error('Could not reach the showroom quotation service.'));
      const q=new URLSearchParams({action:'markDelete',recordId:String(recordId||''),callback:cb,_cb:String(Date.now())});
      script.src=SOURCE_API+'?'+q.toString();document.head.appendChild(script);
    });
  }
  window.importQuotationFromHistory=async function(sourceRecordId){
    if(!canCreateQuotations()){
      showToast('Your role cannot create or import quotations.','err');return;
    }
    try{
      const row=await importSavedRecord(sourceRecordId);
      quotationSection='imports';
      await renderImportedQuotations();
      showToast(row.status==='converted'?'Quotation was already converted.':'Quotation added to the Imported Queue.');
      setTimeout(()=>reviewImportedQuotation(row.id),100);
    }catch(err){showToast(err.message||'Could not import quotation.','err')}
  };
  function quotationLineImage(line){
    if(!line||line.kind==='service')return '';
    let url=String(line.image||'').trim();
    if(!url&&Array.isArray(state?.products)){
      const product=state.products.find(p=>lower(p.code)===lower(line.code));
      url=String(product?.image_url||'').trim();
    }
    if(url&&typeof window.normalizeGoogleImageUrl==='function')url=window.normalizeGoogleImageUrl(url);
    else if(url&&typeof normalizeGoogleImageUrl==='function')url=normalizeGoogleImageUrl(url);
    return url;
  }

  function quoteDiscountSummaryHtml(s){
    return '<div class="rounded-xl border bg-[#faf8f4] p-3 text-xs space-y-1.5" data-quotation-discount-breakdown>'+
      '<div class="flex justify-between gap-3"><span>Full price before discount</span><b>'+money(s.gross,'USD')+'</b></div>'+
      '<div class="flex justify-between gap-3"><span>Item discounts</span><b class="text-amber-700">−'+money(s.lineDiscounts,'USD')+'</b></div>'+
      '<div class="flex justify-between gap-3"><span>After item discounts</span><b>'+money(s.lineNet,'USD')+'</b></div>'+
      '<div class="flex justify-between gap-3"><span>Additional quotation discount'+
        (s.orderDiscountPct>0?' ('+esc(String(s.orderDiscountPct))+'%':'')+
        (s.orderDiscountFlat>0?(s.orderDiscountPct>0?' + ':' (')+money(s.orderDiscountFlat,'USD'):'')+
        (s.orderDiscountPct>0||s.orderDiscountFlat>0?')':'')+
        '</span><b class="text-amber-700">−'+money(s.orderDiscount,'USD')+'</b></div>'+
      '<div class="flex justify-between gap-3 pt-2 border-t font-bold"><span>Final quoted total</span><span>'+money(s.total,'USD')+'</span></div>'+
    '</div>';
  }
  function quoteListDetailsHtml(s){
    const discount=round2(s.lineDiscounts+s.orderDiscount);
    const notes=s.lines.filter(l=>!!l.note).length;
    const sections=[...new Set(s.lines.map(l=>l.section).filter(Boolean))].length;
    if(!discount&&!notes&&!sections)return '';
    const details=[
      discount?'Total discount: '+money(discount,'USD'):'',
      notes?notes+' item note'+(notes===1?'':'s'):'',
      sections?sections+' floor/room section'+(sections===1?'':'s'):''
    ].filter(Boolean);
    return '<div class="text-[10px] font-medium text-amber-800 mt-1">'+details.map(esc).join(' · ')+'</div>';
  }
  function quoteLineDetailsHtml(l){
    return '<div class="min-w-0 mt-1 space-y-0.5">'+
      (l.sourceSetName?'<div class="text-[10px] text-slate-500">Set: '+esc(l.sourceSetName)+'</div>':'')+
      (l.section?'<div class="text-[10px] text-blue-700"><b>Floor / Room:</b> '+esc(l.section)+'</div>':'')+
      (l.discountAmount>0?'<div class="text-[10px] text-amber-700"><b>Item discount:</b> '+esc(String(l.discountPct))+'% (−'+money(l.discountAmount,'USD')+')</div>':
        '<div class="text-[10px] text-gray-400">Item discount: 0%</div>')+
      (l.note?'<div class="text-[10px] text-gray-700 whitespace-pre-wrap break-words"><b>Item note:</b> '+esc(l.note)+'</div>':'')+
    '</div>';
  }
  function quotationSnapshotLines(summary){
    return summary.lines.map((l,i)=>{
      const img=quotationLineImage(l);
      const photo=img?
        '<div class="w-10 h-10 rounded-lg border bg-gray-50 overflow-hidden shrink-0"><img src="'+esc(img)+'" alt="" class="w-full h-full object-cover" onerror="this.style.display=\'none\'"></div>':
        '<div class="w-10 h-10 rounded-lg border bg-gray-50 shrink-0 flex items-center justify-center text-[7px] text-gray-400 text-center px-1">No image</div>';
      return '<div class="grid grid-cols-[minmax(0,1fr)_55px_75px_85px] sm:grid-cols-[minmax(0,1fr)_70px_95px_95px] gap-2 items-start py-3 border-b last:border-b-0">'+
        '<div class="min-w-0 flex gap-2">'+photo+'<div class="min-w-0 flex-1">'+
          '<div class="text-xs font-semibold break-words">'+esc(l.code||l.name||('Line '+(i+1)))+'</div>'+
          '<div class="text-[10px] text-gray-500 break-words">'+esc(l.name||'')+'</div>'+quoteLineDetailsHtml(l)+'</div></div>'+
        '<div class="text-xs text-right">'+l.qty+'</div>'+
        '<div class="text-xs text-right">'+money(l.unitPrice,'USD')+'</div>'+
        '<div class="text-xs text-right"><div class="'+(l.discountAmount>0?'text-gray-400 line-through text-[10px]':'hidden')+'">'+money(round2(l.qty*l.unitPrice),'USD')+'</div>'+
          '<b>'+money(round2(Math.max(l.qty*l.unitPrice-l.discountAmount,0)),'USD')+'</b></div></div>';
    }).join('');
  }

  function revisionTimelineButtons(quotationId,revisions,currentRevision){
    if(!revisions.length)return '<div class="text-xs text-gray-400">No revision snapshots recorded yet.</div>';
    return '<div class="flex flex-wrap gap-2">'+revisions.slice().sort((a,b)=>a.revision_no-b.revision_no).map(r=>{
      const active=Number(r.revision_no)===Number(currentRevision);
      return '<button type="button" onclick="reviewQuotationRevision(\''+quotationId+'\','+Number(r.revision_no)+')" class="px-3 py-2 rounded-lg border text-xs font-semibold '+(active?'bg-[#211d18] text-white border-[#211d18]':'bg-white text-gray-700')+'">'+revisionLabel(r.revision_no)+'</button>';
    }).join('')+'</div>';
  }

  window.reviewQuotationRevision=async function(quotationId,revisionNo){
    await loadOrderData();
    const [q,r]=await Promise.all([
      db.from(REGISTRY_TABLE).select('*').eq('id',quotationId).single(),
      db.from(REVISION_TABLE).select('*').eq('quotation_id',quotationId).eq('revision_no',revisionNo).single()
    ]);
    if(q.error)return showToast(q.error.message,'err');
    if(r.error)return showToast(r.error.message,'err');
    const row=q.data,rev=r.data,s=quoteSummary({source_payload:rev.source_payload,customer_name:rev.customer_name,customer_phone:rev.customer_phone});
    const lines=quotationSnapshotLines(s);
    openModal('Quotation Revision',
      '<div class="space-y-4">'+
      '<div class="rounded-xl border bg-gray-50 p-4"><div class="flex flex-wrap gap-2 items-center"><span class="px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold">'+quotationKind(row.quote_no).toUpperCase()+'</span><b class="text-base">'+esc(row.quote_no+' · '+revisionLabel(rev.revision_no))+'</b></div>'+
      '<div class="mt-2 text-xs text-gray-700"><b>Customer:</b> '+esc(rev.customer_name||s.customerName||'Not entered')+(rev.customer_phone?' · '+esc(rev.customer_phone):'')+'</div>'+
      '<div class="mt-1 text-[10px] text-gray-500"><b>Salesperson:</b> '+esc(rev.salesperson||s.salesperson||'Not entered')+' · <b>Saved:</b> '+esc(fmtDate(rev.saved_at))+'</div>'+
      '<div class="mt-1 text-[10px] text-gray-400">This is a preserved snapshot and cannot be edited.</div></div>'+
      '<div><div class="flex items-center justify-between mb-2"><b class="text-sm">'+esc(revisionLabel(rev.revision_no))+' snapshot</b><span class="text-xs font-bold">'+money(rev.amount??s.total,'USD')+'</span></div>'+
      '<div class="rounded-xl border overflow-hidden"><div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 bg-gray-50 px-3 py-2 text-[9px] uppercase font-bold text-gray-400"><div>Item</div><div class="text-right">Qty</div><div class="text-right">Price</div><div class="text-right">Net</div></div><div class="px-3">'+(lines||'<div class="p-4 text-xs text-gray-400">No item snapshot available.</div>')+'</div></div><div class="mt-3">'+quoteDiscountSummaryHtml(s)+'</div></div>'+
      '<button type="button" onclick="reviewQuotationHistory(\''+quotationId+'\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Back to Current Quotation</button>'+
      '</div>'
    );
  };

  window.reviewQuotationHistory=async function(id){
    await loadOrderData();
    let r=await db.from(REGISTRY_TABLE).select('*').eq('id',id).single();
    if(r.error)return showToast(r.error.message,'err');
    let row=r.data;

    // Recover a revision that was saved in V4 before revision-history storage was enabled.
    // This is also a lightweight safety sync for the currently opened quotation.
    try{
      const latest=await jsonpRecord(row.source_record_id);
      if(latest&&await confirmRegistryRevision(row,latest)){
        r=await db.from(REGISTRY_TABLE).select('*').eq('id',id).single();
        if(!r.error)row=r.data;
      }
    }catch(err){
      console.warn('Could not refresh quotation revision from V4:',err?.message||err);
    }

    const [revisionsResult,imported]=await Promise.all([
      db.from(REVISION_TABLE).select('*').eq('quotation_id',id).order('revision_no',{ascending:false}),
      db.from(TABLE).select('id,status,converted_sales_order_id,converted_at,imported_at,source_saved_at,source_payload').eq('source_record_id',row.source_record_id).maybeSingle()
    ]);
    if(revisionsResult.error)return showToast(revisionsResult.error.message,'err');
    const revisions=revisionsResult.data||[];
    const importRow=imported.data||null;
    const linked=await linkedOrderMap(importRow?[importRow]:[]);
    const summary=quoteSummary(row);
    const lines=quotationSnapshotLines(summary);
    const currentRevision=Math.max(0,Number(row.current_revision)||quotationRevision(row.source_payload));
    const versionCount=revisions.length||1;

    openModal('Quotation History',
      '<div class="space-y-4">'+
      '<div class="rounded-xl border bg-gray-50 p-4"><div class="flex flex-wrap gap-2 items-center">'+historyStatus(importRow)+'<span class="px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold">'+quotationKind(row.quote_no).toUpperCase()+'</span><b class="text-base">'+esc(quotationDisplay(row.quote_no,row.source_payload))+'</b><span class="px-2 py-1 rounded-full bg-white border text-[10px] font-bold text-gray-600">'+versionCount+' version'+(versionCount===1?'':'s')+'</span></div>'+
      '<div class="mt-2 text-xs text-gray-700"><b>Customer:</b> '+esc(row.customer_name||summary.customerName||'Not entered')+(row.customer_phone?' · '+esc(row.customer_phone):'')+'</div>'+
      '<div class="mt-1 text-[10px] text-gray-500"><b>Salesperson:</b> '+esc(row.salesperson||summary.salesperson||'Not entered')+' · <b>Issue date:</b> '+esc(row.issue_date||'')+'</div>'+
      '<div class="mt-1 text-[10px] text-gray-400">Source ID: '+esc(row.source_record_id)+'</div></div>'+
      '<div class="rounded-xl border p-3"><div class="text-[10px] uppercase tracking-wide font-bold text-gray-400 mb-2">Revision History</div>'+revisionTimelineButtons(row.id,revisions,currentRevision)+'</div>'+
      '<div><div class="flex items-center justify-between mb-2"><b class="text-sm">Current quotation snapshot · '+esc(revisionLabel(currentRevision))+'</b><span class="text-xs font-bold">'+money(row.amount??summary.total,'USD')+'</span></div>'+
      '<div class="rounded-xl border overflow-hidden"><div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 bg-gray-50 px-3 py-2 text-[9px] uppercase font-bold text-gray-400"><div>Item</div><div class="text-right">Qty</div><div class="text-right">Price</div><div class="text-right">Net</div></div><div class="px-3">'+(lines||'<div class="p-4 text-xs text-gray-400">No item snapshot available.</div>')+'</div></div><div class="mt-3">'+quoteDiscountSummaryHtml(summary)+'</div></div>'+
      (importRow?'<div class="mb-3">'+linkedQuoteTimeline(importRow,linked.get(String(importRow.converted_sales_order_id)))+'</div>':'')+
      '<div class="flex flex-wrap gap-2">'+
      (importRow?'<button type="button" onclick="closeModal();reviewImportedQuotation(\''+importRow.id+'\')" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Open Imported Record</button>':'<button type="button" onclick="closeModal();importQuotationFromHistory(\''+esc(row.source_record_id)+'\')" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Import Latest to Sales Queue</button>')+
      (canDeleteImportedQuotation()?'<button type="button" onclick="closeModal();deleteQuotationHistory(\''+row.id+'\',\''+esc(row.source_record_id)+'\',\''+esc(row.quote_no)+'\')" class="px-4 py-2.5 rounded-xl border border-red-200 bg-white text-red-700 text-xs font-semibold">Delete Quotation</button>':'')+
      '</div></div>'
    );
  };
  window.deleteQuotationHistory=async function(id,sourceRecordId,quoteNo){
    if(!canDeleteImportedQuotation()){
      showToast('You do not have permission to delete quotations.','err');
      return;
    }

    const imported=await db.from(TABLE)
      .select('id,status,converted_sales_order_id')
      .eq('source_record_id',sourceRecordId)
      .maybeSingle();
    if(imported.error)return showToast(imported.error.message,'err');

    const importRow=imported.data||null;
    const warning=importRow?.status==='converted'
      ? 'Delete '+quoteNo+' from permanent quotation history?\n\nThe official Sales Order and converted import audit will remain.'
      : 'Delete '+quoteNo+' from permanent quotation history?\n\nThe V4 saved quotation will also be cleaned up if it still exists.';
    if(!window.confirm(warning))return;

    try{
      // Sales & Order Management owns this history record, so its deletion must
      // never depend on whether the old V4 / Google Sheets saved list still exists.
      if(importRow&&importRow.status!=='converted'){
        const q=await db.from(TABLE).delete().eq('id',importRow.id);
        if(q.error)throw q.error;
      }

      const r=await db.from(REGISTRY_TABLE).delete().eq('id',id).select('id');
      if(r.error)throw r.error;
      if(!r.data?.length)throw new Error('Delete was not permitted or the quotation no longer exists.');

      closeModal();
      showToast(quoteNo+' deleted from quotation history.');
      if(state.page==='quotation-imports')await renderImportedQuotations();

      // Best-effort V4 cleanup only. Do not block or show an error if the saved
      // list was already removed from Google Sheets/V4.
      Promise.resolve()
        .then(()=>jsonpMarkDelete(sourceRecordId))
        .catch(err=>console.warn('V4 quotation cleanup skipped:',err?.message||err));
    }catch(err){
      console.error('Quotation history deletion failed:',err);
      showToast(err.message||'Could not delete quotation history.','err');
    }
  };
  async function renderQuotationHistoryPage(){
    let [historyRows,imports]=await Promise.all([getRegistryRows(),getRows()]);

    // One lightweight V4 list sync keeps Quotation History current and also
    // recovers revisions that were saved before revision-history storage existed.
    try{
      if(await syncRegistryRevisionsFromV4(historyRows))historyRows=await getRegistryRows();
    }catch(err){
      console.warn('Quotation history V4 sync skipped:',err?.message||err);
    }

    let revisionMeta=[];
    if(historyRows.length){
      const rr=await db.from(REVISION_TABLE)
        .select('quotation_id,revision_no')
        .in('quotation_id',historyRows.map(x=>x.id));
      if(!rr.error)revisionMeta=rr.data||[];
    }
    const revisionCountByQuote=new Map();
    revisionMeta.forEach(x=>revisionCountByQuote.set(String(x.quotation_id),(revisionCountByQuote.get(String(x.quotation_id))||0)+1));

    const importBySource=new Map(imports.map(row=>[String(row.source_record_id||''),row]));
    const converted=historyRows.filter(row=>importBySource.get(String(row.source_record_id||''))?.status==='converted').length;
    const imported=historyRows.filter(row=>importBySource.has(String(row.source_record_id||''))).length;
    const canCreate=canCreateQuotations();
    const canDelete=canDeleteImportedQuotation();
    const orderById=await linkedOrderMap(imports);
    const html=historyRows.map(row=>{
      const importRow=importBySource.get(String(row.source_record_id||''))||null;
      const d=quoteSummary(row);
      return '<div class="card rounded-2xl p-4 border border-[#ece6dc]"><div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">'+
        '<div class="min-w-0"><div class="flex flex-wrap items-center gap-2">'+historyStatus(importRow)+'<span class="px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold">'+quotationKind(row.quote_no).toUpperCase()+'</span><div class="font-bold text-base">'+esc(quotationDisplay(row.quote_no,row.source_payload))+'</div><span class="px-2 py-1 rounded-full bg-gray-50 border text-[9px] font-bold text-gray-500">'+(revisionCountByQuote.get(String(row.id))||1)+' version'+((revisionCountByQuote.get(String(row.id))||1)===1?'':'s')+'</span></div>'+
        '<div class="text-xs text-gray-600 mt-2">'+esc(row.customer_name||'No customer name')+(row.customer_phone?' · '+esc(row.customer_phone):'')+'</div>'+
        '<div class="text-[10px] text-gray-400 mt-1">Issue '+esc(row.issue_date||'')+(row.salesperson?' · '+esc(row.salesperson):'')+' · '+money(row.amount||0,'USD')+'</div>'+
        '<div class="text-[10px] text-gray-400 mt-1">'+esc(row.source_name||'Saved quotation')+'</div>'+quoteListDetailsHtml(d)+
        (importRow?.status==='converted'?'<div class="text-[10px] mt-2 font-semibold text-green-700">Official '+esc(linkedOrderNo(orderById.get(String(importRow.converted_sales_order_id)))||'order linked')+
         ' · '+esc(revisionLabel(quotationRevision(importRow.source_payload)))+
         ' · '+esc(fmtDate(importRow.converted_at))+'</div>':'')+'</div>'+
        '<div class="flex flex-wrap gap-2 shrink-0"><button type="button" onclick="reviewQuotationHistory(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">View</button>'+
        (!importRow&&canCreate?'<button type="button" onclick="importQuotationFromHistory(\''+esc(row.source_record_id)+'\')" class="px-4 py-2.5 rounded-xl bg-[#17324d] text-white text-xs font-semibold">Import</button>':'')+
        (canDelete?'<button type="button" onclick="deleteQuotationHistory(\''+row.id+'\',\''+esc(row.source_record_id)+'\',\''+esc(row.quote_no)+'\')" class="px-4 py-2.5 rounded-xl border border-red-200 bg-white text-red-700 text-xs font-semibold">Delete</button>':'')+
        '</div></div></div>';
    }).join('');
    document.getElementById('content').innerHTML=
      '<div class="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-3"><div><h3 class="font-bold text-lg">Quotation History</h3><p class="text-xs text-gray-500 mt-1">Permanent V4 quotation register with preserved Original / Rev 1 / Rev 2 snapshots. S numbers are Showroom quotations; P numbers are Project quotations.</p></div><button onclick="refreshCurrentPage()" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Refresh</button></div>'+
      quotationTabs()+
      '<div class="grid grid-cols-3 gap-2 mb-5"><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Total Quotations</div><div class="text-xl font-bold mt-1">'+historyRows.length+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Imported</div><div class="text-xl font-bold mt-1">'+imported+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Converted</div><div class="text-xl font-bold mt-1">'+converted+'</div></div></div>'+
      '<div class="space-y-3">'+(html||'<div class="card rounded-2xl p-10 text-center text-sm text-gray-400">No permanent showroom quotations yet.</div>')+'</div>';
  }
  window.renderImportedQuotations=async function(){
    if(quotationSection==='history')return renderQuotationHistoryPage();
    if(quotationSection==='analytics')return renderQuotationAnalytics();
    await loadOrderData();
    const rows=await getRows();
    const ready=rows.filter(x=>x.status==='ready').length;
    const draft=rows.filter(x=>x.status==='imported_draft').length;
    const converted=rows.filter(x=>x.status==='converted').length;
    const canDelete=canDeleteImportedQuotation();
    const orderById=await linkedOrderMap(rows);
    const html=rows.map(row=>{
      const s=quoteSummary(row);
      const customer=(state.customers||[]).find(c=>String(c.id)===String(row.customer_id));
      const itemCount=s.lines.reduce((n,l)=>n+Number(l.qty||0),0);
      const sourceLabel=quotationDisplay(row.source_quote_no,s.sourceState)||row.source_name||row.source_record_id;
      return '<div class="card rounded-2xl p-4 border border-[#ece6dc]"><div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"><div class="min-w-0">'+
        '<div class="flex flex-wrap items-center gap-2">'+badge(row.status)+'<div class="font-bold text-base truncate">'+esc(sourceLabel)+'</div></div>'+
        '<div class="text-xs text-gray-500 mt-2">'+esc(s.customerName||'No customer name')+(s.customerPhone?' · '+esc(s.customerPhone):'')+'</div>'+
        '<div class="text-[10px] text-gray-400 mt-1">'+itemCount+' quoted item'+(itemCount===1?'':'s')+' · '+money(s.total,'USD')+' · Imported '+esc(fmtDate(row.imported_at))+'</div>'+
        quoteListDetailsHtml(s)+
        (row.status==='converted'?'<div class="text-[10px] mt-2 text-green-700 font-semibold">Linked order: '+esc(linkedOrderNo(orderById.get(String(row.converted_sales_order_id)))||'restricted')+
          ' · '+esc(revisionLabel(quotationRevision(row.source_payload)))+' · Converted '+esc(fmtDate(row.converted_at))+'</div>':'')+
        '<div class="text-[10px] mt-2 '+(customer?'text-green-700':'text-amber-700')+'">'+(customer?'Matched customer: <b>'+esc(customer.name)+'</b>':'No official CRM customer linked yet. The showroom details are reference only; select the customer manually before conversion.')+'</div></div>'+
        '<div class="flex gap-2 shrink-0"><button onclick="reviewImportedQuotation(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">'+(row.status==='converted'?'View':'Review / Convert')+'</button>'+
        (canDelete?'<button type="button" onclick="deleteImportedQuotation(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl border border-red-200 bg-white text-red-700 text-xs font-semibold hover:bg-red-50" title="Delete this imported record only">Delete</button>':'')+'</div></div></div>';
    }).join('');
    document.getElementById('content').innerHTML=
      '<div class="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-3"><div><h3 class="font-bold text-lg">Quotation Workflow</h3><p class="text-xs text-gray-500 mt-1">Review imported showroom quotations, link the official CRM customer, and convert them to TK/RK Sales Orders. Permanent issued quotations remain available under Quotation History.</p></div><button onclick="refreshCurrentPage()" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Refresh</button></div>'+
      quotationTabs()+
      '<div class="grid grid-cols-3 gap-2 mb-5"><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Customer Needed</div><div class="text-xl font-bold mt-1">'+draft+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Ready</div><div class="text-xl font-bold mt-1">'+ready+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Converted</div><div class="text-xl font-bold mt-1">'+converted+'</div></div></div>'+
      '<div class="space-y-3">'+(html||'<div class="card rounded-2xl p-10 text-center text-sm text-gray-400">No showroom quotations imported yet.</div>')+'</div>';
  };
  window.deleteImportedQuotation=async function(id){
    if(!canDeleteImportedQuotation()){
      showToast('You do not have permission to delete quotations.','err');
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
        ? 'Delete imported quotation "'+name+'"?\n\nThis removes the imported conversion record and its link to the official Sales Order. The official Sales Order and permanent Quotation History record are NOT deleted.'
        : 'Delete imported quotation "'+name+'"?\n\nThis removes it from the Imported Queue. The permanent Quotation History and showroom saved quotation are NOT deleted.';
      if(!window.confirm(message))return;
      const removed=await db.from(TABLE).delete().eq('id',id).select('id');
      if(removed.error)throw removed.error;
      if(!removed.data?.length)throw new Error('Delete was not permitted, or this imported quotation no longer exists.');
      closeModal();
      showToast('Imported queue record deleted. Permanent Quotation History, showroom quotation, and official Sales Orders remain unchanged.');
      if(state.page==='quotation-imports')await renderImportedQuotations();
    }catch(err){
      console.error('Imported quotation deletion failed:',err);
      showToast(err.message||'Could not delete imported quotation.','err');
    }finally{
      pendingDeletions.delete(id);
    }
  };

  function customerMatchesHtml(summary){
    const matches=candidateCustomers(summary);
    if(!matches.length)return '<p class="mt-2 text-xs text-gray-500">No matching CRM contact found in your permitted customer list. Choose manually or create a customer.</p>';
    return '<div class="rounded-xl border border-blue-200 bg-white p-3 mt-3"><b class="text-xs">Possible existing customers (suggestions only)</b>'+
      '<p class="text-[10px] text-gray-500 mt-1">Phone matches are preferred. Confirm the correct customer manually; this does not change salesperson ownership.</p>'+
      '<div class="grid gap-2 mt-2">'+matches.map(x=>
        '<div class="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-2">'+
          '<div class="text-xs"><b>'+esc(x.customer.name)+'</b>'+
          (x.customer.phone?' · '+esc(x.customer.phone):'')+
          '<div class="text-[10px] text-blue-800">'+x.label+'</div></div>'+
          '<button type="button" class="rounded-lg border px-3 py-1.5 text-xs font-semibold" onclick="chooseQuoteCustomerSuggestion(\''+esc(x.customer.id)+'\')">Select match</button></div>'
      ).join('')+'</div></div>';
  }
  window.chooseQuoteCustomerSuggestion=function(id){
    const select=document.getElementById('importQuoteCustomer');
    if(!select)return;
    const customer=(state.customers||[]).find(c=>String(c.id)===String(id));
    if(!customer)return showToast('This customer is not in your permitted CRM list.','err');
    select.value=String(customer.id);
    const hint=document.getElementById('quoteCustomerConfirmation');
    if(hint)hint.textContent='Selected '+customer.name+'. Click Link Official Customer to confirm. Sales ownership is unchanged.';
  };
  function quotationRevisionNoticeHtml(row,notice){
    if(row.status==='converted')return '<p class="text-[11px] text-gray-500 mt-2">Converted using the preserved Showroom quotation snapshot. Later Showroom revisions will not modify this order.</p>';
    if(notice?.changed)return '<div class="rounded-xl border border-amber-400 bg-amber-50 p-3 text-xs text-amber-950"><b>Newer / changed Showroom quotation detected</b>'+
      '<p class="mt-1">Imported snapshot: '+esc(revisionLabel(notice.oldRev))+' · Latest saved: '+esc(revisionLabel(notice.newerRev))+
      '. Prices, notes, items or quotation terms may have changed. The imported snapshot has NOT been overwritten.</p>'+
      '<button type="button" class="mt-2 px-3 py-2 rounded-lg bg-[#211d18] text-white font-semibold" onclick="refreshImportedQuotation(\''+esc(row.id)+'\')">Update to Latest Revision</button></div>';
    if(notice?.unchecked)return '<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"><b>Revision not verified.</b> '+esc(notice.reason||'Check your Showroom connection.')+
      '<button type="button" class="block mt-2 underline font-semibold" onclick="reviewImportedQuotation(\''+esc(row.id)+'\')">Retry check</button></div>';
    return '<p class="text-[11px] text-green-700">Saved Showroom revision verified · '+esc(revisionLabel(notice?.oldRev))+'</p>';
  }
  function customerOptions(selectedId){
    return '<option value="">-- Select existing customer --</option>'+(state.customers||[]).map(c=>'<option value="'+esc(c.id)+'" '+(String(c.id)===String(selectedId||'')?'selected':'')+'>'+esc(c.name)+(c.phone?' · '+esc(c.phone):'')+'</option>').join('');
  }
  window.reviewImportedQuotation=async function(id){
    await loadOrderData();
    const r=await db.from(TABLE).select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');
    const row=r.data;
    // Do not silently update this imported snapshot during review. The staff
    // must explicitly accept a new Showroom revision before any conversion.
    let latestNotice={changed:false,oldRev:quotationRevision(row.source_payload)};
    if(row.status!=='converted'){
      try{latestNotice=await verifyQuotationSnapshot(row)}
      catch(err){latestNotice={changed:false,unchecked:true,reason:err.message||String(err)}}
    }
    const s=quoteSummary(row);
    const canCreate=canCreateQuotations();
    const canConvert=canConvertQuotations();
    const canDelete=canDeleteImportedQuotation();
    const linked=(state.customers||[]).find(c=>String(c.id)===String(row.customer_id));
    let convertedOrderNo='';
    if(row.converted_sales_order_id){
      const linkedOrder=await db.from('sales_orders').select('order_no,sr_no,invoice_no,sales_rep_name_snapshot').eq('id',row.converted_sales_order_id).maybeSingle();
      if(!linkedOrder.error)convertedOrderNo=linkedOrderNo(linkedOrder.data);
    }
    const lines=quotationSnapshotLines(s);
    openModal('Imported Quotation',
      '<div class="space-y-5"><div class="rounded-xl border bg-gray-50 p-4"><div class="flex flex-wrap items-center gap-2">'+badge(row.status)+'<span class="px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold">'+quotationKind(row.source_quote_no).toUpperCase()+'</span><b>'+esc(quotationDisplay(row.source_quote_no,s.sourceState)||row.source_name||row.source_record_id)+'</b></div>'+
      '<div class="mt-3 text-[10px] uppercase tracking-wide font-bold text-gray-400">Showroom information · reference only</div>'+
      '<div class="text-xs text-gray-700 mt-1"><b>Entered customer:</b> '+esc(s.customerName||'Not entered')+(s.customerPhone?' · '+esc(s.customerPhone):'')+'</div>'+
      (s.customerAddress?'<div class="text-[10px] text-gray-500 mt-1"><b>Entered address:</b> '+esc(s.customerAddress)+'</div>':'')+
      (s.salesperson?'<div class="text-[10px] text-gray-500 mt-1"><b>Showroom salesperson text:</b> '+esc(s.salesperson)+' · reference only, does not assign ownership</div>':'')+
      (row.converted_sales_order_id?'<div class="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[10px] text-green-800">Converted to official Sales Order'+(convertedOrderNo?' <b>'+esc(convertedOrderNo)+'</b>':'')+'.'+(convertedOrderNo?' <button type="button" onclick="closeModal();openDashboardSalesOrder(\''+row.converted_sales_order_id+'\')" class="underline font-semibold ml-1">Open order</button>':'')+'</div>':'')+
      '<div class="text-[9px] text-gray-400 mt-2">Source ID: '+esc(row.source_record_id)+'</div></div>'+
      (row.status==='converted'?linkedQuoteTimeline(row,convertedOrderNo?{id:row.converted_sales_order_id,order_no:convertedOrderNo}:null):'')+
      quotationRevisionNoticeHtml(row,latestNotice)+
      '<div><div class="flex items-center justify-between mb-2"><b class="text-sm">Quoted items</b><span class="text-xs font-bold">'+money(s.total,'USD')+'</span></div>'+
      '<div class="rounded-xl border overflow-hidden"><div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 bg-gray-50 px-3 py-2 text-[9px] uppercase font-bold text-gray-400"><div>Item</div><div class="text-right">Qty</div><div class="text-right">Price</div><div class="text-right">Net</div></div><div class="px-3">'+(lines||'<div class="p-4 text-xs text-gray-400">No items in this quotation.</div>')+'</div></div><div class="mt-3">'+quoteDiscountSummaryHtml(s)+'</div></div>'+
      '<div class="rounded-xl border border-blue-100 bg-blue-50/30 p-4"><div class="text-[10px] uppercase tracking-wide font-bold text-blue-700">Official Customer · CRM</div><label class="text-xs font-semibold block mt-2">Select the official customer manually</label><select id="importQuoteCustomer" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">'+customerOptions(row.customer_id)+'</select>'+
      '<div class="text-[10px] mt-2 '+(linked?'text-green-700':'text-amber-700')+'">'+(linked?'Official CRM customer: <b>'+esc(linked.name)+'</b>.':'No official customer linked. We do not automatically assign customers from Showroom information.')+'</div>'+
      '<p id="quoteCustomerConfirmation" class="text-[10px] mt-1 text-blue-800"></p>'+
      ((!linked&&row.status!=='converted')?customerMatchesHtml(s):'')+
      '<div class="text-[10px] text-gray-500 mt-1">If the customer does not exist yet, create/link the customer in the normal Customer workflow, then return here and select it.</div>'+
      '<div class="flex flex-wrap gap-2 mt-3"><button '+(!canCreate?'disabled':'')+' onclick="saveImportedQuotationCustomer(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl text-xs font-semibold '+(!canCreate?'bg-gray-200 text-gray-400 cursor-not-allowed':'bg-[#17324d] text-white')+'">'+(canCreate?'Link Official Customer':'View Only')+'</button><button onclick="closeModal();go(\'customers\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Create / Find Customer</button></div></div>'+
      '<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>Official Sales Order rule:</b> choose SR (pre-order), TK or RK (stock sale), then confirm the official number. Existing discount, product, stock, payment, DO, approval and role validations still apply.</div>'+
      (row.status==='converted'?'':'<div class="rounded-xl border bg-white p-3">'+
       '<label class="block text-xs font-semibold mb-1" for="quoteConversionDocument">Create official document as</label>'+
       '<select id="quoteConversionDocument" class="w-full border rounded-lg px-3 py-2 text-sm bg-white">'+
         '<option value="TK">TK — Stock Sale</option><option value="RK">RK — Stock Sale</option><option value="SR">SR — Pre-order</option>'+
       '</select><p class="text-[10px] text-gray-500 mt-1">Select the actual transaction type. This choice does not turn a quotation into confirmed revenue automatically.</p></div>')+
      (!canCreate?'<div class="rounded-xl border bg-gray-50 p-3 text-xs text-gray-600">Your current role can view quotations but cannot create or import them.</div>':(!canConvert?'<div class="rounded-xl border bg-gray-50 p-3 text-xs text-gray-600">Quotation access is enabled, but Create Sales Orders permission is also required for TK/RK conversion.</div>':''))+
      '<button '+(!canConvert||!row.customer_id||row.status==='converted'||latestNotice.changed||latestNotice.unchecked?'disabled':'')+' onclick="convertImportedQuotation(\''+row.id+'\')" class="w-full rounded-xl py-3 font-semibold '+(!canConvert||!row.customer_id||row.status==='converted'||latestNotice.changed||latestNotice.unchecked?'bg-gray-200 text-gray-400 cursor-not-allowed':'bg-[#211d18] text-white')+'">'+(row.status==='converted'?'Already Converted':(latestNotice.changed?'Update Revision First':latestNotice.unchecked?'Verify Revision First':(!canConvert?'View Only':'Review & Convert to Official Order')))+'</button>'+
      (canDelete?'<button type="button" onclick="deleteImportedQuotation(\''+row.id+'\')" class="w-full rounded-xl border border-red-200 bg-white py-2.5 text-red-700 text-xs font-semibold">Delete Imported Quotation</button>':'')+'</div>'
    );
  };
  window.saveImportedQuotationCustomer=async function(id){
    if(!canCreateQuotations())return showToast('Your role cannot create or import quotations.','err');
    const customerId=document.getElementById('importQuoteCustomer')?.value||null;
    if(!customerId)return showToast('Select the official CRM customer first. If the customer does not exist, create/link it in Customers and then return here.','err');
    if(!(state.customers||[]).some(c=>String(c.id)===String(customerId)))
      return showToast('Select a customer from your permitted CRM list.','err');
    const r=await db.from(TABLE).update({customer_id:customerId,status:'ready',updated_at:new Date().toISOString()}).eq('id',id).select().single();
    if(r.error)return showToast(r.error.message,'err');
    showToast('Official CRM customer linked. This quotation is ready for conversion.');await reviewImportedQuotation(id);
  };
  function addImportedItemNoteField(row,line){
    const value=sourceItemNoteForOrder(line);
    if(!value||!row)return;
    const wrap=document.createElement('div');
    wrap.className='md:col-span-12 rounded-lg border border-blue-100 bg-blue-50/40 p-2.5';
    wrap.innerHTML='<label class="text-[10px] font-semibold text-blue-800">Showroom item note / floor / room (editable for the official order)</label>'+
      '<textarea class="source-quote-item-note mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs" rows="2" maxlength="2000" placeholder="Note for this item"></textarea>';
    wrap.querySelector('textarea').value=value;
    row.appendChild(wrap);
  }
  function fillProductRow(row,line,product){
    row.dataset.sourceQuoteKey=String(line.key);
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
    addImportedItemNoteField(row,line);
  }
  function fillServiceRow(row,line){
    row.dataset.sourceQuoteKey=String(line.key);
    const name=line.name||'Service Fee';const sel=row.querySelector('.service-fee-type');
    if(sel){sel.value=['Service Fee','Maintenance Fee','Cleaning Fee','Delivery / Installation','Other Fee'].includes(name)?name:'Other Fee';if(typeof serviceFeeChanged==='function')serviceFeeChanged(sel)}
    const nameInput=row.querySelector('.service-name');if(nameInput){nameInput.value=name;if(typeof serviceFeeNameChanged==='function')serviceFeeNameChanged(nameInput)}
    row.querySelector('.qty').value=String(line.qty);row.querySelector('.unit-price').value=String(line.unitPrice);row.querySelector('.line-discount').value=String(line.discountAmount);row.dataset.discountBasis='amount';
    addImportedItemNoteField(row,line);
  }
  function liveQuotationComparison(s,form){
    const base=new Map(s.lines.map(l=>[String(l.key),l]));
    const used=new Set(),changes=[],items=[];
    let afterLineDiscounts=0,changed=false;
    const currentRows=[...form.querySelectorAll('#orderItems .order-item-row')];
    currentRows.forEach((row,index)=>{
      const key=String(row.dataset.sourceQuoteKey||'');
      const old=base.get(key);
      if(old)used.add(key);
      const val=sel=>num(row.querySelector(sel)?.value||0);
      const itemCode=String(row.querySelector('.product-code')?.value||'').trim();
      const qty=val('.qty'),unitPrice=val('.unit-price'),discountAmount=val('.line-discount');
      const note=String(row.querySelector('.source-quote-item-note')?.value||'').trim();
      const name=String(row.querySelector('.product-name')?.value||'').trim();
      const kind=row.querySelector('.line-kind')?.value||'product';
      afterLineDiscounts+=round2(Math.max(qty*unitPrice-discountAmount,0));
      const diff=[];
      if(!old)diff.push('Added to order');
      else {
        if(itemCode!==old.code||kind!==old.kind)diff.push('Item/code changed');
        if(Math.abs(qty-old.qty)>0.0001)diff.push('Qty '+old.qty+' → '+qty);
        if(Math.abs(unitPrice-old.unitPrice)>0.001)diff.push('Unit '+money(old.unitPrice,'USD')+' → '+money(unitPrice,'USD'));
        if(Math.abs(discountAmount-old.discountAmount)>0.001)diff.push('Discount '+money(old.discountAmount,'USD')+' → '+money(discountAmount,'USD'));
        const oldNote=sourceItemNoteForOrder(old);
        if(note!==oldNote)diff.push('Item note / floor / room changed');
      }
      if(diff.length)changed=true;
      changes.push({key:key||'new-'+index,code:itemCode||name||'New line',old:old||null,
        qty,unitPrice,discountAmount,note,diff});
    });
    s.lines.forEach(l=>{
      if(!used.has(String(l.key))){
        changed=true;changes.push({key:l.key,code:l.code||l.name,old:l,diff:['Removed from order']});
      }
    });
    const orderDiscount=Math.max(0,num(form.querySelector('#orderDiscount')?.value||0));
    const newTotal=round2(Math.max(afterLineDiscounts-orderDiscount,0));
    if(Math.abs(orderDiscount-s.orderDiscount)>0.001){
      changed=true;
      items.push('Quotation-level discount '+money(s.orderDiscount,'USD')+' → '+money(orderDiscount,'USD'));
    }
    if(Math.abs(newTotal-s.total)>0.001)changed=true;
    const signature=JSON.stringify({changes:changes.map(x=>[x.key,x.code,x.qty,x.unitPrice,x.discountAmount,x.note,x.diff]),
      orderDiscount,newTotal});
    return {changes,items,changed,signature,newTotal,orderDiscount};
  }
  function quoteComparisonPanelHtml(s,comparison){
    const changedRows=comparison.changes.filter(x=>x.diff.length);
    return '<section class="rounded-2xl border border-[#e5d8c5] bg-white p-4 space-y-3" id="quoteSourceComparison">'+
      '<div class="flex flex-wrap justify-between items-start gap-3"><div><b class="text-sm">Quotation ↔ Official Order Comparison</b>'+
      '<p class="text-xs text-gray-500 mt-1">Original '+esc(quotationDisplay(s.quoteNo,s.sourceState))+' is preserved. Review differences before saving.</p></div>'+
      '<span class="rounded-lg px-2.5 py-1.5 text-xs font-semibold '+(comparison.changed?'bg-amber-100 text-amber-900':'bg-green-50 text-green-800')+'">'+
       (comparison.changed?changedRows.length+' item changes · Check before saving':'No differences detected')+'</span></div>'+
      '<div class="grid grid-cols-2 gap-3">'+
       '<div class="rounded-lg bg-gray-50 p-3"><div class="text-[10px] text-gray-500">Saved Showroom quotation</div>'+
        '<b class="text-lg">'+money(s.total,'USD')+'</b><div class="text-[10px] text-gray-500">Item discount '+money(s.lineDiscounts,'USD')+' · Extra '+money(s.orderDiscount,'USD')+'</div></div>'+
       '<div class="rounded-lg bg-blue-50 p-3"><div class="text-[10px] text-blue-700">Proposed official order</div>'+
        '<b class="text-lg">'+money(comparison.newTotal,'USD')+'</b>'+
        '<div class="text-[10px] '+(comparison.newTotal<s.total?'text-amber-800':'text-gray-600')+'">Difference: '+(comparison.newTotal>=s.total?'+':'−')+money(Math.abs(round2(comparison.newTotal-s.total)),'USD')+'</div></div></div>'+
      (comparison.items.length?'<div class="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">'+comparison.items.map(esc).join(' · ')+'</div>':'')+
      (changedRows.length?'<div class="space-y-2 max-h-64 overflow-y-auto">'+changedRows.map(x=>
         '<div class="rounded-lg border border-amber-200 p-2 text-xs"><b>'+esc(x.code)+'</b>'+
          '<p class="text-amber-800 mt-1">'+x.diff.map(esc).join(' · ')+'</p>'+
          (x.old&&x.diff.includes('Item note / floor / room changed')?'<div class="text-gray-500 mt-1">From: '+esc(sourceItemNoteForOrder(x.old)||'None')+'<div>To: '+esc(x.note||'None')+'</div></div>':'')+
         '</div>').join('')+'</div>':
       '<p class="text-xs text-green-700">All quoted items, quantities, prices, discounts and notes match the proposed order.</p>')+
      (comparison.changed?'<label class="flex gap-2 items-start border-t pt-3 text-xs font-semibold text-amber-900">'+
       '<input type="checkbox" id="quoteDifferencesAcknowledged" class="mt-0.5">'+
       '<span>I have reviewed these changes and will follow existing discount / order approval rules. This is an acknowledgement, not management approval.</span></label>':'')+
      '</section>';
  }
  function renderQuoteConversionComparison(){
    const form=document.getElementById('orderForm');
    const holder=document.getElementById('quoteConversionComparison');
    const ctx=activeConversionSnapshot;
    if(!form||!holder||!ctx)return;
    const cmp=liveQuotationComparison(ctx.summary,form);
    const previouslyChecked=!!holder.querySelector('#quoteDifferencesAcknowledged')?.checked;
    const same=holder.dataset.quoteDiffSignature===cmp.signature;
    holder.innerHTML=quoteComparisonPanelHtml(ctx.summary,cmp);
    holder.dataset.quoteDiffSignature=cmp.signature;
    if(cmp.changed&&same&&previouslyChecked){
      const el=holder.querySelector('#quoteDifferencesAcknowledged');if(el)el.checked=true;
    }
  }
  async function checkQuotedSourceBeforeSave(ctx){
    const current=await db.from(TABLE).select('id,status,customer_id,source_payload').eq('id',ctx.id).single();
    if(current.error)throw current.error;
    if(current.data.status==='converted')throw Error('This quotation was already converted. Open its linked Sales Order instead.');
    if(String(current.data.customer_id||'')!==String(ctx.customerId||''))
      throw Error('The linked CRM customer was changed. Reopen the quotation to review the customer.');
    if(quotationBusinessSignature(current.data)!==ctx.signature)
      throw Error('This imported quotation changed while you were preparing the order. Reopen it and compare the new revision.');
    const latest=await verifyQuotationSnapshot(current.data);
    if(latest.changed||latest.unchecked)
      throw Error('Showroom has a newer or changed quotation. Update and review the latest revision before creating an official order.');
  }
  window.convertImportedQuotation=async function(id){
    if(!canCreateQuotations())return showToast('Your role cannot create or import quotations.','err');
    if(!canConvertQuotations())return showToast('Create Sales Orders permission is required to convert a quotation.','err');
    const chosenDocument=document.getElementById('quoteConversionDocument')?.value||'TK';
    if(!['SR','TK','RK'].includes(chosenDocument))return showToast('Choose SR, TK or RK.','err');
    await loadOrderData();
    const r=await db.from(TABLE).select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');
    const draft=r.data;
    if(draft.status==='converted')return showToast('This quotation has already been converted. Open its linked order.','err');
    // Never auto-refresh on conversion: staff must see and accept newer versions.
    try{
      const status=await verifyQuotationSnapshot(draft);
      if(status.changed||status.unchecked){
        showToast('Showroom quotation changed. Open Review and select Update to Latest Revision before conversion.','err');
        await window.reviewImportedQuotation(id);
        return;
      }
    }catch(err){
      return showToast('Cannot verify the current Showroom revision: '+(err.message||err),'err');
    }
    if(!draft.customer_id)return showToast('Link an existing customer before converting this quotation.','err');
    const customer=(state.customers||[]).find(c=>String(c.id)===String(draft.customer_id));
    if(!customer)return showToast('The linked customer is not available to your account. Create/link or request access first.','err');
    const s=quoteSummary(draft);closeModal();await openNewOrder();
    const form=document.getElementById('orderForm');if(!form)return showToast('Could not open the Sales Order form.','err');
    const select=document.getElementById('orderCustomer');
    if(select){select.value=customer.id;select.dispatchEvent(new Event('change',{bubbles:true}))}
    const search=document.getElementById('orderCustomerSearch');if(search){search.value=customer.name||'';search.dataset.customerId=customer.id}
    const flow=document.getElementById('salesFlowType');
    if(flow){flow.value=chosenDocument==='SR'?'pre_order':'stock_sale';flow.dispatchEvent(new Event('change',{bubbles:true}))}
    const invoice=document.getElementById('salesInvoiceType');
    if(invoice&&chosenDocument!=='SR')invoice.value=chosenDocument;
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
    activeConversionSnapshot={
      id,customerId:draft.customer_id,signature:quotationBusinessSignature(draft),
      summary:s,chosenDocument,sourceRevision:quotationRevision(draft.source_payload)
    };
    const submitButton=document.getElementById('saveSalesOrderSubmit');
    const holder=document.createElement('div');
    holder.id='quoteConversionComparison';
    if(submitButton)submitButton.before(holder);else form.appendChild(holder);
    renderQuoteConversionComparison();
    form.addEventListener('input',event=>{
      if(event.target?.id!=='quoteDifferencesAcknowledged')renderQuoteConversionComparison();
    });
    form.addEventListener('change',event=>{
      if(event.target?.id!=='quoteDifferencesAcknowledged')renderQuoteConversionComparison();
    });
    // Covers add/remove rows by the existing buttons without changing
    // the normal Sales Order form or stock/DO validation.
    form.addEventListener('click',event=>{
      if(event.target?.closest('button'))setTimeout(renderQuoteConversionComparison,0);
    });
    const normalSave=form.onsubmit;
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      event.stopImmediatePropagation();
      if(conversionSaving)return;
      if(!activeConversionSnapshot||activeConversionId!==id)
        return showToast('Quotation conversion context expired. Reopen the quotation.','err');
      renderQuoteConversionComparison();
      const comparison=liveQuotationComparison(activeConversionSnapshot.summary,form);
      if(comparison.changed&&!form.querySelector('#quoteDifferencesAcknowledged')?.checked)
        return showToast('Review and acknowledge the changes from the saved Showroom quotation before saving.','err');
      conversionSaving=true;
      try{
        await checkQuotedSourceBeforeSave(activeConversionSnapshot);
        if(typeof normalSave!=='function')throw Error('Sales Order save action unavailable. Reopen the order form.');
        // Existing saveOrder retains all SR/TK/RK, discount, payment, DO,
        // duplicate number and permission validations.
        await normalSave.call(form,event);
      }catch(err){showToast(err.message||'Cannot save quotation conversion.','err')}
      finally{conversionSaving=false}
    },true);
    const title=document.getElementById('modalTitle');if(title)title.textContent='Convert Quotation → Official '+chosenDocument;
    const hint=document.getElementById('salesFlowHint');
    if(hint)hint.innerHTML='<b>Imported quotation '+esc(revisionLabel(quotationRevision(draft.source_payload)))+':</b> review all lines and enter the official <b>'+esc(chosenDocument)+'</b> number. '+(unmatched?'<span class="text-red-700"><b>'+unmatched+' product line'+(unmatched===1?' is':'s are')+' not matched yet.</b> Select the matching catalog product before saving.</span>':'All product codes matched the current catalog.');
    if(doc)doc.focus();
  };

  const baseCloseModal=window.closeModal;
  if(typeof baseCloseModal==='function'){
    window.closeModal=function(){
      // If a quotation conversion form is abandoned, clear its context so a later
      // unrelated Sales Order can never mark the old quotation as converted.
      if(activeConversionId && document.getElementById('orderForm')){activeConversionId=null;activeConversionSnapshot=null;}
      return baseCloseModal.apply(this,arguments);
    };
  }

  const previousAfterCreate=window.afterSalesOrderCreated;
  window.afterSalesOrderCreated=async function(so,meta){
    if(typeof previousAfterCreate==='function')await previousAfterCreate(so,meta);
    if(!activeConversionId)return;
    const id=activeConversionId;activeConversionId=null;activeConversionSnapshot=null;
    const r=await db.from(TABLE).update({status:'converted',converted_sales_order_id:so.id,converted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);
    if(r.error)throw r.error;
  };

  const oldNavItems=window.navItems;
  if(typeof oldNavItems==='function'){
    window.navItems=function(){
      const items=oldNavItems.apply(this,arguments)||[];
      const allowed=canViewQuotations();
      if(!allowed||items.some(x=>x[0]==='quotation-imports'))return items;
      const out=[];items.forEach(item=>{out.push(item);if(item[0]==='sales-orders')out.push(['quotation-imports','Quotations','⇢'])});return out;
    };
  }
  const oldGo=window.go;
  if(typeof oldGo==='function'){
    window.go=async function(page){
      if(page!=='quotation-imports')return oldGo.apply(this,arguments);
      if(!canViewQuotations()){showToast('You do not have access to Quotations.','err');return oldGo('dashboard')}
      state.page=page;renderNav();
      // Normal navigation always opens the permanent Quotation History first.
      // A V4 handoff keeps Imported Queue active so the newly imported quote can be reviewed.
      if(!handoffBusy)quotationSection='history';
      document.getElementById('pageTitle').textContent='Quotations';
      document.getElementById('pageSubtitle').textContent='Showroom quotation history, SR/TK/RK conversion and conversion analytics';
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
      if(!canCreateQuotations())throw new Error('You do not have permission to create or import quotations.');
      const row=await importSavedRecord(recordId);
      quotationSection='imports';
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
