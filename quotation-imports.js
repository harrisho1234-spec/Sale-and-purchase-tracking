// Showroom quotation import staging + conversion workflow.
// Imports only after authenticated login, then reuses the existing Sales Order form/validation.
(function(){
  const SOURCE_SYSTEM='limperial-showroom';
  const SOURCE_API='https://script.google.com/macros/s/AKfycbwAah-oFIyiSON0jOhjWlL1lzlr0d354bq-1OxMDY2Qz-D-rzAYFaPzTkKDNlnfz1tk/exec';
  const TABLE='showroom_quotation_imports';
  let handoffBusy=false;
  let activeConversionId=null;

  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
  function num(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}
  function clampPct(v){return Math.max(0,Math.min(100,num(v,0)))}
  function normalizePhone(v){return String(v||'').replace(/\D/g,'')}
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
  function findCustomer(summary){
    const customers=state.customers||[];const phone=normalizePhone(summary.customerPhone);
    if(phone){const exact=customers.filter(c=>normalizePhone(c.phone)===phone);if(exact.length===1)return exact[0]}
    const name=lower(summary.customerName);
    if(name){const exact=customers.filter(c=>lower(c.name)===name);if(exact.length===1)return exact[0]}
    return null;
  }
  async function importSavedRecord(recordId){
    const id=String(recordId||'').trim();if(!id)throw new Error('Missing showroom quotation ID.');
    const existing=await db.from(TABLE).select('*').eq('source_system',SOURCE_SYSTEM).eq('source_record_id',id).maybeSingle();
    if(existing.error)throw existing.error;
    if(existing.data)return existing.data;
    const record=await jsonpRecord(id);if(!record)throw new Error('The saved showroom quotation could not be found.');
    const sourceState=parseState(record);const summary=quoteSummary(record);
    await loadOrderData();const customer=findCustomer(summary);
    const row={
      source_system:SOURCE_SYSTEM,source_record_id:id,source_name:String(record.name||'Saved quotation').trim(),
      source_saved_at:record.savedAt||null,source_document_type:String(sourceState.documentType||'quotation'),
      source_quote_no:summary.quoteNo||null,source_salesperson:summary.salesperson||null,source_payload:sourceState,
      customer_name:summary.customerName||null,customer_phone:summary.customerPhone||null,
      customer_address:summary.customerAddress||null,customer_id:customer?.id||null,
      status:customer?'ready':'imported_draft',imported_by:state.user.id
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
  window.renderImportedQuotations=async function(){
    await loadOrderData();
    const rows=await getRows();
    const ready=rows.filter(x=>x.status==='ready').length;
    const draft=rows.filter(x=>x.status==='imported_draft').length;
    const converted=rows.filter(x=>x.status==='converted').length;
    const html=rows.map(row=>{
      const s=quoteSummary(row);
      const customer=(state.customers||[]).find(c=>String(c.id)===String(row.customer_id));
      const itemCount=s.lines.reduce((n,l)=>n+Number(l.qty||0),0);
      const sourceLabel=row.source_quote_no||row.source_name||row.source_record_id;
      return '<div class="card rounded-2xl p-4 border border-[#ece6dc]"><div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"><div class="min-w-0">'+
        '<div class="flex flex-wrap items-center gap-2">'+badge(row.status)+'<div class="font-bold text-base truncate">'+esc(sourceLabel)+'</div></div>'+
        '<div class="text-xs text-gray-500 mt-2">'+esc(s.customerName||'No customer name')+(s.customerPhone?' · '+esc(s.customerPhone):'')+'</div>'+
        '<div class="text-[10px] text-gray-400 mt-1">'+itemCount+' quoted item'+(itemCount===1?'':'s')+' · '+money(s.total,'USD')+' · Imported '+esc(fmtDate(row.imported_at))+'</div>'+
        '<div class="text-[10px] mt-2 '+(customer?'text-green-700':'text-amber-700')+'">'+(customer?'Matched customer: <b>'+esc(customer.name)+'</b>':'No existing customer linked yet. Create/link the customer before conversion.')+'</div></div>'+
        '<div class="flex gap-2 shrink-0"><button onclick="reviewImportedQuotation(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">'+(row.status==='converted'?'View':'Review / Convert')+'</button></div></div></div>';
    }).join('');
    document.getElementById('content').innerHTML=
      '<div class="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-5"><div><h3 class="font-bold text-lg">Imported Quotations</h3><p class="text-xs text-gray-500 mt-1">Saved quotations from limperial-showroom stay as drafts here until customer matching and the official TK/RK Sales Order are completed.</p></div><button onclick="refreshCurrentPage()" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Refresh</button></div>'+
      '<div class="grid grid-cols-3 gap-2 mb-5"><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Customer Needed</div><div class="text-xl font-bold mt-1">'+draft+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Ready</div><div class="text-xl font-bold mt-1">'+ready+'</div></div><div class="card rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Converted</div><div class="text-xl font-bold mt-1">'+converted+'</div></div></div>'+
      '<div class="space-y-3">'+(html||'<div class="card rounded-2xl p-10 text-center text-sm text-gray-400">No showroom quotations imported yet.</div>')+'</div>';
  };
  function customerOptions(selectedId){
    return '<option value="">-- Select existing customer --</option>'+(state.customers||[]).map(c=>'<option value="'+esc(c.id)+'" '+(String(c.id)===String(selectedId||'')?'selected':'')+'>'+esc(c.name)+(c.phone?' · '+esc(c.phone):'')+'</option>').join('');
  }
  window.reviewImportedQuotation=async function(id){
    await loadOrderData();
    const r=await db.from(TABLE).select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');
    const row=r.data;const s=quoteSummary(row);
    const linked=(state.customers||[]).find(c=>String(c.id)===String(row.customer_id));
    const lines=s.lines.map((l,i)=>'<div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 items-center py-2 border-b last:border-b-0"><div class="min-w-0"><div class="text-xs font-semibold truncate">'+esc(l.code||l.name||('Line '+(i+1)))+'</div><div class="text-[10px] text-gray-500 truncate">'+esc(l.name||'')+(l.sourceSetName?' · Set: '+esc(l.sourceSetName):'')+'</div></div><div class="text-xs text-right">'+l.qty+'</div><div class="text-xs text-right">'+money(l.unitPrice,'USD')+'</div><div class="text-xs text-right">'+money(Math.max(l.qty*l.unitPrice-l.discountAmount,0),'USD')+'</div></div>').join('');
    openModal('Imported Quotation',
      '<div class="space-y-5"><div class="rounded-xl border bg-gray-50 p-4"><div class="flex flex-wrap items-center gap-2">'+badge(row.status)+'<b>'+esc(row.source_quote_no||row.source_name||row.source_record_id)+'</b></div>'+
      '<div class="text-xs text-gray-600 mt-2">'+esc(s.customerName||'No customer')+(s.customerPhone?' · '+esc(s.customerPhone):'')+'</div>'+
      (s.customerAddress?'<div class="text-[10px] text-gray-400 mt-1">'+esc(s.customerAddress)+'</div>':'')+
      (s.salesperson?'<div class="text-[10px] text-gray-400 mt-1">Showroom salesperson: '+esc(s.salesperson)+'</div>':'')+'</div>'+
      '<div><div class="flex items-center justify-between mb-2"><b class="text-sm">Quoted items</b><span class="text-xs font-bold">'+money(s.total,'USD')+'</span></div>'+
      '<div class="rounded-xl border overflow-hidden"><div class="grid grid-cols-[1fr_70px_95px_95px] gap-2 bg-gray-50 px-3 py-2 text-[9px] uppercase font-bold text-gray-400"><div>Item</div><div class="text-right">Qty</div><div class="text-right">Price</div><div class="text-right">Net</div></div><div class="px-3">'+(lines||'<div class="p-4 text-xs text-gray-400">No items in this quotation.</div>')+'</div></div>'+
      (s.orderDiscount>0?'<div class="text-[10px] text-right text-gray-500 mt-2">Quotation-level discount carried to Sales Order: '+money(s.orderDiscount,'USD')+'</div>':'')+'</div>'+
      '<div class="rounded-xl border p-4"><label class="text-xs font-semibold">Existing Customer</label><select id="importQuoteCustomer" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">'+customerOptions(row.customer_id)+'</select>'+
      '<div class="text-[10px] mt-2 '+(linked?'text-green-700':'text-amber-700')+'">'+(linked?'Linked to '+esc(linked.name)+'.':'Conversion is blocked until an existing customer is linked.')+'</div>'+
      '<div class="flex flex-wrap gap-2 mt-3"><button onclick="saveImportedQuotationCustomer(\''+row.id+'\')" class="px-4 py-2.5 rounded-xl bg-[#17324d] text-white text-xs font-semibold">Save Customer Match</button><button onclick="closeModal();go(\'customers\')" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold">Open Customers</button></div></div>'+
      '<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>Official Sales Order rule:</b> conversion opens your normal Sales Order form. You must choose TK or RK and enter its official number; the existing duplicate, product, payment, DO, and role validations still run.</div>'+
      '<button '+(!row.customer_id||row.status==='converted'?'disabled':'')+' onclick="convertImportedQuotation(\''+row.id+'\')" class="w-full rounded-xl py-3 font-semibold '+(!row.customer_id||row.status==='converted'?'bg-gray-200 text-gray-400 cursor-not-allowed':'bg-[#211d18] text-white')+'">'+(row.status==='converted'?'Already Converted':'Convert to Official Sales Order')+'</button></div>'
    );
  };
  window.saveImportedQuotationCustomer=async function(id){
    const customerId=document.getElementById('importQuoteCustomer')?.value||null;
    if(!customerId)return showToast('Select an existing customer first. If the customer does not exist, create/link it in Customers.','err');
    const r=await db.from(TABLE).update({customer_id:customerId,status:'ready',updated_at:new Date().toISOString()}).eq('id',id).select().single();
    if(r.error)return showToast(r.error.message,'err');
    showToast('Customer linked. This quotation is ready for conversion.');await reviewImportedQuotation(id);
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
      showToast(row.status==='ready'?'Quotation imported and customer matched.':'Quotation imported. Link the customer before conversion.');
      setTimeout(()=>{try{reviewImportedQuotation(row.id)}catch(_){}},150);
    }catch(err){console.error('Showroom quotation import failed:',err);showToast(err.message||'Could not import showroom quotation.','err')}
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
