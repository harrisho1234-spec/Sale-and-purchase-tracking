// Consolidated Procurement workspace: Supplier POs, PO Items, Supplier Payments, Shipping/ETA, SR Allocations.
// Loaded after document-flow.js, po-edit.js, and flow-refresh-fix.js.

(function(){
  const pw={tab:'pos',search:'',orderedStatus:'all',orderedExpanded:new Set()};
  window.procurementWorkspace=pw;

  function norm(v=''){return String(v||'').trim().toLowerCase()}
  function fmtDate(v){if(!v)return 'TBD';const d=new Date(String(v).length<=10?v+'T00:00:00':v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
  function poLabel(p){return p?.po_number||p?.po_pending_reference||'PO Pending'}
  function statusBadge(s){s=norm(s);return s==='arrived'?'lr-badge-green':s==='shipping'?'lr-badge-blue':s==='production'?'lr-badge-amber':'lr-badge-gray'}
  function requireAdmin(){if(!isAdmin())throw new Error('Procurement is available to Admin and Super Admin only.')}
  function moneyByCurrency(rows,key,currencyKey='currency'){
    const sums=new Map();
    for(const r of rows||[]){
      const cur=String(r?.[currencyKey]||'USD').toUpperCase();
      sums.set(cur,(sums.get(cur)||0)+Number(r?.[key]||0));
    }
    if(!sums.size)return money(0,'USD');
    return [...sums.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([cur,val])=>money(val,cur)).join(' · ');
  }

  function inject(){
    if(document.getElementById('procurement-workspace-css'))return;
    const st=document.createElement('style');st.id='procurement-workspace-css';st.textContent=`
      .pw-tabs{display:flex;gap:4px;overflow:auto;border-bottom:1px solid #e9e5de;margin-bottom:18px}
      .pw-tab{white-space:nowrap;padding:11px 14px;font-size:12px;font-weight:700;color:#8b8b95;border-bottom:2px solid transparent}
      .pw-tab.active{color:#171717;border-bottom-color:#b38b2e}
      .pw-toolbar{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-bottom:15px;flex-wrap:wrap}
      .pw-search{min-width:240px;max-width:460px;flex:1;border:1px solid #e4e4e7;border-radius:11px;padding:10px 13px;font-size:12px;background:#fff}
      .pw-stat{background:#fff;border:1px solid #eee8df;border-radius:14px;padding:14px}
      .pw-stat-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#a1a1aa;font-weight:800}
      .pw-stat-value{font-size:20px;font-weight:800;margin-top:5px}
      .pw-row{padding:14px 16px;border-bottom:1px solid #f0ede8}.pw-row:last-child{border-bottom:0}
      .pw-grid{display:grid;gap:12px}
      .pw-card{background:#fff;border:1px solid #ece8e0;border-radius:15px;padding:15px}
      .pw-mini{font-size:10px;color:#8b8b95}
      @media(max-width:700px){.pw-search{max-width:none;width:100%}.pw-toolbar>div{width:100%}}
    `;document.head.appendChild(st);
  }

  // Remove the duplicate Supplier POs sidebar item. Procurement becomes the single entry point.
  const prevNavItems=window.navItems;
  window.navItems=function(){
    const items=prevNavItems();
    const out=[];
    let hasProc=false;
    for(const x of items){
      if(x[0]==='supplier-pos')continue;
      if(x[0]==='procurement'){
        if(!hasProc){out.push(['procurement','Procurement',x[2]||'▣']);hasProc=true}
      }else out.push(x);
    }
    return out;
  };

  window.setProcurementTab=function(tab){pw.tab=tab;renderProcurementWorkspace()};
  window.setProcurementSearch=function(v){pw.search=v;renderProcurementWorkspace()};

  async function loadPOs(){
    const [sum,raw]=await Promise.all([
      db.from('supplier_po_summary').select('*').order('created_at',{ascending:false}),
      db.from('supplier_pos').select('*').order('created_at',{ascending:false})
    ]);
    if(sum.error)throw sum.error;if(raw.error)throw raw.error;
    const m=new Map((raw.data||[]).map(x=>[x.id,x]));
    return (sum.data||[]).map(x=>({...x,...(m.get(x.id)||{})}));
  }

  async function renderPOs(){
    const list=await loadPOs();const q=pw.search.toLowerCase();
    const rows=list.filter(p=>!q||[poLabel(p),p.vendor_name,p.status,p.shipping_agent,p.notes].filter(Boolean).join(' ').toLowerCase().includes(q));
    const shippingTotal=rows.reduce((a,p)=>a+Number(p.shipping_total_usd||0),0);
    return `<div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4"><div class="pw-stat"><div class="pw-stat-label">PO Goods Value</div><div class="pw-stat-value text-[16px]">${moneyByCurrency(rows,'po_total')}</div></div><div class="pw-stat"><div class="pw-stat-label">Supplier Paid</div><div class="pw-stat-value text-[16px] text-green-600">${moneyByCurrency(rows,'amount_paid')}</div></div><div class="pw-stat"><div class="pw-stat-label">Supplier Balance</div><div class="pw-stat-value text-[16px] text-red-500">${moneyByCurrency(rows,'balance_due')}</div></div><div class="pw-stat"><div class="pw-stat-label">Shipping Cost · USD</div><div class="pw-stat-value">${money(shippingTotal,'USD')}</div></div></div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(p=>`<div class="pw-row grid lg:grid-cols-[1.1fr_1.2fr_110px_165px_140px] gap-3 items-center"><div><b>${esc(poLabel(p))}</b><div class="pw-mini">${esc(p.order_date||'')}</div></div><div><div class="text-sm font-semibold">${esc(p.vendor_name||'-')}</div><div class="pw-mini">${esc(p.shipping_agent||'No shipping agent')}</div></div><span class="lr-badge ${statusBadge(p.status)}">${esc(titleCase(p.status||'placed'))}</span><div class="text-xs">ETA <b>${esc(fmtDate(p.estimated_arrival))}</b><div class="pw-mini">Goods balance ${money(p.balance_due,p.currency||'USD')}</div><div class="pw-mini">Shipping balance ${money(p.shipping_balance_usd||0,'USD')}</div></div><div class="flex gap-2 justify-end flex-wrap"><button onclick="openManageSupplierPO('${p.id}')" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-[10px] font-semibold">Manage PO</button>${p.po_document_path?`<button onclick="viewPODocument('${p.id}')" class="px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-[10px] font-semibold">Document</button>`:''}<button onclick="deleteSupplierPO('${p.id}','${esc(poLabel(p))}')" class="px-3 py-2 border border-red-200 bg-red-50 text-red-600 rounded-lg text-[10px] font-semibold">Delete</button></div></div>`).join(''):empty('No supplier POs yet.')}</div></div>`;
  }

  async function renderPOItems(){
    const r=await db.from('supplier_po_items').select('id,supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,qty,unit_cost,shipping_cost,created_at,supplier_pos(id,po_number,po_pending_reference,vendor_name,currency,status,estimated_arrival)').order('created_at',{ascending:false});
    if(r.error)throw r.error;const q=pw.search.toLowerCase();const rows=(r.data||[]).filter(i=>!q||[i.product_code_snapshot,i.item_name_snapshot,poLabel(i.supplier_pos),i.supplier_pos?.vendor_name].filter(Boolean).join(' ').toLowerCase().includes(q));
    return `<div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(i=>`<div class="pw-row grid md:grid-cols-[1.2fr_1.7fr_90px_120px_130px] gap-3 items-center"><div><b>${esc(poLabel(i.supplier_pos))}</b><div class="pw-mini">${esc(i.supplier_pos?.vendor_name||'')}</div></div><div><div class="text-xs font-bold text-[#a77d1a]">${esc(i.product_code_snapshot)}</div><div class="text-sm">${esc(i.item_name_snapshot)}</div></div><div class="text-sm">Qty <b>${Number(i.qty||0)}</b></div><div class="text-xs">Cost <b>${money(i.unit_cost,i.supplier_pos?.currency||'USD')}</b><div class="pw-mini">Shipping ${money(i.shipping_cost,'USD')}</div></div><div class="text-right"><button onclick="openEditSupplierPO('${i.supplier_po_id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Manage PO</button></div></div>`).join(''):empty('No PO items yet. Add items from a Supplier PO.')}</div></div>`;
  }

  async function renderPayments(){
    const [pr,por]=await Promise.all([
      db.from('supplier_payments').select('id,supplier_po_id,payment_type,payment_date,amount,currency,reference_no,notes,created_at,supplier_pos(id,po_number,po_pending_reference,vendor_name)').order('payment_date',{ascending:false}),
      db.from('supplier_pos').select('id,po_number,po_pending_reference,vendor_name,currency').order('created_at',{ascending:false})
    ]);if(pr.error)throw pr.error;if(por.error)throw por.error;window._procurementPOOptions=por.data||[];
    const q=pw.search.toLowerCase();const rows=(pr.data||[]).filter(p=>!q||[poLabel(p.supplier_pos),p.supplier_pos?.vendor_name,p.payment_type,p.reference_no,p.notes].filter(Boolean).join(' ').toLowerCase().includes(q));
    return `<div class="pw-stat mb-4"><div class="pw-stat-label">Payments Shown</div><div class="pw-stat-value text-[16px] text-green-600">${moneyByCurrency(rows,'amount')}</div></div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(p=>`<div class="pw-row grid md:grid-cols-[1fr_1fr_110px_130px_1fr] gap-3 items-center"><div><b>${esc(poLabel(p.supplier_pos))}</b><div class="pw-mini">${esc(p.supplier_pos?.vendor_name||'')}</div></div><div class="text-sm">${esc(fmtDate(p.payment_date))}</div><span class="lr-badge lr-badge-gray">${esc(titleCase(p.payment_type||'other'))}</span><div class="font-bold text-green-600">${money(p.amount,p.currency||'USD')}</div><div class="text-xs text-gray-500">${esc(p.reference_no||p.notes||'-')}</div></div>`).join(''):empty('No supplier payments yet.')}</div></div>`;
  }

  async function renderShipping(){
    const r=await db.from('supplier_pos').select('*').order('estimated_arrival',{ascending:true,nullsFirst:false});if(r.error)throw r.error;
    const q=pw.search.toLowerCase();const rows=(r.data||[]).filter(p=>!q||[poLabel(p),p.vendor_name,p.status,p.shipping_agent].filter(Boolean).join(' ').toLowerCase().includes(q));
    return `<div class="pw-grid">${rows.length?rows.map(p=>`<div class="pw-card grid lg:grid-cols-[1.2fr_1fr_160px_170px_100px] gap-3 items-center"><div><div class="font-bold">${esc(poLabel(p))}</div><div class="pw-mini">${esc(p.vendor_name||'')}</div></div><div><span class="lr-badge ${statusBadge(p.status)}">${esc(titleCase(p.status||'placed'))}</span><div class="pw-mini mt-1">${esc(p.shipping_agent||'No shipping agent')}</div></div><div><label class="pw-mini">ETA</label><input id="eta-${p.id}" type="date" value="${esc(p.estimated_arrival||'')}" class="mt-1 w-full border rounded-lg px-2 py-2 text-xs"></div><div><label class="pw-mini">Status</label><select id="status-${p.id}" class="mt-1 w-full border rounded-lg px-2 py-2 text-xs bg-white">${[['placed','Ordered'],['production','Production'],['shipping','Shipping'],['arrived','Arrived'],['delivered','Delivered']].map(([s,l])=>`<option value="${s}" ${p.status===s?'selected':''}>${l}</option>`).join('')}</select></div><button onclick="saveProcShipping('${p.id}')" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">Save</button></div>`).join(''):'<div class="card rounded-2xl">'+empty('No supplier POs to track yet.')+'</div>'}</div>`;
  }

  async function renderAllocations(){
    const r=await db.from('fulfillment_links').select('id,qty_allocated,created_at,sales_order_items!inner(id,product_code_snapshot,item_name_snapshot,sales_orders!inner(id,order_no,sr_no,customer_id,customers(name))),supplier_po_items!inner(id,product_code_snapshot,item_name_snapshot,supplier_pos!inner(id,po_number,po_pending_reference,vendor_name,status,estimated_arrival))').order('created_at',{ascending:false});
    if(r.error)throw r.error;const q=pw.search.toLowerCase();const rows=(r.data||[]).filter(x=>{const so=x.sales_order_items?.sales_orders,pi=x.supplier_po_items?.supplier_pos;return !q||[so?.sr_no,so?.order_no,so?.customers?.name,x.sales_order_items?.product_code_snapshot,x.sales_order_items?.item_name_snapshot,poLabel(pi),x.supplier_po_items?.product_code_snapshot].filter(Boolean).join(' ').toLowerCase().includes(q)});
    return `<div class="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 mb-4">This shows how supplier PO items are allocated to customer SR items. Create the SR first, then use <b>Link PO Items</b> from the expanded SR in Sales Tracking.</div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(x=>{const so=x.sales_order_items?.sales_orders,pi=x.supplier_po_items?.supplier_pos;return `<div class="pw-row grid lg:grid-cols-[1.2fr_1.4fr_40px_1.2fr_1.4fr_90px] gap-3 items-center"><div><b>${esc(so?.sr_no||so?.order_no||'SR')}</b><div class="pw-mini">${esc(so?.customers?.name||'')}</div></div><div><div class="text-xs font-bold">${esc(x.sales_order_items?.product_code_snapshot||'')}</div><div class="text-xs text-gray-500">${esc(x.sales_order_items?.item_name_snapshot||'')}</div></div><div class="text-center">→</div><div><b>${esc(poLabel(pi))}</b><div class="pw-mini">${esc(pi?.vendor_name||'')}</div></div><div><div class="text-xs font-bold">${esc(x.supplier_po_items?.product_code_snapshot||'')}</div><div class="text-xs text-gray-500">${esc(x.supplier_po_items?.item_name_snapshot||'')}</div></div><div class="text-right text-xs">Qty <b>${Number(x.qty_allocated||0)}</b></div></div>`}).join(''):empty('No SR allocations yet.')}</div></div>`;
  }

  window.syncSupplierPaymentCurrency=function(){
    const pos=window._procurementPOOptions||[];
    const poId=document.getElementById('spPO')?.value||'';
    const type=document.getElementById('spType')?.value||'deposit';
    const po=pos.find(x=>String(x.id)===String(poId));
    const cur=type==='shipping'?'USD':String(po?.currency||'USD').toUpperCase();
    const el=document.getElementById('spCurrency');if(el)el.value=cur;
    const hint=document.getElementById('spCurrencyHint');
    if(hint)hint.textContent=type==='shipping'?'Shipping payments are always USD.':`Uses the PO currency: ${cur}.`;
  };
  window.openSupplierPayment=function(preselectPOId=null,returnToManage=false){
    const pos=window._procurementPOOptions||[];
    if(!pos.length)return showToast('Create a Supplier PO first.','err');
    const requested=preselectPOId&&pos.some(p=>String(p.id)===String(preselectPOId))?String(preselectPOId):String(pos[0]?.id||'');
    openModal('Record Supplier Payment',`<form id="supplierPaymentForm" class="grid md:grid-cols-2 gap-4"><div class="md:col-span-2"><label class="text-xs font-semibold">Supplier PO</label><select id="spPO" onchange="syncSupplierPaymentCurrency()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">${pos.map(p=>`<option value="${p.id}" ${String(p.id)===requested?'selected':''}>${esc(poLabel(p))} · ${esc(p.vendor_name||'')}</option>`).join('')}</select></div><div><label class="text-xs font-semibold">Payment Type</label><select id="spType" onchange="syncSupplierPaymentCurrency()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="deposit">Deposit</option><option value="balance">Balance</option><option value="shipping">Shipping</option><option value="other">Other</option></select></div><div><label class="text-xs font-semibold">Payment Date</label><input id="spDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Amount</label><input id="spAmount" type="number" min="0.01" step="0.01" required class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Currency</label><input id="spCurrency" readonly class="mt-1 w-full border rounded-xl px-3 py-2 bg-gray-50 font-semibold"><div id="spCurrencyHint" class="text-[10px] text-gray-400 mt-1"></div></div><div><label class="text-xs font-semibold">Reference No.</label><input id="spRef" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Note</label><input id="spNote" class="mt-1 w-full border rounded-xl px-3 py-2"></div><button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Payment</button></form>`);
    syncSupplierPaymentCurrency();
    document.getElementById('supplierPaymentForm').onsubmit=async e=>{
      e.preventDefault();
      const selectedPO=document.getElementById('spPO').value;
      const row={supplier_po_id:selectedPO,payment_type:document.getElementById('spType').value,payment_date:document.getElementById('spDate').value,amount:Number(document.getElementById('spAmount').value||0),currency:document.getElementById('spCurrency').value,reference_no:document.getElementById('spRef').value.trim()||null,notes:document.getElementById('spNote').value.trim()||null,created_by:state.user.id};
      const x=await db.from('supplier_payments').insert(row);
      if(x.error)return showToast(x.error.message,'err');
      closeModal();showToast('Supplier payment recorded');
      if(returnToManage){await openManageSupplierPO(selectedPO);return}
      pw.tab='payments';await renderProcurementWorkspace();
    };
  };

  function poManageStatusLabel(v){
    const s=String(v||'placed').toLowerCase();
    return s==='placed'?'Ordered':titleCase(s);
  }

  window.saveManagePOStatus=async function(id){
    const status=document.getElementById('managePOStatus')?.value||'placed';
    const eta=document.getElementById('managePOEta')?.value||null;
    const patch={status,estimated_arrival:eta,updated_at:new Date().toISOString()};
    if(['arrived','delivered'].includes(status)){
      const current=(window._procurementPOOptions||[]).find(x=>String(x.id)===String(id));
      patch.actual_arrival=current?.actual_arrival||new Date().toISOString().slice(0,10);
    }
    const {error}=await db.from('supplier_pos').update(patch).eq('id',id);
    if(error)return showToast(error.message,'err');
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    showToast('PO status / ETA updated');
    await load();
    await renderProcurementWorkspace();
    await openManageSupplierPO(id);
  };

  window.openManageSupplierPO=async function(id){
    openModal('Manage Supplier PO','<div class="py-14 text-center text-sm text-gray-400">Loading PO...</div>');
    try{
      const [poRes,summaryRes,itemRes,payRes]=await Promise.all([
        db.from('supplier_pos').select('*').eq('id',id).single(),
        db.from('supplier_po_summary').select('*').eq('id',id).maybeSingle(),
        db.from('supplier_po_items').select('id,product_code_snapshot,item_name_snapshot,qty,unit_cost,shipping_cost,shipping_currency,procurement_status,image_url_snapshot,sort_order,created_at').eq('supplier_po_id',id).order('sort_order',{ascending:true,nullsFirst:false}).order('created_at',{ascending:true}),
        db.from('supplier_payments').select('id,payment_type,payment_date,amount,currency,reference_no,notes,created_at').eq('supplier_po_id',id).order('payment_date',{ascending:false}).order('created_at',{ascending:false})
      ]);
      if(poRes.error)throw poRes.error;
      if(summaryRes.error)throw summaryRes.error;
      if(itemRes.error)throw itemRes.error;
      if(payRes.error)throw payRes.error;

      const p=poRes.data;
      const s=summaryRes.data||{};
      const items=itemRes.data||[];
      const payments=payRes.data||[];
      const qty=items.reduce((a,x)=>a+Number(x.qty||0),0);
      const label=poLabel(p);
      const goodsBalance=Number(s.balance_due||0);
      const shippingBalance=Number(s.shipping_balance_usd||0);

      const paymentHtml=payments.length?payments.map(x=>`<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2 border-b last:border-0">
        <div><div class="text-xs font-semibold">${esc(fmtDate(x.payment_date))} · ${esc(titleCase(x.payment_type||'payment'))}</div><div class="text-[10px] text-gray-400">${esc(x.reference_no||x.notes||'No reference')}</div></div>
        <b class="text-green-600 text-sm">${money(Number(x.amount||0),x.currency||p.currency||'USD')}</b>
      </div>`).join(''):'<div class="py-4 text-center text-xs text-gray-400">No supplier payments recorded yet.</div>';

      const itemHtml=items.length?items.slice(0,8).map(i=>`<div class="flex items-center gap-3 py-2 border-b last:border-0">
        <div class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">${i.image_url_snapshot?`<img src="${esc(i.image_url_snapshot)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
        <div class="min-w-0 flex-1"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(i.product_code_snapshot||'')}</div><div class="text-xs truncate">${esc(i.item_name_snapshot||'Item')}</div></div>
        <div class="text-right"><b class="text-xs">${Number(i.qty||0).toLocaleString()}x</b><div class="text-[9px] text-gray-400">${esc(poManageStatusLabel(i.procurement_status||p.status))}</div></div>
      </div>`).join(''):'<div class="py-4 text-center text-xs text-gray-400">No PO items yet.</div>';

      const html=`<div class="space-y-5">
        <div class="rounded-2xl border bg-[#faf9f6] p-4">
          <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <div class="flex flex-wrap items-center gap-2"><b class="text-lg">${esc(label)}</b><span class="lr-badge ${statusBadge(p.status)}">${esc(poManageStatusLabel(p.status))}</span></div>
              <div class="text-sm font-semibold mt-2">${esc(p.vendor_name||'-')}</div>
              <div class="text-[10px] text-gray-400 mt-1">Ordered: ${esc(fmtDate(p.order_date))} · Currency: ${esc(p.currency||'USD')}${p.shipping_agent?' · Shipping: '+esc(p.shipping_agent):''}</div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button onclick="openSupplierPayment('${p.id}',true)" class="px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold">+ Record Payment</button>
              ${typeof openReceivePOForPO==='function'? `<button onclick="openReceivePOForPO('${p.id}')" class="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-semibold">Receive Stock</button>`:''}
              <button onclick="openEditSupplierPO('${p.id}')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">Edit Items / PO</button>
              ${p.po_document_path?`<button onclick="viewPODocument('${p.id}')" class="px-3 py-2 rounded-lg border border-blue-200 bg-white text-blue-600 text-xs font-semibold">PO Document</button>`:''}
            </div>
          </div>
        </div>

        <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div class="rounded-xl border p-3 bg-white"><div class="text-[9px] uppercase font-bold text-gray-400">Goods Total</div><div class="text-lg font-bold mt-1">${money(Number(s.po_total||0),p.currency||'USD')}</div></div>
          <div class="rounded-xl border p-3 bg-white"><div class="text-[9px] uppercase font-bold text-gray-400">Supplier Paid</div><div class="text-lg font-bold mt-1 text-green-600">${money(Number(s.amount_paid||0),p.currency||'USD')}</div></div>
          <div class="rounded-xl border p-3 ${goodsBalance>0?'bg-red-50 border-red-100':'bg-green-50 border-green-100'}"><div class="text-[9px] uppercase font-bold text-gray-400">Goods Balance</div><div class="text-lg font-bold mt-1 ${goodsBalance>0?'text-red-600':'text-green-600'}">${money(goodsBalance,p.currency||'USD')}</div></div>
          <div class="rounded-xl border p-3 ${shippingBalance>0?'bg-amber-50 border-amber-100':'bg-white'}"><div class="text-[9px] uppercase font-bold text-gray-400">Shipping Balance</div><div class="text-lg font-bold mt-1 ${shippingBalance>0?'text-amber-700':'text-green-600'}">${money(shippingBalance,'USD')}</div><div class="text-[9px] text-gray-400 mt-1">Shipping cost ${money(Number(s.shipping_total_usd||0),'USD')}</div></div>
        </div>

        <div class="grid lg:grid-cols-[1fr_1fr] gap-4">
          <div class="rounded-2xl border bg-white p-4">
            <div class="flex items-center justify-between mb-3"><div><h4 class="font-bold">Status & ETA</h4><div class="text-[10px] text-gray-400">Quickly update the PO without opening the Shipping tab.</div></div></div>
            <div class="grid sm:grid-cols-2 gap-3">
              <div><label class="text-xs font-semibold">PO Status</label><select id="managePOStatus" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${[['placed','Ordered'],['production','Production'],['shipping','Shipping'],['arrived','Arrived'],['delivered','Delivered']].map(([v,l])=>`<option value="${v}" ${p.status===v?'selected':''}>${l}</option>`).join('')}</select></div>
              <div><label class="text-xs font-semibold">ETA</label><input id="managePOEta" type="date" value="${esc(p.estimated_arrival||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
              <button onclick="saveManagePOStatus('${p.id}')" class="sm:col-span-2 bg-[#211d18] text-white rounded-xl py-2.5 text-xs font-semibold">Save Status / ETA</button>
            </div>
          </div>

          <div class="rounded-2xl border bg-white p-4">
            <div class="flex items-center justify-between mb-3"><div><h4 class="font-bold">Ordered Quantity</h4><div class="text-[10px] text-gray-400">Current PO item summary.</div></div><button onclick="openEditSupplierPO('${p.id}')" class="text-[10px] font-semibold text-[#a77d1a]">Manage items →</button></div>
            <div class="grid grid-cols-2 gap-3"><div class="rounded-xl bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Item Lines</div><div class="text-xl font-bold mt-1">${items.length}</div></div><div class="rounded-xl bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Total Qty</div><div class="text-xl font-bold mt-1">${qty.toLocaleString()}</div></div></div>
            <div class="mt-3 max-h-[250px] overflow-auto">${itemHtml}${items.length>8?`<div class="text-center text-[10px] text-gray-400 pt-2">+${items.length-8} more item lines · use Edit Items / PO to view all</div>`:''}</div>
          </div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="flex items-center justify-between gap-3 mb-3"><div><h4 class="font-bold">Payment History</h4><div class="text-[10px] text-gray-400">Deposit, balance, shipping and other supplier payments.</div></div><button onclick="openSupplierPayment('${p.id}',true)" class="px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700 text-xs font-semibold">+ Payment</button></div>
          <div>${paymentHtml}</div>
        </div>
      </div>`;

      document.getElementById('modalBody').innerHTML=html;
    }catch(err){
      const body=document.getElementById('modalBody');
      if(body)body.innerHTML=`<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-600 text-sm">Error: ${esc(err.message)}</div>`;
      else showToast(err.message,'err');
    }
  };


  function orderedStage(v){
    const s=norm(v||'placed');
    if(['arrived','closed','completed','delivered'].includes(s))return 'completed';
    if(s==='shipping')return 'shipping';
    if(s==='production')return 'production';
    return 'placed';
  }
  function orderedStageLabel(v){
    const s=orderedStage(v);
    return s==='placed'?'Ordered':s==='production'?'In Production':s==='shipping'?'Shipping':'Arrived';
  }
  function orderedQty(v){
    const x=Number(v||0);
    return x.toLocaleString(undefined,{maximumFractionDigits:0});
  }
  function orderedImage(url){
    if(!url)return '<div class="w-full h-full bg-gray-100 flex items-center justify-center text-[8px] text-gray-400">No Photo</div>';
    return '<img src="'+esc(url)+'" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div style="display:none" class="w-full h-full bg-gray-100 items-center justify-center text-[8px] text-gray-400">No Photo</div>';
  }
  function procOrderedStatusBadge(s){
    s=orderedStage(s);
    return s==='completed'?'lr-badge-green':s==='shipping'?'lr-badge-blue':s==='production'?'lr-badge-amber':'lr-badge-gray';
  }
  window.setProcOrderedStatus=function(v){pw.orderedStatus=v;renderProcurementWorkspace()};
  window.toggleProcOrderedPO=function(id){
    id=String(id||'');
    if(pw.orderedExpanded.has(id))pw.orderedExpanded.delete(id);else pw.orderedExpanded.add(id);
    renderProcurementWorkspace();
  };

  async function renderPOOrderedItems(){
    const r=await db.rpc('get_sales_po_ordered_items');
    if(r.error)throw r.error;
    const all=r.data||[];
    const q=norm(pw.search);
    const rows=all.filter(taxProcurementMatches).filter(i=>{
      const stage=orderedStage(i.item_status||i.po_status);
      if(pw.orderedStatus!=='all'&&stage!==pw.orderedStatus)return false;
      if(!q)return true;
      const allocations=Array.isArray(i.allocations)?i.allocations:[];
      const hay=[
        i.po_number,i.po_pending_reference,i.vendor_name,i.product_code,i.item_name,i.brand,i.product_class,
        ...allocations.flatMap(a=>[a.customer_name,a.customer_code,a.order_ref,a.sales_rep_name])
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });

    const totals={
      all:all.length,
      placed:all.filter(i=>orderedStage(i.item_status||i.po_status)==='placed').length,
      production:all.filter(i=>orderedStage(i.item_status||i.po_status)==='production').length,
      shipping:all.filter(i=>orderedStage(i.item_status||i.po_status)==='shipping').length,
      completed:all.filter(i=>orderedStage(i.item_status||i.po_status)==='completed').length
    };
    const chips=[
      ['all','All',totals.all],['placed','Ordered',totals.placed],['production','Production',totals.production],
      ['shipping','Shipping',totals.shipping],['completed','Arrived',totals.completed]
    ].map(([v,l,n])=>'<button onclick="setProcOrderedStatus(\''+v+'\')" class="px-3 py-2 rounded-xl border text-xs font-semibold '+(pw.orderedStatus===v?'bg-amber-50 border-amber-200 text-[#8a5a00]':'bg-white')+'">'+l+' <b>'+n+'</b></button>').join('');

    const groups=new Map();
    rows.forEach(i=>{
      const key=String(i.po_id||i.po_number||i.po_pending_reference||'unknown');
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(i);
    });

    const cards=[...groups.entries()].map(([key,items])=>{
      const p=items[0]||{};
      const open=pw.orderedExpanded.has(key);
      const qty=items.reduce((a,x)=>a+Number(x.qty||0),0);
      const allocated=items.reduce((a,x)=>a+Number(x.allocated_qty||0),0);
      const stock=items.reduce((a,x)=>a+Number(x.unallocated_qty||0),0);
      const po=poLabel(p);
      const details=items.map(i=>{
        const allocations=Array.isArray(i.allocations)?i.allocations:[];
        const allocationRows=allocations.map(a=>'<div class="flex items-center justify-between gap-3 py-1 border-b last:border-0"><div class="min-w-0"><div class="text-[11px] font-semibold truncate">'+esc(a.customer_name||'Customer')+'</div><div class="pw-mini truncate">'+esc(a.order_ref||'Sales Order')+(a.sales_rep_name?' · '+esc(a.sales_rep_name):'')+'</div></div><b class="text-[11px] whitespace-nowrap">'+orderedQty(a.qty_allocated)+' pcs</b></div>').join('');
        return '<div class="pw-card grid md:grid-cols-[64px_1.5fr_100px_1.2fr] gap-3 items-start">'+
          '<div class="w-16 h-16 rounded-xl overflow-hidden border bg-gray-100">'+orderedImage(i.image_url)+'</div>'+
          '<div><div class="text-[10px] font-bold text-[#a77d1a]">'+esc(i.product_code||'No Code')+taxBadge(i)+'</div><div class="font-semibold text-sm mt-0.5">'+esc(i.item_name||'Item')+'</div><div class="pw-mini mt-1">'+[i.brand,i.product_class].filter(Boolean).map(esc).join(' · ')+'</div></div>'+
          '<div class="text-xs"><div>Qty <b>'+orderedQty(i.qty)+'</b></div><div class="pw-mini mt-1">'+esc(orderedStageLabel(i.item_status||i.po_status))+'</div><div class="pw-mini">'+(i.estimated_arrival?'ETA '+esc(fmtDate(i.estimated_arrival)):'ETA TBD')+'</div></div>'+
          '<div class="rounded-xl border bg-[#faf9f6] px-3 py-2"><div class="text-[9px] uppercase font-bold text-gray-500 mb-1">Customer Allocation</div>'+
            (allocationRows||'<div class="text-[10px] text-gray-400">No customer allocation. Stock / unallocated: '+orderedQty(i.unallocated_qty)+'</div>')+
            (Number(i.unallocated_qty||0)>0?'<div class="pt-1 mt-1 border-t border-dashed flex justify-between text-[10px]"><span>Stock / Unallocated</span><b>'+orderedQty(i.unallocated_qty)+'</b></div>':'')+
          '</div>'+
        '</div>';
      }).join('');

      return '<div class="pw-card p-0 overflow-hidden">'+
        '<button type="button" onclick="toggleProcOrderedPO(\''+esc(key)+'\')" class="w-full text-left p-4 flex items-start justify-between gap-3 hover:bg-amber-50/30">'+
          '<div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><b class="text-base">'+esc(po)+'</b><span class="lr-badge '+procOrderedStatusBadge(p.po_status)+'">'+esc(orderedStageLabel(p.po_status))+'</span><span class="lr-badge lr-badge-gray">'+items.length+' item line'+(items.length===1?'':'s')+'</span><span class="lr-badge lr-badge-gray">Total Qty '+orderedQty(qty)+'</span><span class="lr-badge lr-badge-blue">Allocated '+orderedQty(allocated)+'</span>'+(stock>0?'<span class="lr-badge lr-badge-gray">Stock '+orderedQty(stock)+'</span>':'')+'</div>'+
          '<div class="text-xs mt-2"><span class="text-gray-400">Supplier:</span> <b>'+esc(p.vendor_name||'-')+'</b></div><div class="pw-mini mt-1">Ordered '+esc(fmtDate(p.order_date))+' · ETA '+esc(fmtDate(p.estimated_arrival))+'</div></div>'+
          '<span class="text-[10px] text-gray-400 whitespace-nowrap">'+(open?'Hide items':'View items')+'</span>'+
        '</button>'+
        (open?'<div class="border-t bg-[#fcfbf8] p-3 grid gap-3">'+details+'</div>':'')+
      '</div>';
    }).join('');

    return '<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 mb-4 text-xs text-blue-800"><b>Incoming PO visibility:</b> grouped by Supplier PO with product photos, ordered quantity, ETA, customer allocation and unallocated stock. Supplier cost and payment figures stay in the other Procurement tabs.</div>'+
      '<div class="flex flex-wrap gap-2 mb-4">'+chips+'</div>'+
      '<div class="grid gap-3">'+(cards||'<div class="card rounded-xl p-8 text-center text-gray-400">No PO ordered items match this filter.</div>')+'</div>';
  }

  window.saveProcShipping=async function(id){const status=document.getElementById('status-'+id)?.value,eta=document.getElementById('eta-'+id)?.value||null;const patch={status,estimated_arrival:eta};if(['arrived','delivered'].includes(status))patch.actual_arrival=new Date().toISOString().slice(0,10);const r=await db.from('supplier_pos').update(patch).eq('id',id);if(r.error)return showToast(r.error.message,'err');if(window.documentFlowState)window.documentFlowState.loaded=false;showToast('Shipping / ETA updated');await load();await renderProcurementWorkspace()};

  window.renderProcurementWorkspace=async function(){
    inject();requireAdmin();
    const tabs=[['pos','Supplier POs'],['ordered','PO Ordered Items'],['items','PO Items'],['payments','Supplier Payments'],['shipping','Shipping / ETA'],['allocations','SR Allocations'],['flow','PO → SR → TK/RK']];
    let action='';
    if(pw.tab==='pos')action=`<div class="flex flex-wrap gap-2 justify-end"><button onclick="openBulkPOImport()" class="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-sm font-semibold">Bulk Import Excel</button><button onclick="openNewSupplierPO()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm font-semibold">+ Supplier PO</button></div>`;
    if(pw.tab==='payments')action=`<button onclick="openSupplierPayment()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm font-semibold">+ Supplier Payment</button>`;
    document.getElementById('content').innerHTML=`<div class="max-w-[1500px] mx-auto"><div class="pw-tabs">${tabs.map(([v,l])=>`<button class="pw-tab ${pw.tab===v?'active':''}" onclick="setProcurementTab('${v}')">${l}</button>`).join('')}</div><div class="pw-toolbar"><div><input class="pw-search" value="${esc(pw.search)}" oninput="setProcurementSearch(this.value)" placeholder="Search PO, supplier, SKU, SR, customer..."></div><div>${action}</div></div><div id="procurementWorkspaceBody"><div class="py-16 text-center text-gray-400">Loading...</div></div></div>`;
    try{
      let html='';
      if(pw.tab==='pos')html=await renderPOs();
      else if(pw.tab==='items')html=await renderPOItems();
      else if(pw.tab==='payments')html=await renderPayments();
      else if(pw.tab==='shipping')html=await renderShipping();
      else if(pw.tab==='allocations')html=await renderAllocations();
      else if(pw.tab==='flow'&&typeof renderProcurementDocumentFlow==='function')html=await renderProcurementDocumentFlow(pw.search);
      else html='<div class="card rounded-xl p-5 text-gray-400">Document flow is unavailable.</div>';
      document.getElementById('procurementWorkspaceBody').innerHTML=html;
    }catch(err){document.getElementById('procurementWorkspaceBody').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
  };

  // Existing router already calls renderSupplierPOs for Procurement. Point it to this workspace.
  window.renderSupplierPOs=window.renderProcurementWorkspace;

  // Keep the page title clear even if an old internal link still uses supplier-pos.
  const prevGo=window.go;
  window.go=async function(page){
    if(page==='supplier-pos')page='procurement';
    const r=await prevGo(page);
    if(page==='procurement'){
      document.getElementById('pageTitle').textContent='Procurement';
      document.getElementById('pageSubtitle').textContent='Supplier POs, PO items, payments, shipping, ETA, SR allocations and PO → SR → TK/RK flow';
    }
    return r;
  };

  inject();
  try{if(state?.profile)renderNav()}catch(_){ }
})();