// Consolidated Procurement workspace: Supplier POs, PO Items, Supplier Payments, Shipping/ETA, SR Allocations.
// Loaded after document-flow.js, po-edit.js, and flow-refresh-fix.js.

(function(){
  const pw={tab:'pos',search:''};
  window.procurementWorkspace=pw;

  function norm(v=''){return String(v||'').trim().toLowerCase()}
  function fmtDate(v){if(!v)return 'TBD';const d=new Date(String(v).length<=10?v+'T00:00:00':v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
  function poLabel(p){return p?.po_number||p?.po_pending_reference||'PO Pending'}
  function statusBadge(s){s=norm(s);return s==='arrived'?'lr-badge-green':s==='shipping'?'lr-badge-blue':s==='production'?'lr-badge-amber':'lr-badge-gray'}
  function requireAdmin(){if(!isAdmin())throw new Error('Procurement is available to Admin and Super Admin only.')}

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
    const total=rows.reduce((a,p)=>a+Number(p.po_total||0),0),paid=rows.reduce((a,p)=>a+Number(p.amount_paid||0),0),bal=rows.reduce((a,p)=>a+Number(p.balance_due||0),0);
    return `<div class="grid sm:grid-cols-3 gap-3 mb-4"><div class="pw-stat"><div class="pw-stat-label">PO Value</div><div class="pw-stat-value">${money(total)}</div></div><div class="pw-stat"><div class="pw-stat-label">Supplier Paid</div><div class="pw-stat-value text-green-600">${money(paid)}</div></div><div class="pw-stat"><div class="pw-stat-label">Supplier Balance</div><div class="pw-stat-value text-red-500">${money(bal)}</div></div></div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(p=>`<div class="pw-row grid lg:grid-cols-[1.1fr_1.2fr_110px_135px_140px] gap-3 items-center"><div><b>${esc(poLabel(p))}</b><div class="pw-mini">${esc(p.order_date||'')}</div></div><div><div class="text-sm font-semibold">${esc(p.vendor_name||'-')}</div><div class="pw-mini">${esc(p.shipping_agent||'No shipping agent')}</div></div><span class="lr-badge ${statusBadge(p.status)}">${esc(titleCase(p.status||'placed'))}</span><div class="text-xs">ETA <b>${esc(fmtDate(p.estimated_arrival))}</b><div class="pw-mini">Balance ${money(p.balance_due,p.currency||'USD')}</div></div><div class="flex gap-2 justify-end flex-wrap"><button onclick="openEditSupplierPO('${p.id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Edit / Items</button>${p.po_document_path?`<button onclick="viewPODocument('${p.id}')" class="px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-[10px] font-semibold">Document</button>`:''}<button onclick="deleteSupplierPO('${p.id}','${esc(poLabel(p))}')" class="px-3 py-2 border border-red-200 bg-red-50 text-red-600 rounded-lg text-[10px] font-semibold">Delete</button></div></div>`).join(''):empty('No supplier POs yet.')}</div></div>`;
  }

  async function renderPOItems(){
    const r=await db.from('supplier_po_items').select('id,supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,qty,unit_cost,shipping_cost,created_at,supplier_pos(id,po_number,po_pending_reference,vendor_name,currency,status,estimated_arrival)').order('created_at',{ascending:false});
    if(r.error)throw r.error;const q=pw.search.toLowerCase();const rows=(r.data||[]).filter(i=>!q||[i.product_code_snapshot,i.item_name_snapshot,poLabel(i.supplier_pos),i.supplier_pos?.vendor_name].filter(Boolean).join(' ').toLowerCase().includes(q));
    return `<div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(i=>`<div class="pw-row grid md:grid-cols-[1.2fr_1.7fr_90px_120px_130px] gap-3 items-center"><div><b>${esc(poLabel(i.supplier_pos))}</b><div class="pw-mini">${esc(i.supplier_pos?.vendor_name||'')}</div></div><div><div class="text-xs font-bold text-[#a77d1a]">${esc(i.product_code_snapshot)}</div><div class="text-sm">${esc(i.item_name_snapshot)}</div></div><div class="text-sm">Qty <b>${Number(i.qty||0)}</b></div><div class="text-xs">Cost <b>${money(i.unit_cost,i.supplier_pos?.currency||'USD')}</b><div class="pw-mini">Shipping ${money(i.shipping_cost,i.supplier_pos?.currency||'USD')}</div></div><div class="text-right"><button onclick="openEditSupplierPO('${i.supplier_po_id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Manage PO</button></div></div>`).join(''):empty('No PO items yet. Add items from a Supplier PO.')}</div></div>`;
  }

  async function renderPayments(){
    const [pr,por]=await Promise.all([
      db.from('supplier_payments').select('id,supplier_po_id,payment_type,payment_date,amount,currency,reference_no,notes,created_at,supplier_pos(id,po_number,po_pending_reference,vendor_name)').order('payment_date',{ascending:false}),
      db.from('supplier_pos').select('id,po_number,po_pending_reference,vendor_name,currency').order('created_at',{ascending:false})
    ]);if(pr.error)throw pr.error;if(por.error)throw por.error;window._procurementPOOptions=por.data||[];
    const q=pw.search.toLowerCase();const rows=(pr.data||[]).filter(p=>!q||[poLabel(p.supplier_pos),p.supplier_pos?.vendor_name,p.payment_type,p.reference_no,p.notes].filter(Boolean).join(' ').toLowerCase().includes(q));
    const total=rows.reduce((a,p)=>a+Number(p.amount||0),0);
    return `<div class="pw-stat mb-4"><div class="pw-stat-label">Payments Shown</div><div class="pw-stat-value text-green-600">${money(total)}</div></div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(p=>`<div class="pw-row grid md:grid-cols-[1fr_1fr_110px_130px_1fr] gap-3 items-center"><div><b>${esc(poLabel(p.supplier_pos))}</b><div class="pw-mini">${esc(p.supplier_pos?.vendor_name||'')}</div></div><div class="text-sm">${esc(fmtDate(p.payment_date))}</div><span class="lr-badge lr-badge-gray">${esc(titleCase(p.payment_type||'other'))}</span><div class="font-bold text-green-600">${money(p.amount,p.currency||'USD')}</div><div class="text-xs text-gray-500">${esc(p.reference_no||p.notes||'-')}</div></div>`).join(''):empty('No supplier payments yet.')}</div></div>`;
  }

  async function renderShipping(){
    const r=await db.from('supplier_pos').select('*').order('estimated_arrival',{ascending:true,nullsFirst:false});if(r.error)throw r.error;
    const q=pw.search.toLowerCase();const rows=(r.data||[]).filter(p=>!q||[poLabel(p),p.vendor_name,p.status,p.shipping_agent].filter(Boolean).join(' ').toLowerCase().includes(q));
    return `<div class="pw-grid">${rows.length?rows.map(p=>`<div class="pw-card grid lg:grid-cols-[1.2fr_1fr_160px_170px_100px] gap-3 items-center"><div><div class="font-bold">${esc(poLabel(p))}</div><div class="pw-mini">${esc(p.vendor_name||'')}</div></div><div><span class="lr-badge ${statusBadge(p.status)}">${esc(titleCase(p.status||'placed'))}</span><div class="pw-mini mt-1">${esc(p.shipping_agent||'No shipping agent')}</div></div><div><label class="pw-mini">ETA</label><input id="eta-${p.id}" type="date" value="${esc(p.estimated_arrival||'')}" class="mt-1 w-full border rounded-lg px-2 py-2 text-xs"></div><div><label class="pw-mini">Status</label><select id="status-${p.id}" class="mt-1 w-full border rounded-lg px-2 py-2 text-xs bg-white">${['placed','production','shipping','arrived'].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${titleCase(s)}</option>`).join('')}</select></div><button onclick="saveProcShipping('${p.id}')" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">Save</button></div>`).join(''):'<div class="card rounded-2xl">'+empty('No supplier POs to track yet.')+'</div>'}</div>`;
  }

  async function renderAllocations(){
    const r=await db.from('fulfillment_links').select('id,qty_allocated,created_at,sales_order_items!inner(id,product_code_snapshot,item_name_snapshot,sales_orders!inner(id,order_no,sr_no,customer_id,customers(name))),supplier_po_items!inner(id,product_code_snapshot,item_name_snapshot,supplier_pos!inner(id,po_number,po_pending_reference,vendor_name,status,estimated_arrival))').order('created_at',{ascending:false});
    if(r.error)throw r.error;const q=pw.search.toLowerCase();const rows=(r.data||[]).filter(x=>{const so=x.sales_order_items?.sales_orders,pi=x.supplier_po_items?.supplier_pos;return !q||[so?.sr_no,so?.order_no,so?.customers?.name,x.sales_order_items?.product_code_snapshot,x.sales_order_items?.item_name_snapshot,poLabel(pi),x.supplier_po_items?.product_code_snapshot].filter(Boolean).join(' ').toLowerCase().includes(q)});
    return `<div class="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 mb-4">This shows how supplier PO items are allocated to customer SR items. Create the SR first, then use <b>Link PO Items</b> from the expanded SR in Sales Tracking.</div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(x=>{const so=x.sales_order_items?.sales_orders,pi=x.supplier_po_items?.supplier_pos;return `<div class="pw-row grid lg:grid-cols-[1.2fr_1.4fr_40px_1.2fr_1.4fr_90px] gap-3 items-center"><div><b>${esc(so?.sr_no||so?.order_no||'SR')}</b><div class="pw-mini">${esc(so?.customers?.name||'')}</div></div><div><div class="text-xs font-bold">${esc(x.sales_order_items?.product_code_snapshot||'')}</div><div class="text-xs text-gray-500">${esc(x.sales_order_items?.item_name_snapshot||'')}</div></div><div class="text-center">→</div><div><b>${esc(poLabel(pi))}</b><div class="pw-mini">${esc(pi?.vendor_name||'')}</div></div><div><div class="text-xs font-bold">${esc(x.supplier_po_items?.product_code_snapshot||'')}</div><div class="text-xs text-gray-500">${esc(x.supplier_po_items?.item_name_snapshot||'')}</div></div><div class="text-right text-xs">Qty <b>${Number(x.qty_allocated||0)}</b></div></div>`}).join(''):empty('No SR allocations yet.')}</div></div>`;
  }

  window.openSupplierPayment=function(){
    const pos=window._procurementPOOptions||[];
    if(!pos.length)return showToast('Create a Supplier PO first.','err');
    openModal('Record Supplier Payment',`<form id="supplierPaymentForm" class="grid md:grid-cols-2 gap-4"><div class="md:col-span-2"><label class="text-xs font-semibold">Supplier PO</label><select id="spPO" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">${pos.map(p=>`<option value="${p.id}">${esc(poLabel(p))} · ${esc(p.vendor_name||'')}</option>`).join('')}</select></div><div><label class="text-xs font-semibold">Payment Type</label><select id="spType" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="deposit">Deposit</option><option value="balance">Balance</option><option value="shipping">Shipping</option><option value="other">Other</option></select></div><div><label class="text-xs font-semibold">Payment Date</label><input id="spDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Amount</label><input id="spAmount" type="number" min="0.01" step="0.01" required class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Currency</label><select id="spCurrency" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option>USD</option><option>EUR</option><option>CNY</option><option>GBP</option></select></div><div><label class="text-xs font-semibold">Reference No.</label><input id="spRef" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Note</label><input id="spNote" class="mt-1 w-full border rounded-xl px-3 py-2"></div><button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Payment</button></form>`);
    document.getElementById('supplierPaymentForm').onsubmit=async e=>{e.preventDefault();const row={supplier_po_id:document.getElementById('spPO').value,payment_type:document.getElementById('spType').value,payment_date:document.getElementById('spDate').value,amount:Number(document.getElementById('spAmount').value||0),currency:document.getElementById('spCurrency').value,reference_no:document.getElementById('spRef').value.trim()||null,notes:document.getElementById('spNote').value.trim()||null,created_by:state.user.id};const x=await db.from('supplier_payments').insert(row);if(x.error)return showToast(x.error.message,'err');closeModal();showToast('Supplier payment recorded');pw.tab='payments';await renderProcurementWorkspace()};
  };

  window.saveProcShipping=async function(id){const status=document.getElementById('status-'+id)?.value,eta=document.getElementById('eta-'+id)?.value||null;const patch={status,estimated_arrival:eta};if(status==='arrived')patch.actual_arrival=new Date().toISOString().slice(0,10);const r=await db.from('supplier_pos').update(patch).eq('id',id);if(r.error)return showToast(r.error.message,'err');if(window.documentFlowState)window.documentFlowState.loaded=false;showToast('Shipping / ETA updated');await renderProcurementWorkspace()};

  window.renderProcurementWorkspace=async function(){
    inject();requireAdmin();
    const tabs=[['pos','Supplier POs'],['items','PO Items'],['payments','Supplier Payments'],['shipping','Shipping / ETA'],['allocations','SR Allocations']];
    let action='';
    if(pw.tab==='pos')action=`<div class="flex flex-wrap gap-2 justify-end"><button onclick="openBulkPOImport()" class="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-sm font-semibold">Bulk Import Excel</button><button onclick="openNewSupplierPO()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm font-semibold">+ Supplier PO</button></div>`;
    if(pw.tab==='payments')action=`<button onclick="openSupplierPayment()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm font-semibold">+ Supplier Payment</button>`;
    document.getElementById('content').innerHTML=`<div class="max-w-[1500px] mx-auto"><div class="pw-tabs">${tabs.map(([v,l])=>`<button class="pw-tab ${pw.tab===v?'active':''}" onclick="setProcurementTab('${v}')">${l}</button>`).join('')}</div><div class="pw-toolbar"><div><input class="pw-search" value="${esc(pw.search)}" oninput="setProcurementSearch(this.value)" placeholder="Search PO, supplier, SKU, SR, customer..."></div><div>${action}</div></div><div id="procurementWorkspaceBody"><div class="py-16 text-center text-gray-400">Loading...</div></div></div>`;
    try{
      let html='';if(pw.tab==='pos')html=await renderPOs();else if(pw.tab==='items')html=await renderPOItems();else if(pw.tab==='payments')html=await renderPayments();else if(pw.tab==='shipping')html=await renderShipping();else html=await renderAllocations();document.getElementById('procurementWorkspaceBody').innerHTML=html;
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
      document.getElementById('pageSubtitle').textContent='Supplier POs, PO items, payments, shipping, ETA and SR allocations';
    }
    return r;
  };

  inject();
  try{if(state?.profile)renderNav()}catch(_){ }
})();