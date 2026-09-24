// L'Imperial document flow: PO -> SR -> TK/RK
// Loaded after tracking-redesign.js. Keeps the existing UI and adds business-document workflow.

(function(){
  const df={refs:[],events:[],orderMeta:new Map(),loaded:false,loading:null};
  window.documentFlowState=df;

  function norm(v=''){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function isPre(o){return (o.sales_flow_type||o.order_type)==='pre_order'||String(o.sr_no||o.order_no||'').toUpperCase().startsWith('SR')}
  function isAdminRole(){return typeof isAdmin==='function'&&isAdmin()}
  function canRequestInvoice(){return ['sales','manager','admin','super_admin'].includes(state.profile?.role)}
  function docLabel(o){
    if(isPre(o)){
      const sr=o.sr_no||o.order_no||'SR Pending';
      return o.sales_invoice_no?`${sr} → ${o.sales_invoice_no}`:sr;
    }
    return o.sales_invoice_no||o.invoice_no||o.order_no||'Invoice Pending';
  }
  function flowMeta(o){return df.orderMeta.get(o.id)||o}
  function refsForOrder(o){const ids=new Set((o.items||[]).map(i=>i.id));return df.refs.filter(r=>r.sales_order_id===o.id||ids.has(r.sales_order_item_id))}
  function refsForItem(id){return df.refs.filter(r=>r.sales_order_item_id===id)}
  function eventsForOrder(id){return df.events.filter(e=>e.sales_order_id===id)}
  function allArrived(o){
    const items=o.items||[];if(!items.length)return false;
    return items.every(i=>{
      const linked=refsForItem(i.id);
      if(linked.length)return linked.every(r=>['arrived','completed'].includes(norm(r.po_status)));
      return ['arrived','ready','delivered'].includes(norm(i.fulfillment_status));
    });
  }
  function allDelivered(o){const items=o.items||[];return !!items.length&&items.every(i=>norm(i.fulfillment_status)==='delivered')}
  function uniquePOs(o){
    const seen=new Map();refsForOrder(o).forEach(r=>seen.set(r.po_number,{no:r.po_number,status:r.po_status,eta:r.estimated_arrival}));return [...seen.values()];
  }
  function fmtDate(v){if(!v)return 'TBD';const d=new Date(String(v).length<=10?v+'T00:00:00':v);return Number.isNaN(d.getTime())?v:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}

  async function refreshFlowData(force=false){
    if(df.loading)return df.loading;
    if(df.loaded&&!force)return;
    df.loading=(async()=>{
      const [rr,er,mr]=await Promise.all([
        db.rpc('get_visible_sales_procurement_refs'),
        db.from('sales_document_events').select('*').order('created_at',{ascending:true}),
        db.from('sales_orders').select('id,order_no,invoice_no,sales_flow_type,sr_no,sales_invoice_no,sales_invoice_type,invoice_request_status,invoice_requested_at,invoice_issued_at')
      ]);
      if(rr.error)console.warn('PO reference load:',rr.error.message);
      if(er.error)console.warn('Document event load:',er.error.message);
      if(mr.error)console.warn('Document metadata load:',mr.error.message);
      df.refs=rr.data||[];df.events=er.data||[];df.orderMeta=new Map((mr.data||[]).map(x=>[x.id,x]));df.loaded=true;
    })().finally(()=>df.loading=null);
    return df.loading;
  }

  function mergeMeta(o){return {...o,...(df.orderMeta.get(o.id)||{})}}

  function stepHtml(label,done,current=false,sub=''){
    return `<div class="min-w-[118px] rounded-xl border p-3 ${done?'bg-green-50 border-green-200':'bg-gray-50 border-gray-200'} ${current?'ring-2 ring-amber-200':''}"><div class="text-[9px] font-extrabold uppercase ${done?'text-green-700':'text-gray-400'}">${done?'✓':'○'} ${esc(label)}</div>${sub?`<div class="text-[10px] mt-1 ${done?'text-green-800':'text-gray-500'}">${esc(sub)}</div>`:''}</div>`;
  }

  function flowPanel(raw){
    const o=mergeMeta(raw),pre=isPre(o),refs=refsForOrder(o),pos=uniquePOs(o),paid=Number(o.amount_paid||0)>0,arrived=allArrived(o),delivered=allDelivered(o),issued=!!o.sales_invoice_no,requested=o.invoice_request_status==='requested'||issued,settled=norm(o.payment_status)==='paid';
    const production=refs.some(r=>['production','shipping','arrived','completed'].includes(norm(r.po_status)));
    const shipping=refs.some(r=>['shipping','arrived','completed'].includes(norm(r.po_status)));
    const poLinked=refs.length>0;
    const events=eventsForOrder(o.id);

    let steps='';
    if(pre){
      steps=[
        stepHtml('SR Created',!!(o.sr_no||o.order_no),false,o.sr_no||o.order_no||''),
        stepHtml('Deposit',paid,!paid,paid?'Received':'Pending'),
        stepHtml('PO Linked',poLinked,!poLinked,pos.map(p=>p.no).join(', ')||'Not linked'),
        stepHtml('Production',production,poLinked&&!production),
        stepHtml('Shipping',shipping,production&&!shipping),
        stepHtml('Arrived',arrived,shipping&&!arrived),
        stepHtml('Invoice Requested',requested,arrived&&!requested),
        stepHtml('TK/RK Issued',issued,requested&&!issued,o.sales_invoice_no||''),
        stepHtml('Paid',settled,issued&&!settled),
        stepHtml('Delivered',delivered,settled&&!delivered)
      ].join('');
    }else{
      steps=[
        stepHtml('TK/RK Issued',!!o.sales_invoice_no,false,o.sales_invoice_no||o.invoice_no||o.order_no||''),
        stepHtml('Paid',settled,!settled),
        stepHtml('Arrived',(o.items||[]).some(i=>['arrived','ready','delivered'].includes(norm(i.fulfillment_status))),false),
        stepHtml('Delivered',delivered,settled&&!delivered)
      ].join('');
    }

    const poBadges=pos.length?pos.map(p=>`<span class="lr-badge lr-badge-blue">${esc(p.no)} · ${esc(titleCase(p.status||'placed'))}${p.eta?' · '+esc(fmtDate(p.eta)):''}</span>`).join(' '):'<span class="text-[10px] text-gray-400">No supplier PO linked yet.</span>';
    const controls=[`<button onclick="openDocumentFlowDetails('${o.id}')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">View Details</button>`];
    if(pre&&isAdminRole())controls.push(`<button onclick="openLinkPOItems('${o.id}')" class="px-3 py-2 rounded-lg border text-xs font-semibold">Link PO Items</button>`);
    if(pre&&!issued&&arrived&&canRequestInvoice()&&o.invoice_request_status!=='requested')controls.push(`<button onclick="openInvoiceRequest('${o.id}')" class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">Request TK/RK</button>`);
    if(pre&&!issued&&isAdminRole()&&(requested||arrived))controls.push(`<button onclick="openIssueFinalInvoice('${o.id}')" class="px-3 py-2 rounded-lg bg-[#b38b2e] text-white text-xs font-semibold">Issue TK/RK</button>`);

    return `<div class="mb-4 rounded-2xl border border-[#eee7d9] bg-[#fffdf8] p-4">
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3"><div><div class="text-[10px] uppercase tracking-wider font-extrabold text-[#a77d1a]">Document Flow</div><div class="font-bold mt-1">${esc(docLabel(o))}</div></div><div class="flex flex-wrap gap-2">${controls.join('')}</div></div>
      <div class="flex flex-wrap gap-2 mb-3">${pre?poBadges:''}</div>
      <div class="flex gap-2 overflow-x-auto pb-2">${steps}</div>
      ${events.length?`<div class="mt-3 text-[10px] text-gray-400">Latest activity: ${esc(titleCase(events[events.length-1].event_type))} · ${esc(fmtDate(String(events[events.length-1].created_at).slice(0,10)))}</div>`:''}
    </div>`;
  }

  function enhanceSalesCards(){
    const ui=window.trackingRedesign;if(!ui||ui.salesTab!=='invoices')return;
    const all=(ui.salesOrders||[]).map(mergeMeta);
    const cards=[...document.querySelectorAll('#salesTrackingRoot .lr-order-card')];
    cards.forEach(card=>{
      const title=card.querySelector('.lr-order-main button.font-extrabold');if(!title)return;
      const original=title.textContent.trim();
      const o=all.find(x=>[x.invoice_no,x.order_no,x.sr_no,x.sales_invoice_no].filter(Boolean).map(String).includes(original));
      if(!o)return;
      title.textContent=docLabel(o);
      const detail=card.querySelector('.lr-detail');if(detail&&!detail.querySelector('.document-flow-panel')){
        const wrap=document.createElement('div');wrap.className='document-flow-panel';wrap.innerHTML=flowPanel(o);detail.prepend(wrap);
      }
    });
  }

  const baseRenderSalesBody=window.renderSalesTrackingBody;
  if(baseRenderSalesBody){window.renderSalesTrackingBody=function(){baseRenderSalesBody();setTimeout(enhanceSalesCards,0)}}
  const baseRenderSalesOrders=window.renderSalesOrders;
  if(baseRenderSalesOrders){window.renderSalesOrders=async function(){await baseRenderSalesOrders();await refreshFlowData(true);enhanceSalesCards()}}

  window.openDocumentFlowDetails=async function(orderId){
    openModal('Order Flow Details','<div class="py-10 text-center text-sm text-gray-400">Loading order details...</div>');
    try{
      const [sr,or,rr,er]=await Promise.all([
        db.from('sales_order_summary').select('*').eq('id',orderId).single(),
        db.from('sales_orders').select(`
          *,
          customers(id,name,customer_code,phone,address),
          sales_order_items(
            id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,
            qty,unit_price,discount_amount,line_total,source_type,fulfillment_status,
            notes,product_class_snapshot,product_type_snapshot,line_kind,created_at
          )
        `).eq('id',orderId).single(),
        db.rpc('get_visible_sales_procurement_refs'),
        db.from('sales_document_events').select('*').eq('sales_order_id',orderId).order('created_at',{ascending:true})
      ]);
      if(sr.error)throw sr.error;
      if(or.error)throw or.error;
      if(rr.error)throw rr.error;
      if(er.error)console.warn('Document event detail:',er.error.message);

      const s=sr.data||{};
      const o={...s,...(or.data||{})};
      const customer=o.customers||{};
      const items=o.sales_order_items||[];
      const refs=(rr.data||[]).filter(x=>x.sales_order_id===orderId);
      const events=er.data||[];
      const pre=isPre(o);
      const finalNo=o.sales_invoice_no||o.invoice_no||null;
      const invoiceRequested=o.invoice_request_status==='requested'||!!finalNo;

      const refsByItem=new Map();
      for(const r of refs){
        if(!refsByItem.has(r.sales_order_item_id))refsByItem.set(r.sales_order_item_id,[]);
        refsByItem.get(r.sales_order_item_id).push(r);
      }

      const poMap=new Map();
      for(const r of refs){
        const key=r.po_number||'PO Pending';
        if(!poMap.has(key))poMap.set(key,{no:key,status:r.po_status||'pending',eta:r.estimated_arrival,qty:0});
        poMap.get(key).qty+=Number(r.qty_allocated||0);
      }
      const pos=[...poMap.values()];

      const itemRows=items.map(i=>{
        const links=refsByItem.get(i.id)||[];
        const poText=links.length
          ?links.map(r=>`<span class="inline-flex px-2 py-1 rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-[9px] font-bold">${esc(r.po_number||'PO Pending')} · Qty ${Number(r.qty_allocated||0)} · ${esc(titleCase(r.po_status||'pending'))}${r.estimated_arrival?' · ETA '+esc(fmtDate(r.estimated_arrival)):''}</span>`).join(' ')
          :'<span class="text-[10px] text-gray-400">Not linked to supplier PO</span>';
        return `<div class="rounded-xl border bg-white p-3">
          <div class="grid md:grid-cols-[minmax(0,1fr)_80px_110px_110px] gap-3 items-start">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <b class="text-sm">${esc(i.product_code_snapshot||'No Code')}</b>
                <span class="lr-badge lr-badge-gray">${esc(titleCase(i.fulfillment_status||'pending'))}</span>
              </div>
              <div class="text-xs text-gray-600 mt-1">${esc(i.item_name_snapshot||'Item')}</div>
              ${i.notes?`<div class="text-[10px] text-gray-400 mt-1">${esc(i.notes)}</div>`:''}
              <div class="flex flex-wrap gap-1 mt-2">${poText}</div>
            </div>
            <div class="text-right">
              <div class="text-[9px] uppercase font-bold text-gray-400">Qty</div>
              <div class="font-bold mt-1">${Number(i.qty||0)}</div>
            </div>
            <div class="text-right">
              <div class="text-[9px] uppercase font-bold text-gray-400">Unit Price</div>
              <div class="font-bold mt-1">${money(i.unit_price,o.currency)}</div>
              ${Number(i.discount_amount||0)>0?`<div class="text-[9px] text-amber-600 mt-1">Discount ${money(i.discount_amount,o.currency)}</div>`:''}
            </div>
            <div class="text-right">
              <div class="text-[9px] uppercase font-bold text-gray-400">Line Total</div>
              <div class="font-bold mt-1">${money(i.line_total,o.currency)}</div>
            </div>
          </div>
        </div>`;
      }).join('');

      const poRows=pos.length?pos.map(p=>`<div class="rounded-xl border bg-white p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <b>${esc(p.no)}</b>
            <span class="lr-badge ${['arrived','completed'].includes(norm(p.status))?'lr-badge-green':norm(p.status)==='shipping'?'lr-badge-blue':norm(p.status)==='production'?'lr-badge-amber':'lr-badge-gray'}">${esc(titleCase(p.status||'pending'))}</span>
          </div>
          <div class="text-[10px] text-gray-400 mt-1">Allocated Qty: ${Number(p.qty||0)}</div>
        </div>
        <div class="text-right">
          <div class="text-[9px] uppercase font-bold text-gray-400">ETA</div>
          <div class="text-sm font-semibold mt-1">${esc(fmtDate(p.eta))}</div>
        </div>
      </div>`).join(''):'<div class="rounded-xl border border-dashed p-5 text-center text-sm text-gray-400">No supplier PO linked yet.</div>';

      const eventRows=events.length?events.slice().reverse().map(e=>`<div class="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
        <div><div class="text-xs font-semibold">${esc(titleCase(e.event_type||'Activity'))}</div>${e.note?`<div class="text-[10px] text-gray-500 mt-1">${esc(e.note)}</div>`:''}</div>
        <div class="text-[10px] text-gray-400 whitespace-nowrap">${esc(fmtDate(String(e.created_at||'').slice(0,10)))}</div>
      </div>`).join(''):'<div class="text-sm text-gray-400">No document activity recorded yet.</div>';

      const body=document.getElementById('modalBody');
      if(!body)return;
      body.innerHTML=`
        <div class="space-y-5">
          <div class="rounded-2xl border bg-[#faf9f6] p-4">
            <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div>
                <div class="text-[10px] uppercase tracking-wider font-extrabold text-[#a77d1a]">${pre?'Pre-Order / SR':'Stock Sale'}</div>
                <div class="text-xl font-bold mt-1">${esc(o.customer_name||customer.name||'Customer')}</div>
                <div class="text-xs text-gray-500 mt-1">
                  ${customer.customer_code?esc(customer.customer_code)+' · ':''}
                  ${customer.phone?esc(customer.phone)+' · ':''}
                  ${esc(customer.address||'')}
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <span class="lr-badge lr-badge-amber">${esc(o.sr_no||o.order_no||'SR')}</span>
                ${finalNo?`<span class="lr-badge lr-badge-green">${esc(finalNo)}</span>`:'<span class="lr-badge lr-badge-gray">TK/RK Pending</span>'}
              </div>
            </div>

            <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              <div><div class="text-[9px] uppercase font-bold text-gray-400">Order Date</div><div class="font-semibold mt-1">${esc(fmtDate(o.order_date))}</div></div>
              <div><div class="text-[9px] uppercase font-bold text-gray-400">Sales Rep</div><div class="font-semibold mt-1">${esc(o.sales_rep_name_snapshot||'—')}</div></div>
              <div><div class="text-[9px] uppercase font-bold text-gray-400">Order Status</div><div class="font-semibold mt-1">${esc(titleCase(o.status||'confirmed'))}</div></div>
              <div><div class="text-[9px] uppercase font-bold text-gray-400">Invoice Status</div><div class="font-semibold mt-1">${finalNo?'Issued':invoiceRequested?'Requested':'Not Requested'}</div></div>
            </div>
          </div>

          <div class="grid sm:grid-cols-3 gap-3">
            <div class="rounded-xl border p-4"><div class="text-[9px] uppercase font-bold text-gray-400">Order Total</div><div class="text-xl font-bold mt-1">${money(o.order_total,o.currency)}</div></div>
            <div class="rounded-xl border p-4"><div class="text-[9px] uppercase font-bold text-gray-400">Deposit / Paid</div><div class="text-xl font-bold text-green-600 mt-1">${money(o.amount_paid,o.currency)}</div></div>
            <div class="rounded-xl border p-4"><div class="text-[9px] uppercase font-bold text-gray-400">${pre&&!finalNo?'Pending Balance':'Balance Due'}</div><div class="text-xl font-bold ${Number(o.balance_due||0)>0?'text-red-500':'text-green-600'} mt-1">${money(o.balance_due,o.currency)}</div></div>
          </div>

          <div>
            <div class="flex items-center justify-between gap-3 mb-2">
              <h4 class="font-bold">Ordered Items</h4>
              <span class="text-[10px] text-gray-400">${items.length} line${items.length===1?'':'s'}</span>
            </div>
            <div class="grid gap-2">${itemRows||'<div class="rounded-xl border border-dashed p-5 text-center text-sm text-gray-400">No item details found.</div>'}</div>
          </div>

          <div>
            <div class="flex items-center justify-between gap-3 mb-2">
              <h4 class="font-bold">Linked Supplier PO</h4>
              <span class="text-[10px] text-gray-400">${pos.length} PO${pos.length===1?'':'s'}</span>
            </div>
            <div class="grid gap-2">${poRows}</div>
          </div>

          <div class="grid md:grid-cols-2 gap-3">
            <div class="rounded-xl border p-4">
              <div class="text-[9px] uppercase font-bold text-gray-400">SR / Pre-Order</div>
              <div class="font-bold mt-1">${esc(o.sr_no||o.order_no||'-')}</div>
              <div class="text-[10px] text-gray-500 mt-2">Created ${esc(fmtDate(o.order_date))}</div>
            </div>
            <div class="rounded-xl border p-4">
              <div class="text-[9px] uppercase font-bold text-gray-400">Final TK / RK</div>
              <div class="font-bold mt-1">${esc(finalNo||'Pending')}</div>
              <div class="text-[10px] text-gray-500 mt-2">${o.invoice_issued_at?'Issued '+esc(fmtDate(String(o.invoice_issued_at).slice(0,10))):invoiceRequested?'Invoice requested':'Not issued yet'}</div>
            </div>
          </div>

          ${o.notes?`<div class="rounded-xl border bg-gray-50 p-4"><div class="text-[9px] uppercase font-bold text-gray-400">Order Notes</div><div class="text-sm mt-1">${esc(o.notes)}</div></div>`:''}

          <div>
            <h4 class="font-bold mb-2">Document Activity</h4>
            <div class="rounded-xl border px-4">${eventRows}</div>
          </div>

          <div class="flex flex-wrap justify-end gap-2 border-t pt-4">
            ${pre&&isAdminRole()?`<button onclick="closeModal();openLinkPOItems('${orderId}')" class="px-4 py-2.5 rounded-xl border text-xs font-semibold">Link / Review PO Items</button>`:''}
            <button onclick="closeModal()" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Close</button>
          </div>
        </div>`;
    }catch(err){
      const body=document.getElementById('modalBody');
      if(body)body.innerHTML=`<div class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">Could not load details: ${esc(err.message||'Unknown error')}</div>`;
    }
  };

  window.openInvoiceRequest=function(orderId){
    openModal('Request Final TK/RK Invoice',`<form id="invoiceRequestForm" class="space-y-4"><div class="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">This marks the arrived SR as ready for Accounting to issue the final TK or RK invoice.</div><div><label class="text-xs font-semibold">Note to Accounting</label><textarea id="invoiceRequestNote" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Optional note"></textarea></div><button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Send Invoice Request</button></form>`);
    document.getElementById('invoiceRequestForm').onsubmit=async e=>{e.preventDefault();const note=document.getElementById('invoiceRequestNote').value.trim()||null;const {error}=await db.rpc('request_sales_invoice',{p_order_id:orderId,p_note:note});if(error)return showToast(error.message,'err');closeModal();showToast('Invoice request sent to Accounting');df.loaded=false;await go('sales-orders')};
  };

  window.openIssueFinalInvoice=function(orderId){
    openModal('Issue Final TK / RK',`<form id="issueInvoiceForm" class="grid md:grid-cols-2 gap-4"><div><label class="text-xs font-semibold">Invoice Type</label><select id="finalInvoiceType" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="TK">TK</option><option value="RK">RK</option></select></div><div><label class="text-xs font-semibold">Invoice Number</label><input id="finalInvoiceNo" required class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: TK2609-010"></div><div class="md:col-span-2"><label class="text-xs font-semibold">Accounting Note</label><textarea id="finalInvoiceNote" class="mt-1 w-full border rounded-xl px-3 py-2"></textarea></div><button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Issue Invoice</button></form>`);
    document.getElementById('issueInvoiceForm').onsubmit=async e=>{e.preventDefault();const type=document.getElementById('finalInvoiceType').value,no=document.getElementById('finalInvoiceNo').value.trim(),note=document.getElementById('finalInvoiceNote').value.trim()||null;const {error}=await db.rpc('issue_sales_invoice',{p_order_id:orderId,p_invoice_type:type,p_invoice_no:no,p_note:note});if(error)return showToast(error.message,'err');closeModal();showToast(`${type} invoice issued`);df.loaded=false;await go('sales-orders')};
  };

  async function loadLinkModalData(orderId){
    const [sr,pr]=await Promise.all([
      db.from('sales_order_items').select('id,product_code_snapshot,item_name_snapshot,qty').eq('sales_order_id',orderId).eq('line_kind','product').not('product_id','is',null).order('created_at'),
      db.from('supplier_po_items').select('id,product_code_snapshot,item_name_snapshot,qty,supplier_po_id,supplier_pos(id,po_number,status,estimated_arrival)').order('created_at',{ascending:false}).limit(2000)
    ]);
    if(sr.error)throw sr.error;if(pr.error)throw pr.error;
    const ids=(sr.data||[]).map(x=>x.id);let links=[];
    if(ids.length){const x=await db.from('fulfillment_links').select('id,sales_order_item_id,supplier_po_item_id,qty_allocated').in('sales_order_item_id',ids);if(x.error)throw x.error;links=x.data||[]}
    return {sales:sr.data||[],po:pr.data||[],links};
  }

  window.openLinkPOItems=async function(orderId){
    if(!isAdminRole())return showToast('Admin access required','err');
    try{
      const d=await loadLinkModalData(orderId);window._dfLinkData=d;const poMap=new Map(d.po.map(p=>[p.id,p]));
      openModal('Link Supplier PO Items to SR',`<div class="space-y-5"><div class="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">Link each customer pre-order item to the supplier PO item that will fulfill it. PO status and ETA will then flow automatically into Sales tracking.</div><form id="linkPOForm" class="grid md:grid-cols-3 gap-3"><select id="linkSalesItem" class="border rounded-xl px-3 py-2">${d.sales.map(i=>`<option value="${i.id}">${esc(i.product_code_snapshot||'No Code')} · ${esc(i.item_name_snapshot||'Item')} · Qty ${Number(i.qty||0)}</option>`).join('')}</select><select id="linkPOItem" class="border rounded-xl px-3 py-2">${d.po.map(i=>`<option value="${i.id}">${esc(i.supplier_pos?.po_number||'PO Pending')} · ${esc(i.product_code_snapshot||'No Code')} · ${esc(i.item_name_snapshot||'Item')} · Qty ${Number(i.qty||0)}</option>`).join('')}</select><input id="linkQty" type="number" min="0.01" step="0.01" value="1" class="border rounded-xl px-3 py-2" placeholder="Allocated qty"><button class="md:col-span-3 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Link PO Item</button></form><div><div class="text-xs font-bold uppercase text-gray-400 mb-2">Existing Links</div><div class="divide-y border rounded-xl">${d.links.length?d.links.map(l=>{const s=d.sales.find(x=>x.id===l.sales_order_item_id),p=poMap.get(l.supplier_po_item_id);return `<div class="p-3 flex justify-between gap-3 text-xs"><div><b>${esc(s?.product_code_snapshot||'Sales item')}</b> → <b>${esc(p?.supplier_pos?.po_number||'PO Pending')}</b> · ${esc(p?.product_code_snapshot||'PO item')} · Qty ${Number(l.qty_allocated||0)}</div><button onclick="unlinkPOItem('${l.id}','${orderId}')" class="text-red-600 font-semibold">Unlink</button></div>`}).join(''):'<div class="p-4 text-xs text-gray-400">No PO items linked yet.</div>'}</div></div></div>`);
      document.getElementById('linkPOForm').onsubmit=async e=>{e.preventDefault();const row={sales_order_item_id:document.getElementById('linkSalesItem').value,supplier_po_item_id:document.getElementById('linkPOItem').value,qty_allocated:Number(document.getElementById('linkQty').value||0)};const {error}=await db.from('fulfillment_links').insert(row);if(error)return showToast(error.message,'err');showToast('PO item linked');df.loaded=false;await openLinkPOItems(orderId)};
    }catch(err){showToast(err.message,'err')}
  };

  window.unlinkPOItem=async function(linkId,orderId){const {error}=await db.from('fulfillment_links').delete().eq('id',linkId);if(error)return showToast(error.message,'err');showToast('PO link removed');df.loaded=false;await openLinkPOItems(orderId)};

  window.openNewSupplierPO=function(){
    if(!isAdminRole())return;
    openModal('Create / Upload Supplier PO',`<form id="newPOFlowForm" class="grid md:grid-cols-2 gap-4"><div><label class="text-xs font-semibold">Official PO Number</label><input id="poOfficialNo" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Leave blank if pending"></div><div><label class="text-xs font-semibold">Vendor / Supplier</label><input id="poVendor" required class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Order Date</label><input id="poOrderDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Currency</label><select id="poCurrency" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option>USD</option><option>EUR</option><option>CNY</option><option>GBP</option></select></div><div><label class="text-xs font-semibold">Shipping Agent</label><input id="poAgent" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">ETA</label><input id="poEta" type="date" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div class="md:col-span-2"><label class="text-xs font-semibold">PO Document / Supplier Order File</label><input id="poFile" type="file" accept=".pdf,image/*" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><div class="text-[10px] text-gray-400 mt-1">If Accounting has not issued a PO number yet, upload the supplier/order document here.</div></div><div class="md:col-span-2"><label class="text-xs font-semibold">Notes</label><textarea id="poNotes" class="mt-1 w-full border rounded-xl px-3 py-2"></textarea></div><button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Supplier PO</button></form>`);
    document.getElementById('newPOFlowForm').onsubmit=async e=>{e.preventDefault();const official=document.getElementById('poOfficialNo').value.trim()||null,file=document.getElementById('poFile').files[0]||null;if(!official&&!file)return showToast('Enter a PO number or upload the pending PO/order document.','err');const row={po_number:official,vendor_name:document.getElementById('poVendor').value.trim(),order_date:document.getElementById('poOrderDate').value,currency:document.getElementById('poCurrency').value,status:'placed',shipping_agent:document.getElementById('poAgent').value.trim()||null,estimated_arrival:document.getElementById('poEta').value||null,notes:document.getElementById('poNotes').value.trim()||null,created_by:state.user.id,po_pending_reference:official?null:`Pending ${new Date().toLocaleDateString()}`};const {data:po,error}=await db.from('supplier_pos').insert(row).select('id').single();if(error)return showToast(error.message,'err');if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${po.id}/${Date.now()}-${safe}`;const up=await db.storage.from('po-documents').upload(path,file,{upsert:false});if(up.error)return showToast(`PO saved but file upload failed: ${up.error.message}`,'err');await db.from('supplier_pos').update({po_document_path:path,po_document_name:file.name}).eq('id',po.id)}closeModal();showToast(official?'Supplier PO created':'Pending PO uploaded');await go('supplier-pos')};
  };

  const baseSupplier=window.renderSupplierPOs;
  if(baseSupplier){
    window.renderSupplierPOs=async function(){
      if(!isAdminRole())throw new Error('Access denied');
      const [sr,pr]=await Promise.all([db.from('supplier_po_summary').select('*').order('created_at',{ascending:false}),db.from('supplier_pos').select('id,po_number,po_document_path,po_document_name,po_pending_reference,status,estimated_arrival,vendor_name').order('created_at',{ascending:false})]);
      if(sr.error)throw sr.error;if(pr.error)throw pr.error;const m=new Map((pr.data||[]).map(x=>[x.id,x]));
      document.getElementById('content').innerHTML=`<div class="flex justify-end mb-4"><button onclick="openNewSupplierPO()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ Supplier PO</button></div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${(sr.data||[]).map(p=>{const x=m.get(p.id)||{};return `<div class="p-4 grid md:grid-cols-[1fr_1.2fr_120px_130px_130px] gap-3 items-center"><div><b>${esc(x.po_number||'PO Pending')}</b><div class="text-[10px] text-gray-400">${esc(x.po_pending_reference||'')}</div></div><div class="text-sm">${esc(p.vendor_name||x.vendor_name||'-')}</div><span class="lr-badge ${norm(p.status)==='arrived'?'lr-badge-green':norm(p.status)==='shipping'?'lr-badge-blue':norm(p.status)==='production'?'lr-badge-amber':'lr-badge-gray'}">${esc(titleCase(p.status||'placed'))}</span><div class="text-xs">ETA: <b>${esc(fmtDate(p.estimated_arrival||x.estimated_arrival))}</b></div><div class="text-right"><b>${money(p.balance_due,p.currency)}</b><div class="text-[10px] text-gray-400">Balance</div>${x.po_document_path?`<button onclick="viewPODocument('${p.id}')" class="mt-1 text-[10px] text-blue-600 font-semibold">View document</button>`:''}</div></div>`}).join('')||empty('No supplier POs.')}</div></div>`;
    };
  }

  window.viewPODocument=async function(poId){const {data:po,error}=await db.from('supplier_pos').select('po_document_path').eq('id',poId).single();if(error||!po?.po_document_path)return showToast('No PO document found','err');const r=await db.storage.from('po-documents').createSignedUrl(po.po_document_path,300);if(r.error)return showToast(r.error.message,'err');window.open(r.data.signedUrl,'_blank','noopener')};

  function flowTrackingHtml(){
    const ui=window.trackingRedesign||{};const q=String(ui.trackingSearch||'').toLowerCase();
    const orders=(ui.trackingOrders||[]).map(o=>({...o,...(df.orderMeta.get(o.id)||{})})).filter(o=>!q||[o.order_no,o.sr_no,o.sales_invoice_no,o.customer_name,...(o.items||[]).flatMap(i=>[i.product_code_snapshot,i.item_name_snapshot])].filter(Boolean).join(' ').toLowerCase().includes(q));
    return `<div class="grid gap-3">${orders.map(o=>{const pre=isPre(o),pos=uniquePOs(o);return `<div class="lr-panel p-4"><div class="flex flex-col lg:flex-row lg:items-center gap-3"><div class="flex-1"><div class="text-[10px] uppercase font-bold text-gray-400">${pre?'Pre-Order Flow':'Stock Sale Flow'}</div><div class="font-bold mt-1">${esc(o.customer_name||'Customer')}</div></div><div class="flex items-center gap-2 overflow-x-auto pb-1">${pre?`<span class="lr-badge lr-badge-blue">${esc(pos.map(p=>p.no).join(', ')||'PO Pending')}</span><span>→</span><span class="lr-badge lr-badge-amber">${esc(o.sr_no||o.order_no||'SR')}</span><span>→</span><span class="lr-badge ${o.sales_invoice_no?'lr-badge-green':'lr-badge-gray'}">${esc(o.sales_invoice_no||'TK/RK Pending')}</span>`:`<span class="lr-badge lr-badge-gray">Stock</span><span>→</span><span class="lr-badge lr-badge-green">${esc(o.sales_invoice_no||o.invoice_no||o.order_no||'TK/RK')}</span>`}</div></div>${pre?`<div class="mt-3">${flowPanel(o)}</div>`:''}</div>`}).join('')||'<div class="lr-panel lr-empty">No document flows found.</div>'}</div>`;
  }

  const baseTrackingBody=window.renderOrderTrackingBody;
  if(baseTrackingBody){
    window.renderOrderTrackingBody=function(){
      const ui=window.trackingRedesign||{};
      if(ui.trackingTab==='flow'){
        const root=document.getElementById('orderTrackingRoot');if(!root)return;root.innerHTML=`${typeof managerRepBanner==='function'&&managerRepActive()?managerRepBanner():''}<div class="lr-tabs mb-4"><button class="lr-tab" onclick="setTrackingTab('timeline')">Status Timeline</button><button class="lr-tab" onclick="setTrackingTab('eta')">ETA Schedule</button><button class="lr-tab" onclick="setTrackingTab('orders')">Orders</button><button class="lr-tab" onclick="setTrackingTab('items')">Items</button><button class="lr-tab active" onclick="setTrackingTab('flow')">PO → SR → TK/RK</button></div><div class="relative mb-5"><input class="lr-input pl-10" value="${esc(ui.trackingSearch||'')}" oninput="setTrackingSearch(this.value)" placeholder="Search PO, SR, TK/RK, client, item, SKU..."><span class="absolute left-3 top-2.5 text-gray-400">⌕</span></div>${flowTrackingHtml()}`;return;
      }
      baseTrackingBody();
      const tabs=document.querySelector('#orderTrackingRoot .lr-tabs');if(tabs&&!tabs.querySelector('[data-flow-tab]')){const b=document.createElement('button');b.dataset.flowTab='1';b.className='lr-tab';b.textContent='PO → SR → TK/RK';b.onclick=()=>setTrackingTab('flow');tabs.appendChild(b)}
    };
  }
  const baseSetTrackingTab=window.setTrackingTab;
  if(baseSetTrackingTab){window.setTrackingTab=function(tab){if(tab==='flow'){window.trackingRedesign.trackingTab='flow';renderOrderTrackingBody()}else baseSetTrackingTab(tab)}}
  const baseTracking=window.renderTracking;
  if(baseTracking){window.renderTracking=async function(){await baseTracking();await refreshFlowData(true);renderOrderTrackingBody()}}

  setTimeout(()=>{if(state?.profile)refreshFlowData().then(()=>{enhanceSalesCards();if(state.page==='tracking')renderOrderTrackingBody()})},500);
})();