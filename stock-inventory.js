// Stock & Inventory workspace.
// Live ledger in Supabase; compact movement outbox is reserved for Google Sheet mirroring.
(function(){
  const inv={
    tab:'dashboard',
    search:'',
    locations:[],
    balances:[],
    balanceMap:new Map(),
    movementRows:[],
    poRows:[],
    poExpanded:new Set(),
    deliveryRows:[],
    limits:{balance:30,movements:30,receive:30,delivery:30,counts:30,reports:30,requests:30}
  };

  function role(){return state.profile?.role||''}
  function canView(){return ['stock_controller','accountant','manager','admin','super_admin'].includes(role())}
  function canOperate(){return ['stock_controller','admin','super_admin'].includes(role())}
  function canAdmin(){return ['admin','super_admin'].includes(role())}
  function canReconcile(){return canAdmin()}
  function isStockController(){return role()==='stock_controller'}
  function n(v){return Number(v||0)}
  function q(v){const x=n(v);return Number.isInteger(x)?x.toLocaleString():x.toLocaleString(undefined,{maximumFractionDigits:2})}
  function dateText(v){if(!v)return '-';const d=new Date(String(v).length<=10?v+'T00:00:00':v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
  function movementLabel(v){
    return ({
      opening:'Opening',in:'Stock In',out:'Stock Out',return:'Return',broken:'Broken',
      transfer:'Transfer',adjustment_in:'Adjustment +',adjustment_out:'Adjustment −',
      po_receipt:'PO Receipt',sale_delivery:'Customer Delivery'
    })[v]||titleCase(String(v||''));
  }
  function movementBadge(v){
    if(['in','return','adjustment_in','po_receipt','opening'].includes(v))return 'bg-green-50 text-green-700 border-green-200';
    if(['out','broken','adjustment_out','sale_delivery'].includes(v))return 'bg-red-50 text-red-700 border-red-200';
    if(v==='transfer')return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  }
  function locationOptions(selected='',blankLabel='Select location'){
    return `<option value="">${esc(blankLabel)}</option>${inv.locations.filter(x=>x.active).map(x=>`<option value="${x.id}" ${String(selected)===String(x.id)?'selected':''}>${esc(x.code)} · ${esc(x.name)}</option>`).join('')}`;
  }
  function productDisplay(p){return `${p.code||''} · ${p.item_name||''}`}
  function findProduct(value){
    const raw=String(value||'').trim().toLowerCase();if(!raw)return null;
    const code=raw.split(' · ')[0].trim();
    return inv.balances.find(x=>String(x.product_id)===raw)
      ||inv.balances.find(x=>String(x.code||'').toLowerCase()===code)
      ||inv.balances.find(x=>productDisplay(x).toLowerCase()===raw)
      ||null;
  }
  function productOptions(){
    return inv.balances.map(p=>`<option value="${esc(productDisplay(p))}"></option>`).join('');
  }

  async function loadCore(force=false){
    if(!canView())throw new Error('Inventory access required.');
    if(inv.locations.length&&inv.balances.length&&!force)return;
    const [locs,bals]=await Promise.all([
      db.from('stock_locations').select('*').order('sort_order').order('code'),
      db.from('inventory_product_balance').select('*').order('item_name')
    ]);
    if(locs.error)throw locs.error;if(bals.error)throw bals.error;
    inv.locations=locs.data||[];
    inv.balances=bals.data||[];
    inv.balanceMap=new Map(inv.balances.map(x=>[x.product_id,x]));
    window.inventoryBalanceMap=inv.balanceMap;
  }

  function injectStyles(){
    if(document.getElementById('inventory-workspace-css'))return;
    const st=document.createElement('style');st.id='inventory-workspace-css';st.textContent=`
      .inv-tabs{display:flex;gap:4px;overflow:auto;border-bottom:1px solid #e9e5de;margin-bottom:18px}
      .inv-tab{white-space:nowrap;padding:11px 13px;font-size:12px;font-weight:700;color:#8b8b95;border-bottom:2px solid transparent}
      .inv-tab.active{color:#171717;border-bottom-color:#b38b2e}
      .inv-toolbar{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-bottom:15px;flex-wrap:wrap}
      .inv-search{min-width:260px;max-width:520px;flex:1;border:1px solid #e4e4e7;border-radius:11px;padding:10px 13px;font-size:12px;background:#fff}
      .inv-stat{background:#fff;border:1px solid #eee8df;border-radius:14px;padding:14px}
      .inv-stat-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#a1a1aa;font-weight:800}
      .inv-stat-value{font-size:20px;font-weight:800;margin-top:5px}
      .inv-card{background:#fff;border:1px solid #ece8e0;border-radius:15px;padding:15px}
      @media(max-width:700px){.inv-search{max-width:none;width:100%}.inv-toolbar>*{width:100%}}
    `;document.head.appendChild(st);
  }

  function inventoryLimit(tab){return Number(inv.limits?.[tab]||30)}
  function resetInventoryLimit(tab){if(inv.limits&&tab)inv.limits[tab]=30}
  function inventoryListControls(tab,total){
    const shown=Math.min(total,inventoryLimit(tab));
    if(total<=30)return total?'<div class="mt-3 text-center text-[10px] text-gray-400">Showing '+shown+' of '+total+'</div>':'';
    const more=shown<total;
    return `<div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
      <span class="text-gray-400">Showing ${shown.toLocaleString()} of ${total.toLocaleString()}</span>
      ${more?`<button onclick="expandInventoryList('${tab}',false)" class="px-3 py-2 border rounded-xl font-semibold bg-white">Show 30 More</button><button onclick="expandInventoryList('${tab}',true)" class="px-3 py-2 border rounded-xl font-semibold bg-white">Show All</button>`:''}
      ${shown>30?`<button onclick="collapseInventoryList('${tab}')" class="px-3 py-2 border rounded-xl font-semibold bg-white">Show First 30</button>`:''}
    </div>`;
  }
  window.expandInventoryList=function(tab,all=false){inv.limits[tab]=all?999999:inventoryLimit(tab)+30;renderStockInventoryBody()};
  window.collapseInventoryList=function(tab){inv.limits[tab]=30;renderStockInventoryBody()};
  window.setInventoryTab=function(tab){inv.tab=tab;resetInventoryLimit(tab);renderStockInventory()};
  window.setInventorySearch=function(v){inv.search=v;resetInventoryLimit(inv.tab);renderStockInventoryBody()};

  function tabs(){
    const t=[['dashboard','Dashboard'],['balance','Stock Balance'],['movements','Movements'],['receive','Receive PO'],['delivery','Customer Delivery']];
    t.push(['counts','Stock Count'],['reports','Reports']);
    if(canAdmin()||isStockController())t.push(['requests',canAdmin()?'Edit Requests':'My Requests']);
    return t;
  }

  function topActions(){
    if(!canOperate())return '';
    return `<div class="flex gap-2 flex-wrap justify-end">
      <button onclick="openStockMovement()" class="px-3 py-2 border rounded-xl text-xs font-semibold">+ Movement</button>
      <button onclick="openStockTransfer()" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">⇄ Transfer</button>
    </div>`;
  }

  async function renderDashboard(){
    await loadCore(true);
    const onHand=inv.balances.reduce((a,x)=>a+n(x.on_hand),0);
    const reserved=inv.balances.reduce((a,x)=>a+n(x.reserved),0);
    const available=inv.balances.reduce((a,x)=>a+n(x.available),0);
    const incoming=inv.balances.reduce((a,x)=>a+n(x.incoming),0);
    const stocked=inv.balances.filter(x=>n(x.on_hand)>0).length;
    const noAvail=inv.balances.filter(x=>n(x.on_hand)>0&&n(x.available)<=0).length;

    const [mov,poQ,delQ]=await Promise.all([
      db.from('inventory_movement_history').select('*').neq('movement_type','opening').order('movement_date',{ascending:false}).order('created_at',{ascending:false}).limit(8),
      db.rpc('get_inventory_po_receiving_queue',{p_search:null}),
      db.rpc('get_inventory_delivery_queue',{p_search:null})
    ]);
    if(mov.error)throw mov.error;if(poQ.error)throw poQ.error;if(delQ.error)throw delQ.error;

    const recent=mov.data||[];
    return `<div class="grid sm:grid-cols-2 xl:grid-cols-6 gap-3 mb-5">
      <div class="inv-stat"><div class="inv-stat-label">On Hand</div><div class="inv-stat-value">${q(onHand)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Reserved</div><div class="inv-stat-value text-amber-600">${q(reserved)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Available</div><div class="inv-stat-value text-green-600">${q(available)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Incoming PO</div><div class="inv-stat-value text-blue-600">${q(incoming)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">SKUs In Stock</div><div class="inv-stat-value">${stocked.toLocaleString()}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Fully Reserved</div><div class="inv-stat-value ${noAvail?'text-red-500':''}">${noAvail.toLocaleString()}</div></div>
    </div>

    ${canOperate()?`<div class="grid md:grid-cols-2 gap-3 mb-5">
      <button onclick="setInventoryTab('receive')" class="inv-card text-left hover:shadow-sm"><div class="text-[9px] uppercase font-bold text-gray-400">Supplier Receiving Queue</div><div class="text-2xl font-bold mt-1">${(poQ.data||[]).length}</div><div class="text-xs text-blue-600 mt-2">PO item lines remaining to receive →</div></button>
      <button onclick="setInventoryTab('delivery')" class="inv-card text-left hover:shadow-sm"><div class="text-[9px] uppercase font-bold text-gray-400">Customer Delivery Queue</div><div class="text-2xl font-bold mt-1">${(delQ.data||[]).length}</div><div class="text-xs text-amber-700 mt-2">Tracked stock order lines awaiting release →</div></button>
    </div>`:''}

    <div class="grid xl:grid-cols-[1.2fr_.8fr] gap-4">
      <div class="inv-card">
        <div class="flex items-center justify-between gap-3 mb-3"><div><h3 class="font-bold">Recent Stock Movements</h3><div class="text-[10px] text-gray-400">Every balance-changing action is recorded here.</div></div><button onclick="setInventoryTab('movements')" class="text-xs font-semibold text-[#a77d1a]">View all →</button></div>
        <div class="divide-y">${recent.length?recent.map(m=>movementRow(m)).join(''):'<div class="py-8 text-center text-xs text-gray-400">No movements yet.</div>'}</div>
      </div>
      <div class="inv-card">
        <h3 class="font-bold">Stock Control Rules</h3>
        <div class="mt-3 grid gap-2 text-xs text-gray-600">
          <div class="rounded-xl bg-green-50 border border-green-100 p-3"><b>IN / PO Receipt / Return</b><br>Adds stock to a location.</div>
          <div class="rounded-xl bg-red-50 border border-red-100 p-3"><b>OUT / Broken / Customer Delivery</b><br>Removes stock from a location and blocks negative stock.</div>
          <div class="rounded-xl bg-blue-50 border border-blue-100 p-3"><b>Transfer</b><br>Moves the same quantity From → To as one atomic transaction.</div>
          <div class="rounded-xl bg-amber-50 border border-amber-100 p-3"><b>Month-end count</b><br>Physical and QB quantities are compared to the live system quantity before closing.</div>
        </div>
      </div>
    </div>`;
  }

  function balanceFiltered(){
    const s=String(inv.search||'').trim().toLowerCase();
    return inv.balances.filter(x=>!s||[
      x.code,x.item_name,x.brand,x.class,
      ...(Array.isArray(x.locations)?x.locations.map(l=>l.code):[])
    ].filter(Boolean).join(' ').toLowerCase().includes(s));
  }

  async function renderBalance(){
    await loadCore();
    const rows=balanceFiltered(),shown=rows.slice(0,inventoryLimit('balance'));
    return `<div class="card rounded-2xl overflow-hidden">
      <div class="divide-y">${shown.length?shown.map(p=>`<div class="p-4 grid xl:grid-cols-[1.7fr_85px_85px_85px_85px_1.5fr_165px] gap-3 items-center">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden shrink-0">${p.image_url?`<img src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
          <div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code)}</div><div class="font-semibold text-sm truncate">${esc(p.item_name)}</div><div class="text-[10px] text-gray-400">${esc(p.brand||'')}</div></div>
        </div>
        <div class="text-xs"><div class="text-gray-400">On Hand</div><b class="text-sm">${q(p.on_hand)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Reserved</div><b class="text-sm text-amber-600">${q(p.reserved)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Available</div><b class="text-sm ${n(p.available)<0?'text-red-600':'text-green-600'}">${q(p.available)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Incoming</div><b class="text-sm text-blue-600">${q(p.incoming)}</b></div>
        <div class="text-[10px] text-gray-500">${(p.locations||[]).filter(l=>n(l.qty)!==0).map(l=>`<span class="inline-flex mr-1 mb-1 px-2 py-1 rounded-lg border bg-gray-50"><b>${esc(l.code)}</b>&nbsp;${q(l.qty)}</span>`).join('')||'<span class="text-gray-400">No stock location</span>'}</div>
        <div class="flex gap-1.5 justify-end">${canOperate()?`<button onclick="openStockTransfer('${p.product_id}')" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-semibold">Move</button>`:''}<button onclick="openProductStockHistory('${p.product_id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">History</button></div>
      </div>`).join(''):'<div class="p-10 text-center text-sm text-gray-400">No products match your search.</div>'}</div>
      ${inventoryListControls('balance',rows.length)}
    </div>`;
  }

  function movementRow(m){
    const path=m.from_location&&m.to_location?`${m.from_location} → ${m.to_location}`:m.to_location?`→ ${m.to_location}`:m.from_location?`${m.from_location} →`:'-';
    const liveId=!m.legacy&&String(m.history_id||'').startsWith('live:')?String(m.history_id).slice(5):'';
    let actions='';
    if(canAdmin()){
      actions=`<div class="flex gap-1.5 flex-wrap justify-end"><button onclick="openAdminStockMovementEdit('${esc(m.history_id||'')}')" class="px-2 py-1.5 border rounded-lg text-[9px] font-semibold">Edit</button><button onclick="deleteStockMovementAdmin('${esc(m.history_id||'')}')" class="px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-[9px] font-semibold">Delete</button></div>`;
    }else if(isStockController()&&liveId){
      actions=`<div class="flex gap-1.5 flex-wrap justify-end"><button onclick="openStockMovementEditRequest('${liveId}')" class="px-2 py-1.5 border border-amber-200 bg-amber-50 text-amber-700 rounded-lg text-[9px] font-semibold">Request Edit</button><button onclick="requestStockMovementDelete('${liveId}')" class="px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-[9px] font-semibold">Request Delete</button></div>`;
    }
    return `<div class="py-3 grid md:grid-cols-[105px_1.45fr_110px_90px_1fr_150px] gap-3 items-center text-xs">
      <div><b>${esc(dateText(m.movement_date))}</b><div class="text-[9px] text-gray-400">${esc(m.created_by_name||'System')}${m.legacy?' · Historical':''}</div></div>
      <div><div class="text-[10px] font-bold text-[#a77d1a]">${esc(m.code||'')}</div><div class="font-semibold">${esc(m.item_name||'')}</div><div class="text-[9px] text-gray-400">${esc(m.reference_no||m.counterparty||'')}</div></div>
      <span class="px-2 py-1 rounded-lg border text-[9px] font-bold w-fit ${movementBadge(m.movement_type)}">${esc(movementLabel(m.movement_type))}</span>
      <div><b>${q(m.qty)}</b><div class="text-[9px] text-gray-400">${esc(path)}</div></div>
      <div class="text-[10px] text-gray-500">${esc(m.note||m.counterparty||'-')}</div>
      <div>${actions}</div>
    </div>`;
  }

  async function loadMovements(){
    const all=[];
    for(let from=0;from<10000;from+=1000){
      const r=await db.from('inventory_movement_history')
        .select('*')
        .neq('movement_type','opening')
        .order('movement_date',{ascending:false})
        .order('created_at',{ascending:false})
        .range(from,from+999);
      if(r.error)throw r.error;
      all.push(...(r.data||[]));
      if(!r.data||r.data.length<1000)break;
    }
    inv.movementRows=all;
  }

  function filteredMovements(){
    const s=String(inv.search||'').trim().toLowerCase();
    return inv.movementRows.filter(m=>!s||[
      m.code,m.item_name,m.brand,m.movement_type,m.from_location,m.to_location,
      m.reference_no,m.counterparty,m.note,m.created_by_name
    ].filter(Boolean).join(' ').toLowerCase().includes(s));
  }

  async function renderMovements(){
    await loadMovements();
    const rows=filteredMovements(),shown=rows.slice(0,inventoryLimit('movements'));
    return `<div class="inv-card"><div class="divide-y">${shown.length?shown.map(m=>movementRow(m)).join(''):'<div class="py-10 text-center text-xs text-gray-400">No movements found.</div>'}</div>${inventoryListControls('movements',rows.length)}</div>`;
  }

  window.toggleInventoryPOGroup=function(poId){
    if(inv.poExpanded.has(poId))inv.poExpanded.delete(poId);else inv.poExpanded.add(poId);
    renderStockInventoryBody();
  };

  async function renderReceive(){
    const r=await db.rpc('get_inventory_po_receiving_queue',{p_search:inv.search||null});
    if(r.error)throw r.error;inv.poRows=r.data||[];
    const grouped=new Map();
    for(const x of inv.poRows){
      const key=String(x.supplier_po_id||x.po_number||'');
      if(!grouped.has(key))grouped.set(key,{id:key,po_number:x.po_number||'PO',vendor_name:x.vendor_name||'',eta:x.eta,items:[]});
      grouped.get(key).items.push(x);
    }
    const groups=[...grouped.values()],shownGroups=groups.slice(0,inventoryLimit('receive'));
    return `<div class="grid gap-3">${shownGroups.length?shownGroups.map(g=>{
      const ordered=g.items.reduce((a,x)=>a+n(x.ordered_qty),0);
      const remaining=g.items.reduce((a,x)=>a+n(x.remaining_qty),0);
      const expanded=inv.poExpanded.has(g.id);
      return `<div class="inv-card p-0 overflow-hidden">
        <button type="button" onclick="toggleInventoryPOGroup('${esc(g.id)}')" class="w-full p-4 text-left grid lg:grid-cols-[1.4fr_130px_130px_150px] gap-4 items-center hover:bg-gray-50">
          <div><div class="flex flex-wrap items-center gap-2"><b class="text-base">${esc(g.po_number)}</b><span class="px-2 py-1 rounded-lg border bg-gray-50 text-[9px] font-semibold">${g.items.length} item line${g.items.length===1?'':'s'}</span></div><div class="text-xs text-gray-500 mt-1">${esc(g.vendor_name)}</div><div class="text-[9px] text-gray-400 mt-1">ETA ${esc(dateText(g.eta))}</div></div>
          <div class="text-xs"><div class="text-gray-400">Ordered Qty</div><b class="text-sm">${q(ordered)}</b></div>
          <div class="text-xs"><div class="text-gray-400">Remaining Qty</div><b class="text-sm text-blue-600">${q(remaining)}</b></div>
          <div class="text-right text-xs font-semibold text-[#a77d1a]">${expanded?'Hide Items ↑':'View / Receive Items ↓'}</div>
        </button>
        <div class="${expanded?'':'hidden'} border-t bg-[#faf9f6]">
          ${g.items.map(x=>`<div class="p-4 grid lg:grid-cols-[1.8fr_90px_100px_120px] gap-3 items-center border-b last:border-0">
            <div class="flex gap-3 items-center min-w-0"><div class="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">${x.image_url?`<img src="${esc(x.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(x.product_code||'')}</div><div class="text-sm font-semibold truncate">${esc(x.item_name||'')}</div></div></div>
            <div class="text-xs"><span class="text-gray-400">Ordered</span><br><b>${q(x.ordered_qty)}</b></div>
            <div class="text-xs"><span class="text-gray-400">Remaining</span><br><b class="text-blue-600">${q(x.remaining_qty)}</b></div>
            ${canOperate()?`<button onclick="openReceivePOItem('${x.supplier_po_item_id}')" class="px-3 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Receive Stock</button>`:'<span class="text-right text-[10px] text-gray-400">View only</span>'}
          </div>`).join('')}
        </div>
      </div>`;
    }).join(''):'<div class="inv-card py-12 text-center text-sm text-gray-400">No POs are waiting to be received.</div>'}${inventoryListControls('receive',groups.length)}</div>`;
  }

  async function renderDelivery(){
    const r=await db.rpc('get_inventory_delivery_queue',{p_search:inv.search||null});
    if(r.error)throw r.error;inv.deliveryRows=r.data||[];
    const shown=inv.deliveryRows.slice(0,inventoryLimit('delivery'));
    return `<div class="grid gap-3">${shown.length?shown.map(x=>`<div class="inv-card grid lg:grid-cols-[1.2fr_1.6fr_100px_110px_120px] gap-3 items-center">
      <div><b>${esc(x.document_no||'Sales Order')}</b><div class="text-xs text-gray-500">${esc(x.customer_name||'')}</div><div class="text-[9px] text-gray-400">${esc(dateText(x.order_date))}</div></div>
      <div class="flex gap-3 items-center min-w-0"><div class="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">${x.image_url?`<img src="${esc(x.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(x.product_code||'')}</div><div class="text-sm font-semibold truncate">${esc(x.item_name||'')}</div></div></div>
      <div class="text-xs"><div class="text-gray-400">Ordered</div><b>${q(x.ordered_qty)}</b></div>
      <div class="text-xs"><div class="text-gray-400">To Deliver</div><b class="text-amber-600">${q(x.remaining_qty)}</b></div>
      ${canOperate()?`<button onclick="openReleaseSalesStock('${x.sales_order_item_id}')" class="px-3 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Release / OUT</button>`:'<span class="text-right text-[10px] text-gray-400">View only</span>'}
    </div>`).join(''):'<div class="inv-card py-12 text-center text-sm text-gray-400">No tracked stock orders are waiting for delivery.</div>'}${inventoryListControls('delivery',inv.deliveryRows.length)}</div>`;
  }

  async function renderCounts(){
    const r=await db.from('stock_counts').select('*,stock_locations(code,name)').order('period_month',{ascending:false}).order('created_at',{ascending:false}).limit(100);
    if(r.error)throw r.error;
    const rows=(r.data||[]).filter(x=>!inv.search||[
      x.status,x.stock_locations?.code,x.stock_locations?.name,String(x.period_month||'')
    ].filter(Boolean).join(' ').toLowerCase().includes(inv.search.toLowerCase()));
    const shown=rows.slice(0,inventoryLimit('counts'));
    return `<div class="mb-4 flex justify-end">${(canOperate()||canReconcile())?'<button onclick="openStartStockCount()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-xs font-semibold">+ Start Stock Count</button>':''}</div>
      <div class="grid gap-3">${shown.length?shown.map(c=>`<button onclick="openStockCount('${c.id}')" class="inv-card text-left grid md:grid-cols-[130px_1fr_110px_120px] gap-3 items-center hover:shadow-sm">
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Period</div><b>${esc(String(c.period_month||'').slice(0,7))}</b></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Location</div><b>${esc(c.stock_locations?.code||'All Locations')}</b><div class="text-[10px] text-gray-400">${esc(c.note||'')}</div></div>
        <span class="px-2 py-1 rounded-lg border bg-gray-50 text-[10px] font-bold w-fit">${esc(titleCase(c.status))}</span>
        <div class="text-right text-xs text-[#a77d1a] font-semibold">Open Count →</div>
      </button>`).join(''):'<div class="inv-card py-12 text-center text-sm text-gray-400">No stock counts yet.</div>'}${inventoryListControls('counts',rows.length)}</div>`;
  }

  async function renderReports(){
    await loadCore();
    await loadMovements();
    const rows=filteredMovements(),shown=rows.slice(0,inventoryLimit('reports'));
    const ins=rows.filter(x=>['in','return','adjustment_in','po_receipt','opening'].includes(x.movement_type)).reduce((a,x)=>a+n(x.qty),0);
    const outs=rows.filter(x=>['out','broken','adjustment_out','sale_delivery'].includes(x.movement_type)).reduce((a,x)=>a+n(x.qty),0);
    const transfers=rows.filter(x=>x.movement_type==='transfer').reduce((a,x)=>a+n(x.qty),0);
    const broken=rows.filter(x=>x.movement_type==='broken').reduce((a,x)=>a+n(x.qty),0);
    const historical=rows.filter(x=>x.legacy).length;
    const live=rows.length-historical;
    return `<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 mb-4"><b>Movement history:</b> ${historical.toLocaleString()} imported Stock Controller rows + ${live.toLocaleString()} live app movements shown by the current search.</div>
    <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
      <div class="inv-stat"><div class="inv-stat-label">Stock In Shown</div><div class="inv-stat-value text-green-600">${q(ins)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Stock Out Shown</div><div class="inv-stat-value text-red-500">${q(outs)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Transfers Shown</div><div class="inv-stat-value text-blue-600">${q(transfers)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Broken Shown</div><div class="inv-stat-value text-amber-700">${q(broken)}</div></div>
    </div>
    <div class="mb-3 flex justify-end"><button onclick="exportStockMovementCSV()" class="px-3 py-2 border rounded-xl text-xs font-semibold">Export Movement CSV</button></div>
    <div class="inv-card"><div class="divide-y">${shown.length?shown.map(m=>movementRow(m)).join(''):'<div class="py-10 text-center text-xs text-gray-400">No report rows found.</div>'}</div>${inventoryListControls('reports',rows.length)}</div>`;
  }

  function manualMovementOptions(selected,locked=false){
    const opts=[['in','Stock In'],['out','Stock Out'],['return','Customer Return'],['broken','Broken / Damaged'],['transfer','Transfer'],['adjustment_in','Adjustment +'],['adjustment_out','Adjustment −'],['po_receipt','PO Receipt'],['sale_delivery','Customer Delivery'],['opening','Opening']];
    return opts.map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''} ${locked&&selected!==v?'disabled':''}>${l}</option>`).join('');
  }

  function liveHistoryId(historyId){
    const s=String(historyId||'');return s.startsWith('live:')?s.slice(5):'';
  }
  function legacyHistoryId(historyId){
    const s=String(historyId||'');return s.startsWith('legacy:')?s.slice(7):'';
  }

  window.openAdminStockMovementEdit=async function(historyId){
    if(!canAdmin())return showToast('Admin or Super Admin access required.','err');
    await loadCore();
    const legacyId=legacyHistoryId(historyId);
    if(legacyId){
      const r=await db.from('stock_legacy_history').select('*').eq('id',legacyId).single();
      if(r.error)return showToast(r.error.message,'err');
      const m=r.data;
      openModal('Edit Historical Stock Movement',`<form id="adminLegacyStockEdit" class="space-y-4">
        <div class="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800"><b>Historical row.</b> Editing this changes the imported history only; it does not alter today's live stock balance.</div>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="text-xs font-semibold">Date</label><input id="aleDate" type="date" value="${esc(m.movement_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Type</label><select id="aleType" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${[['in','Stock In'],['out','Stock Out'],['return','Return'],['broken','Broken'],['transfer','Transfer']].map(([v,l])=>`<option value="${v}" ${m.movement_type===v?'selected':''}>${l}</option>`).join('')}</select></div>
          <div><label class="text-xs font-semibold">Product Code</label><input id="aleCode" value="${esc(m.product_code_snapshot||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Item Name</label><input id="aleItem" value="${esc(m.item_name_snapshot||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Qty</label><input id="aleQty" type="number" min="0.01" step="0.01" value="${n(m.qty)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Location</label><input id="aleLocation" value="${esc(m.location_code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Move From</label><input id="aleFrom" value="${esc(m.from_location_code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Move To</label><input id="aleTo" value="${esc(m.to_location_code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Reference</label><input id="aleRef" value="${esc(m.reference_no||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Customer / Vendor</label><input id="aleParty" value="${esc(m.counterparty||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div class="md:col-span-2"><label class="text-xs font-semibold">Remark</label><textarea id="aleNote" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(m.note||'')}</textarea></div>
        </div>
        <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Historical Row</button>
      </form>`);
      document.getElementById('adminLegacyStockEdit').onsubmit=async e=>{
        e.preventDefault();
        const x=await db.rpc('admin_update_stock_legacy_history',{
          p_id:Number(legacyId),p_movement_date:document.getElementById('aleDate').value||null,
          p_reference_no:document.getElementById('aleRef').value.trim()||null,
          p_counterparty:document.getElementById('aleParty').value.trim()||null,
          p_product_code:document.getElementById('aleCode').value.trim(),
          p_item_name:document.getElementById('aleItem').value.trim()||null,
          p_location_code:document.getElementById('aleLocation').value.trim()||null,
          p_qty:n(document.getElementById('aleQty').value),
          p_movement_type:document.getElementById('aleType').value,
          p_from_location_code:document.getElementById('aleFrom').value.trim()||null,
          p_to_location_code:document.getElementById('aleTo').value.trim()||null,
          p_note:document.getElementById('aleNote').value.trim()||null
        });
        if(x.error)return showToast(x.error.message,'err');
        closeModal();showToast('Historical stock row updated.');await renderStockInventoryBody();
      };
      return;
    }

    const id=liveHistoryId(historyId);if(!id)return showToast('Movement not found.','err');
    const r=await db.from('stock_movements').select('*').eq('id',id).single();
    if(r.error)return showToast(r.error.message,'err');
    const m=r.data,locked=['supplier_po_item','sales_order_item','stock_count'].includes(m.reference_type)||['opening','po_receipt','sale_delivery'].includes(m.movement_type);
    openModal('Edit Stock Movement',`<form id="adminStockEditForm" class="space-y-4">
      <div class="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-800"><b>Admin direct edit.</b> The live stock balance will be recalculated after saving. Linked PO/Delivery movement types are protected so their relationship is not broken.</div>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Date</label><input id="aseDate" type="date" value="${esc(m.movement_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Movement Type</label><select id="aseType" ${locked?'disabled':''} class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white disabled:bg-gray-50">${manualMovementOptions(m.movement_type,locked)}</select></div>
        <div><label class="text-xs font-semibold">Quantity</label><input id="aseQty" type="number" min="0.01" step="0.01" value="${n(m.qty)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div></div>
        <div><label class="text-xs font-semibold">From Location</label><select id="aseFrom" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions(m.from_location_id,'None')}</select></div>
        <div><label class="text-xs font-semibold">To Location</label><select id="aseTo" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions(m.to_location_id,'None')}</select></div>
        <div><label class="text-xs font-semibold">Reference</label><input id="aseRef" value="${esc(m.reference_no||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Customer / Vendor</label><input id="aseParty" value="${esc(m.counterparty||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Remark</label><textarea id="aseNote" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(m.note||'')}</textarea></div>
      </div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Stock Movement</button>
    </form>`);
    document.getElementById('adminStockEditForm').onsubmit=async e=>{
      e.preventDefault();
      const x=await db.rpc('admin_update_stock_movement',{
        p_movement_id:id,p_movement_date:document.getElementById('aseDate').value||null,
        p_movement_type:locked?m.movement_type:document.getElementById('aseType').value,
        p_qty:n(document.getElementById('aseQty').value),
        p_from_location_id:document.getElementById('aseFrom').value||null,
        p_to_location_id:document.getElementById('aseTo').value||null,
        p_reference_no:document.getElementById('aseRef').value.trim()||null,
        p_counterparty:document.getElementById('aseParty').value.trim()||null,
        p_note:document.getElementById('aseNote').value.trim()||null
      });
      if(x.error)return showToast(x.error.message,'err');
      closeModal();showToast('Stock movement updated.');inv.locations=[];inv.balances=[];await renderStockInventory();
    };
  };

  window.deleteStockMovementAdmin=async function(historyId){
    if(!canAdmin())return;
    if(!confirm('Delete this stock movement? Admin/Super Admin can delete it, but the stock balance and any linked PO/delivery status will be recalculated.'))return;
    const legacyId=legacyHistoryId(historyId);
    const r=legacyId
      ?await db.rpc('admin_delete_stock_legacy_history',{p_id:Number(legacyId)})
      :await db.rpc('admin_delete_stock_movement',{p_movement_id:liveHistoryId(historyId)});
    if(r.error)return showToast(r.error.message,'err');
    showToast(legacyId?'Historical stock row deleted.':'Stock movement deleted.');
    inv.locations=[];inv.balances=[];await renderStockInventory();
  };

  window.openStockMovementEditRequest=async function(id){
    if(!isStockController())return showToast('Stock Controller access required.','err');
    await loadCore();
    const r=await db.from('stock_movements').select('*').eq('id',id).single();
    if(r.error)return showToast(r.error.message,'err');
    const m=r.data,locked=['supplier_po_item','sales_order_item','stock_count'].includes(m.reference_type)||['opening','po_receipt','sale_delivery'].includes(m.movement_type);
    openModal('Request Stock Movement Edit',`<form id="stockEditRequestForm" class="space-y-4">
      <div class="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">Your change will <b>not</b> alter stock immediately. Admin/Super Admin must approve it first.</div>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Date</label><input id="serDate" type="date" value="${esc(m.movement_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Movement Type</label><select id="serType" ${locked?'disabled':''} class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white disabled:bg-gray-50">${manualMovementOptions(m.movement_type,locked)}</select></div>
        <div><label class="text-xs font-semibold">Quantity</label><input id="serQty" type="number" min="0.01" step="0.01" value="${n(m.qty)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div><div></div>
        <div><label class="text-xs font-semibold">From Location</label><select id="serFrom" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions(m.from_location_id,'None')}</select></div>
        <div><label class="text-xs font-semibold">To Location</label><select id="serTo" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions(m.to_location_id,'None')}</select></div>
        <div><label class="text-xs font-semibold">Reference</label><input id="serRef" value="${esc(m.reference_no||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Customer / Vendor</label><input id="serParty" value="${esc(m.counterparty||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Remark</label><textarea id="serNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(m.note||'')}</textarea></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Reason for Edit Request</label><textarea id="serReason" required rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Explain what needs correction and why."></textarea></div>
      </div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Submit Edit Request</button>
    </form>`);
    document.getElementById('stockEditRequestForm').onsubmit=async e=>{
      e.preventDefault();
      const changes={
        movement_date:document.getElementById('serDate').value||m.movement_date,
        movement_type:locked?m.movement_type:document.getElementById('serType').value,
        qty:n(document.getElementById('serQty').value),
        from_location_id:document.getElementById('serFrom').value||'',
        to_location_id:document.getElementById('serTo').value||'',
        reference_no:document.getElementById('serRef').value.trim(),
        counterparty:document.getElementById('serParty').value.trim(),
        note:document.getElementById('serNote').value.trim()
      };
      const x=await db.rpc('request_stock_movement_change',{p_movement_id:id,p_request_type:'edit',p_proposed_changes:changes,p_reason:document.getElementById('serReason').value.trim()});
      if(x.error)return showToast(x.error.message,'err');
      closeModal();showToast('Edit request sent to Admin/Super Admin.');inv.tab='requests';await renderStockInventory();
    };
  };

  window.requestStockMovementDelete=async function(id){
    if(!isStockController())return;
    openModal('Request Stock Movement Delete',`<form id="stockDeleteRequestForm" class="space-y-4"><div class="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-800">The movement will stay active until Admin/Super Admin approves this request.</div><div><label class="text-xs font-semibold">Reason for Delete Request</label><textarea id="sdrReason" required rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5"></textarea></div><button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Submit Delete Request</button></form>`);
    document.getElementById('stockDeleteRequestForm').onsubmit=async e=>{
      e.preventDefault();
      const x=await db.rpc('request_stock_movement_change',{p_movement_id:id,p_request_type:'delete',p_proposed_changes:{},p_reason:document.getElementById('sdrReason').value.trim()});
      if(x.error)return showToast(x.error.message,'err');
      closeModal();showToast('Delete request sent to Admin/Super Admin.');inv.tab='requests';await renderStockInventory();
    };
  };

  async function renderStockRequests(){
    if(!canAdmin()&&!isStockController())return '<div class="inv-card py-10 text-center text-sm text-gray-400">No request access.</div>';
    let qy=db.from('stock_change_requests').select('*').order('requested_at',{ascending:false}).limit(300);
    const rr=await qy;if(rr.error)throw rr.error;
    const reqs=rr.data||[];
    const shownReqs=reqs.slice(0,inventoryLimit('requests'));
    const ids=[...new Set(reqs.map(x=>x.movement_id).filter(Boolean))];
    const userIds=[...new Set(reqs.map(x=>x.requested_by).filter(Boolean))];
    const [mr,ur]=await Promise.all([
      ids.length?db.from('stock_movements').select('id,movement_date,movement_type,qty,reference_no,counterparty,note,product_id').in('id',ids):Promise.resolve({data:[],error:null}),
      userIds.length?db.from('app_users').select('user_id,display_name,email').in('user_id',userIds):Promise.resolve({data:[],error:null})
    ]);
    if(mr.error)throw mr.error;
    const moves=new Map((mr.data||[]).map(x=>[x.id,x]));
    const users=new Map((ur.data||[]).map(x=>[x.user_id,x]));
    const productIds=[...new Set((mr.data||[]).map(x=>x.product_id).filter(Boolean))];
    const pr=productIds.length?await db.from('product_catalog').select('id,code,item_name').in('id',productIds):{data:[],error:null};
    if(pr.error)throw pr.error;
    const products=new Map((pr.data||[]).map(x=>[x.id,x]));
    if(!reqs.length)return '<div class="inv-card py-12 text-center text-sm text-gray-400">No stock edit requests.</div>';

    return `<div class="grid gap-3">${shownReqs.map(r=>{
      const m=moves.get(r.movement_id)||{},p=products.get(m.product_id)||{},u=users.get(r.requested_by)||{};
      const proposed=r.proposed_changes||{};
      const changes=r.request_type==='delete'
        ?'<span class="text-red-600 font-semibold">Delete this movement</span>'
        :Object.entries(proposed).map(([k,v])=>`<span class="inline-flex px-2 py-1 rounded-lg border bg-white"><b>${esc(k.replaceAll('_',' '))}:</b>&nbsp;${esc(v==null||v===''?'None':String(v))}</span>`).join(' ');
      const statusCls=r.status==='approved'?'text-green-600':r.status==='rejected'?'text-red-600':r.status==='pending'?'text-amber-700':'text-gray-500';
      return `<div class="inv-card">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><b>${esc(p.code||'Stock Movement')} · ${esc(p.item_name||'')}</b><span class="px-2 py-1 rounded-lg border text-[9px] font-bold ${r.request_type==='delete'?'bg-red-50 text-red-600':'bg-amber-50 text-amber-700'}">${esc(titleCase(r.request_type))}</span><span class="text-[10px] font-bold ${statusCls}">${esc(titleCase(r.status))}</span></div>
            <div class="text-xs text-gray-500 mt-2">Current: ${esc(dateText(m.movement_date))} · ${esc(movementLabel(m.movement_type))} · Qty ${q(m.qty)}${m.reference_no?' · '+esc(m.reference_no):''}</div>
            <div class="text-[10px] text-gray-400 mt-1">Requested by ${esc(u.display_name||u.email||'Stock Controller')} · ${esc(new Date(r.requested_at).toLocaleString())}</div>
            ${r.reason?`<div class="mt-3 rounded-xl bg-gray-50 border p-3 text-xs"><b>Reason:</b> ${esc(r.reason)}</div>`:''}
            <div class="mt-3 flex flex-wrap gap-1.5 text-[10px]">${changes}</div>
            ${r.reviewer_note?`<div class="mt-2 text-[10px] text-gray-500"><b>Reviewer:</b> ${esc(r.reviewer_note)}</div>`:''}
          </div>
          ${canAdmin()&&r.status==='pending'?`<div class="flex gap-2 shrink-0"><button onclick="reviewStockMovementRequest('${r.id}',true)" class="px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold">Approve</button><button onclick="reviewStockMovementRequest('${r.id}',false)" class="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-semibold">Reject</button></div>`:''}
        </div>
      </div>`;
    }).join('')}${inventoryListControls('requests',reqs.length)}</div>`;
  }

  window.reviewStockMovementRequest=async function(id,approve){
    if(!canAdmin())return;
    let note='';
    if(!approve)note=prompt('Optional rejection note:')||'';
    else note=prompt('Optional approval note:')||'';
    const r=await db.rpc('review_stock_movement_change',{p_request_id:id,p_approve:!!approve,p_reviewer_note:note||null});
    if(r.error)return showToast(r.error.message,'err');
    showToast(approve?'Stock change approved and applied.':'Stock change request rejected.');
    inv.locations=[];inv.balances=[];await renderStockInventory();
  };

  window.deleteStockCountAdmin=async function(id){
    if(!canAdmin())return;
    if(!confirm('Delete this stock count? If it was closed, its count adjustment movements will also be removed and live stock recalculated.'))return;
    const r=await db.rpc('admin_delete_stock_count',{p_count_id:id});
    if(r.error)return showToast(r.error.message,'err');
    closeModal();showToast('Stock count deleted.');inv.locations=[];inv.balances=[];await renderStockInventory();
  };

  window.reopenStockCountAdmin=async function(id){
    if(!canAdmin())return;
    if(!confirm('Reopen this count? Any stock adjustments created when it was closed will be removed so you can correct the count and close it again.'))return;
    const r=await db.rpc('admin_reopen_stock_count',{p_count_id:id});
    if(r.error)return showToast(r.error.message,'err');
    showToast('Stock count reopened.');inv.locations=[];inv.balances=[];await openStockCount(id);
  };

  window.renderStockInventoryBody=async function(){
    const body=document.getElementById('inventoryBody');if(!body)return;
    body.innerHTML='<div class="py-16 text-center text-gray-400">Loading...</div>';
    try{
      let html='';
      if(inv.tab==='dashboard')html=await renderDashboard();
      else if(inv.tab==='balance')html=await renderBalance();
      else if(inv.tab==='movements')html=await renderMovements();
      else if(inv.tab==='receive')html=await renderReceive();
      else if(inv.tab==='delivery')html=await renderDelivery();
      else if(inv.tab==='counts')html=await renderCounts();
      else if(inv.tab==='requests')html=await renderStockRequests();
      else html=await renderReports();
      body.innerHTML=html;
    }catch(err){body.innerHTML=`<div class="inv-card text-red-600">Error: ${esc(err.message)}</div>`}
  };

  window.renderStockInventory=async function(){
    if(!canView())throw new Error('Inventory access required.');
    injectStyles();await loadCore();
    if(!tabs().some(x=>x[0]===inv.tab))inv.tab='dashboard';
    const searchPlaceholder=inv.tab==='receive'?'Search PO, vendor, SKU...':inv.tab==='delivery'?'Search invoice, customer, SKU...':'Search SKU, item, brand, location, reference...';
    document.getElementById('content').innerHTML=`<div class="max-w-[1550px] mx-auto">
      <div class="inv-tabs">${tabs().map(([v,l])=>`<button class="inv-tab ${inv.tab===v?'active':''}" onclick="setInventoryTab('${v}')">${l}</button>`).join('')}</div>
      <div class="inv-toolbar">
        <input class="inv-search" value="${esc(inv.search)}" oninput="setInventorySearch(this.value)" placeholder="${esc(searchPlaceholder)}">
        <div>${topActions()}</div>
      </div>
      <div id="inventoryBody"></div>
    </div>`;
    await renderStockInventoryBody();
  };

  function stockProductMatches(raw){
    const qv=String(raw||'').trim().toLowerCase();
    const rows=inv.balances||[];
    const ranked=rows.filter(p=>!qv||[
      p.code,p.item_name,p.brand,p.class
    ].filter(Boolean).join(' ').toLowerCase().includes(qv));
    ranked.sort((a,b)=>{
      if(!qv)return String(a.item_name||'').localeCompare(String(b.item_name||''));
      const ac=String(a.code||'').toLowerCase(),bc=String(b.code||'').toLowerCase();
      const an=String(a.item_name||'').toLowerCase(),bn=String(b.item_name||'').toLowerCase();
      const ar=ac===qv?0:ac.startsWith(qv)?1:an.startsWith(qv)?2:3;
      const br=bc===qv?0:bc.startsWith(qv)?1:bn.startsWith(qv)?2:3;
      return ar-br||an.localeCompare(bn);
    });
    return ranked.slice(0,15);
  }

  window.showStockProductSuggestions=function(input){
    const box=document.getElementById('smProductSuggestions');if(!box)return;
    const rows=stockProductMatches(input?.value||'');
    if(!rows.length){
      box.innerHTML='<div class="px-4 py-3 text-sm text-gray-400">No matching product</div>';
      box.classList.remove('hidden');return;
    }
    box.innerHTML=rows.map(p=>{
      const locs=(p.locations||[]).filter(l=>n(l.qty)>0).slice(0,4).map(l=>`${esc(l.code)} ${q(l.qty)}`).join(' · ');
      return `<button type="button" data-stock-product-id="${esc(p.product_id)}" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-b-0 flex items-center gap-3">
        <div class="w-11 h-11 rounded-lg bg-gray-100 overflow-hidden shrink-0">${p.image_url?`<img src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
        <div class="min-w-0 flex-1">
          <div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'No code')}</div>
          <div class="text-sm font-semibold truncate">${esc(p.item_name||'')}</div>
          <div class="text-[10px] text-gray-400 truncate">${esc(p.brand||'')}${p.class?' · '+esc(p.class):''}</div>
          <div class="text-[10px] mt-0.5"><span class="text-gray-400">On Hand</span> <b>${q(p.on_hand)}</b> · <span class="text-gray-400">Available</span> <b class="${n(p.available)>0?'text-green-600':'text-red-500'}">${q(p.available)}</b>${locs?' · '+locs:''}</div>
        </div>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-stock-product-id]').forEach(btn=>{
      btn.addEventListener('mousedown',e=>{e.preventDefault();chooseStockProduct(btn.dataset.stockProductId)});
    });
    box.classList.remove('hidden');
  };

  window.stockProductInputChanged=function(input){
    const hidden=document.getElementById('smProductId');if(hidden)hidden.value='';
    const info=document.getElementById('smProductInfo');if(info)info.innerHTML='';
    showStockProductSuggestions(input);
  };

  window.chooseStockProduct=function(productId){
    const p=inv.balanceMap.get(productId)||inv.balances.find(x=>String(x.product_id)===String(productId));
    if(!p)return;
    const input=document.getElementById('smProduct'),hidden=document.getElementById('smProductId'),box=document.getElementById('smProductSuggestions'),info=document.getElementById('smProductInfo');
    if(input)input.value=productDisplay(p);
    if(hidden)hidden.value=p.product_id;
    if(box)box.classList.add('hidden');
    if(info){
      const locs=(p.locations||[]).filter(l=>n(l.qty)>0).map(l=>`<span class="inline-flex px-2 py-1 rounded-lg border bg-gray-50"><b>${esc(l.code)}</b>&nbsp;${q(l.qty)}</span>`).join(' ');
      info.innerHTML=`<div class="mt-2 flex flex-wrap gap-2 text-[10px]"><span>On Hand <b>${q(p.on_hand)}</b></span><span>Reserved <b class="text-amber-600">${q(p.reserved)}</b></span><span>Available <b class="text-green-600">${q(p.available)}</b></span>${locs?`<span class="w-full flex flex-wrap gap-1">${locs}</span>`:''}</div>`;
    }
  };

  let stockRefTimer=null;
  window.stockReferenceInputChanged=function(input){
    const type=document.getElementById('smReferenceType'),id=document.getElementById('smReferenceId');
    if(type)type.value='';if(id)id.value='';
    clearTimeout(stockRefTimer);
    stockRefTimer=setTimeout(()=>showStockReferenceSuggestions(input),220);
  };

  window.showStockReferenceSuggestions=async function(input){
    const box=document.getElementById('smReferenceSuggestions');if(!box)return;
    const seq=String(Date.now());box.dataset.seq=seq;
    box.innerHTML='<div class="px-4 py-3 text-xs text-gray-400">Searching documents...</div>';box.classList.remove('hidden');
    const {data,error}=await db.rpc('search_inventory_references',{p_search:String(input?.value||'').trim()||null});
    if(box.dataset.seq!==seq)return;
    if(error){box.innerHTML=`<div class="px-4 py-3 text-xs text-red-500">${esc(error.message)}</div>`;return}
    let rows=data||[];
    const movement=document.getElementById('smType')?.value||'';
    const preferred=movement==='in'?'supplier_po':['out','return'].includes(movement)?'sales_order':'';
    if(preferred)rows=[...rows].sort((a,b)=>(a.reference_type===preferred?0:1)-(b.reference_type===preferred?0:1));
    if(!rows.length){box.innerHTML='<div class="px-4 py-3 text-sm text-gray-400">No matching PO / invoice / order</div>';return}
    box.innerHTML=rows.map((r,i)=>`<button type="button" data-stock-ref-index="${i}" class="w-full text-left px-4 py-3 hover:bg-amber-50 border-b last:border-b-0">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0"><div class="text-[10px] uppercase font-bold ${r.reference_type==='supplier_po'?'text-blue-600':'text-[#a77d1a]'}">${r.reference_type==='supplier_po'?'Supplier PO':'Sales / Invoice'}</div><div class="text-sm font-bold truncate">${esc(r.reference_no||'')}</div></div>
        <span class="text-[9px] px-2 py-1 rounded-lg border bg-gray-50 shrink-0">${esc(titleCase(r.status||''))}</span>
      </div>
      <div class="text-[11px] text-gray-500 mt-1 truncate">${esc(r.counterparty||'')}${r.reference_date?' · '+esc(dateText(r.reference_date)):''}</div>
      ${r.secondary_text?`<div class="text-[10px] text-gray-400 mt-0.5 truncate">${esc(r.secondary_text)}</div>`:''}
    </button>`).join('');
    box.querySelectorAll('[data-stock-ref-index]').forEach(btn=>{
      btn.addEventListener('mousedown',e=>{e.preventDefault();chooseStockReference(rows[Number(btn.dataset.stockRefIndex)])});
    });
  };

  window.chooseStockReference=function(r){
    if(!r)return;
    const input=document.getElementById('smRef'),type=document.getElementById('smReferenceType'),id=document.getElementById('smReferenceId'),party=document.getElementById('smParty'),box=document.getElementById('smReferenceSuggestions'),info=document.getElementById('smReferenceInfo');
    if(input)input.value=r.reference_no||'';
    if(type)type.value=r.reference_type||'';
    if(id)id.value=r.reference_id||'';
    if(party&&r.counterparty)party.value=r.counterparty;
    if(box)box.classList.add('hidden');
    if(info)info.innerHTML=`<span class="${r.reference_type==='supplier_po'?'text-blue-600':'text-[#a77d1a]'} font-semibold">${r.reference_type==='supplier_po'?'Supplier PO':'Sales / Invoice'}</span> · ${esc(r.counterparty||'')}${r.reference_date?' · '+esc(dateText(r.reference_date)):''}`;
  };

  window.openStockMovement=async function(defaultType='in',defaultProductId=null){
    if(!canOperate())return showToast('Stock Controller or Admin access required.','err');
    await loadCore(true);
    openModal('New Stock Movement',`<form id="stockMovementForm" class="space-y-4">
      <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">All stock changes are recorded in the inventory ledger. OUT/Broken/Transfer cannot reduce a location below zero.</div>
      <div><label class="text-xs font-semibold">Product / SKU *</label><div class="relative"><input id="smProduct" autocomplete="off" required onfocus="showStockProductSuggestions(this)" oninput="stockProductInputChanged(this)" onblur="setTimeout(()=>document.getElementById('smProductSuggestions')?.classList.add('hidden'),150)" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white" placeholder="Type product code or item name..."><input id="smProductId" type="hidden"><div id="smProductSuggestions" class="hidden absolute z-[140] left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl"></div></div><div id="smProductInfo"></div></div>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Movement Type</label><select id="smType" onchange="stockMovementTypeChanged()" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">
          ${[['in','Stock In'],['out','Stock Out'],['return','Customer Return'],['broken','Broken / Damaged'],['transfer','Transfer Location'],['adjustment_in','Adjustment +'],['adjustment_out','Adjustment −']].map(([v,l])=>`<option value="${v}" ${v===defaultType?'selected':''}>${l}</option>`).join('')}
        </select></div>
        <div><label class="text-xs font-semibold">Quantity *</label><input id="smQty" type="number" min="0.01" step="0.01" value="1" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div id="smFromWrap"><label class="text-xs font-semibold">Move From / Source Location</label><select id="smFrom" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions()}</select></div>
        <div id="smToWrap"><label class="text-xs font-semibold">Move To / Destination Location</label><select id="smTo" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions()}</select></div>
        <div><label class="text-xs font-semibold">Date</label><input id="smDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Reference No.</label><div class="relative"><input id="smRef" autocomplete="off" onfocus="showStockReferenceSuggestions(this)" oninput="stockReferenceInputChanged(this)" onblur="setTimeout(()=>document.getElementById('smReferenceSuggestions')?.classList.add('hidden'),150)" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white" placeholder="Type PO, TK/RK invoice, SR, customer or vendor..."><input id="smReferenceType" type="hidden"><input id="smReferenceId" type="hidden"><div id="smReferenceSuggestions" class="hidden absolute z-[140] left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl"></div></div><div id="smReferenceInfo" class="text-[10px] text-gray-400 mt-1">Optional. Choose a suggestion to fill the customer/vendor automatically.</div></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Customer / Vendor / Counterparty</label><input id="smParty" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Remark</label><textarea id="smNote" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5"></textarea></div>
      </div>
      <button id="smSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Stock Movement</button>
    </form>`);
    if(defaultProductId){
      const selected=inv.balanceMap.get(defaultProductId);
      if(selected)chooseStockProduct(selected.product_id);
    }
    stockMovementTypeChanged();
    document.getElementById('stockMovementForm').onsubmit=async e=>{
      e.preventDefault();
      const selectedProductId=document.getElementById('smProductId').value;
      const p=(selectedProductId&&inv.balanceMap.get(selectedProductId))||findProduct(document.getElementById('smProduct').value);
      if(!p)return showToast('Choose a Product / SKU from the suggestion list.','err');
      const btn=document.getElementById('smSave');btn.disabled=true;btn.textContent='Saving...';
      const args={
        p_product_id:p.product_id,p_movement_type:document.getElementById('smType').value,
        p_qty:n(document.getElementById('smQty').value),
        p_from_location_id:document.getElementById('smFrom').value||null,
        p_to_location_id:document.getElementById('smTo').value||null,
        p_movement_date:document.getElementById('smDate').value||null,
        p_reference_type:document.getElementById('smReferenceType').value||'manual',
        p_reference_id:document.getElementById('smReferenceId').value||null,
        p_reference_item_id:null,
        p_reference_no:document.getElementById('smRef').value.trim()||null,
        p_counterparty:document.getElementById('smParty').value.trim()||null,
        p_note:document.getElementById('smNote').value.trim()||null
      };
      const r=await db.rpc('create_stock_movement',args);
      if(r.error){btn.disabled=false;btn.textContent='Save Stock Movement';return showToast(r.error.message,'err')}
      closeModal();showToast('Stock movement saved.');inv.locations=[];inv.balances=[];await renderStockInventory();
    };
  };

  window.stockMovementTypeChanged=function(){
    const type=document.getElementById('smType')?.value||'in';
    const needFrom=['out','broken','transfer','adjustment_out'].includes(type);
    const needTo=['in','return','transfer','adjustment_in'].includes(type);
    document.getElementById('smFromWrap')?.classList.toggle('hidden',!needFrom);
    document.getElementById('smToWrap')?.classList.toggle('hidden',!needTo);
    if(!needFrom&&document.getElementById('smFrom'))document.getElementById('smFrom').value='';
    if(!needTo&&document.getElementById('smTo'))document.getElementById('smTo').value='';
    const ref=document.getElementById('smRef'),box=document.getElementById('smReferenceSuggestions');
    if(ref&&box&&!box.classList.contains('hidden'))showStockReferenceSuggestions(ref);
  };
  window.openStockTransfer=function(productId=null){return openStockMovement('transfer',productId)};

  // Replace the old direct Product stock editor. All adjustments now go through the audited ledger.
  window.openAdjustStock=function(productId){
    if(!canOperate())return showToast('Stock Controller or Admin access required.','err');
    return openStockMovement('adjustment_in',productId);
  };

  window.openProductStockHistory=async function(productId){
    await loadCore();
    const p=inv.balanceMap.get(productId);
    openModal('Stock History — '+(p?.code||'Product'),'<div class="py-12 text-center text-sm text-gray-400">Loading history...</div>');
    const r=await db.from('inventory_movement_history').select('*').eq('product_id',productId).order('movement_date',{ascending:false}).order('created_at',{ascending:false}).limit(500);
    if(r.error){document.getElementById('modalBody').innerHTML=`<div class="text-red-600">${esc(r.error.message)}</div>`;return}
    const locs=(p?.locations||[]).filter(x=>n(x.qty)!==0);
    document.getElementById('modalBody').innerHTML=`<div class="space-y-4">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">On Hand</div><b class="text-xl">${q(p?.on_hand)}</b></div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Reserved</div><b class="text-xl text-amber-600">${q(p?.reserved)}</b></div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Available</div><b class="text-xl text-green-600">${q(p?.available)}</b></div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Incoming</div><b class="text-xl text-blue-600">${q(p?.incoming)}</b></div>
      </div>
      <div class="flex flex-wrap gap-2">${locs.map(l=>`<span class="px-2.5 py-1.5 rounded-lg border bg-white text-xs"><b>${esc(l.code)}</b> ${q(l.qty)}</span>`).join('')||'<span class="text-xs text-gray-400">No stock locations.</span>'}</div>
      <div class="divide-y border rounded-xl px-4">${(r.data||[]).length?(r.data||[]).map(m=>movementRow(m)).join(''):'<div class="py-8 text-center text-xs text-gray-400">No history.</div>'}</div>
    </div>`;
  };

  window.openReceivePOItem=async function(itemId){
    if(!canOperate())return;
    await loadCore();
    const row=inv.poRows.find(x=>String(x.supplier_po_item_id)===String(itemId));
    if(!row){
      const r=await db.rpc('get_inventory_po_receiving_queue',{p_search:null});
      if(r.error)return showToast(r.error.message,'err');
      inv.poRows=r.data||[];
    }
    const x=inv.poRows.find(x=>String(x.supplier_po_item_id)===String(itemId));
    if(!x)return showToast('PO item is already fully received or unavailable.','err');
    openModal('Receive Stock — '+x.po_number,`<form id="receivePOForm" class="space-y-4">
      <div class="rounded-xl border bg-gray-50 p-4"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(x.product_code||'')}</div><div class="font-semibold">${esc(x.item_name||'')}</div><div class="text-xs text-gray-500 mt-2">Vendor: ${esc(x.vendor_name||'')} · Ordered ${q(x.ordered_qty)} · Received ${q(x.received_qty)} · <b>Remaining ${q(x.remaining_qty)}</b></div></div>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Receive Qty *</label><input id="rpoQty" type="number" min="0.01" step="0.01" max="${n(x.remaining_qty)}" value="${n(x.remaining_qty)}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Receive To Location *</label><select id="rpoLocation" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions()}</select></div>
        <div><label class="text-xs font-semibold">Receipt Date</label><input id="rpoDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Remark</label><input id="rpoNote" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>
      </div>
      <button id="rpoSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Confirm Receipt</button>
    </form>`);
    document.getElementById('receivePOForm').onsubmit=async e=>{
      e.preventDefault();const btn=document.getElementById('rpoSave');btn.disabled=true;btn.textContent='Receiving...';
      const r=await db.rpc('receive_po_stock',{p_supplier_po_item_id:itemId,p_qty:n(document.getElementById('rpoQty').value),p_location_id:document.getElementById('rpoLocation').value,p_receipt_date:document.getElementById('rpoDate').value||null,p_note:document.getElementById('rpoNote').value.trim()||null});
      if(r.error){btn.disabled=false;btn.textContent='Confirm Receipt';return showToast(r.error.message,'err')}
      closeModal();showToast('PO stock received.');inv.locations=[];inv.balances=[];await renderStockInventory();
    };
  };

  window.openReceivePOForPO=async function(poId){
    if(!canOperate())return showToast('Stock Controller or Admin access required.','err');
    await loadCore();
    const r=await db.rpc('get_inventory_po_receiving_queue',{p_search:null});
    if(r.error)return showToast(r.error.message,'err');
    inv.poRows=(r.data||[]);
    const rows=inv.poRows.filter(x=>String(x.supplier_po_id)===String(poId));
    if(!rows.length)return showToast('This PO has no remaining stock to receive.','ok');
    openModal('Receive Stock from PO',`<div class="grid gap-3">${rows.map(x=>`<button onclick="openReceivePOItem('${x.supplier_po_item_id}')" class="rounded-xl border p-3 text-left hover:bg-gray-50"><div class="flex justify-between gap-3"><div><div class="text-[10px] font-bold text-[#a77d1a]">${esc(x.product_code||'')}</div><b class="text-sm">${esc(x.item_name||'')}</b></div><div class="text-right text-xs"><span class="text-gray-400">Remaining</span><br><b class="text-blue-600">${q(x.remaining_qty)}</b></div></div></button>`).join('')}</div>`);
  };

  window.openReleaseSalesStock=async function(itemId){
    if(!canOperate())return;
    await loadCore(true);
    let x=inv.deliveryRows.find(x=>String(x.sales_order_item_id)===String(itemId));
    if(!x){const r=await db.rpc('get_inventory_delivery_queue',{p_search:null});if(r.error)return showToast(r.error.message,'err');inv.deliveryRows=r.data||[];x=inv.deliveryRows.find(x=>String(x.sales_order_item_id)===String(itemId))}
    if(!x)return showToast('This order item is already fully released or unavailable.','err');
    const bal=inv.balanceMap.get(x.product_id);
    const locs=(bal?.locations||[]).filter(l=>n(l.qty)>0);
    openModal('Release Customer Stock — '+x.document_no,`<form id="releaseStockForm" class="space-y-4">
      <div class="rounded-xl border bg-gray-50 p-4"><div class="text-xs text-gray-500">${esc(x.customer_name||'')}</div><div class="text-[10px] font-bold text-[#a77d1a] mt-1">${esc(x.product_code||'')}</div><div class="font-semibold">${esc(x.item_name||'')}</div><div class="text-xs mt-2">Ordered ${q(x.ordered_qty)} · Released ${q(x.released_qty)} · <b>Remaining ${q(x.remaining_qty)}</b></div></div>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Release Qty *</label><input id="rsQty" type="number" min="0.01" max="${n(x.remaining_qty)}" step="0.01" value="${n(x.remaining_qty)}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">From Location *</label><select id="rsLocation" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Select stock location</option>${locs.map(l=>`<option value="${l.location_id}">${esc(l.code)} · Available ${q(l.qty)}</option>`).join('')}</select></div>
        <div><label class="text-xs font-semibold">Delivery Date</label><input id="rsDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Remark</label><input id="rsNote" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      </div>
      <button id="rsSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Confirm Stock OUT</button>
    </form>`);
    document.getElementById('releaseStockForm').onsubmit=async e=>{
      e.preventDefault();const btn=document.getElementById('rsSave');btn.disabled=true;btn.textContent='Releasing...';
      const r=await db.rpc('release_sales_stock',{p_sales_order_item_id:itemId,p_qty:n(document.getElementById('rsQty').value),p_location_id:document.getElementById('rsLocation').value,p_delivery_date:document.getElementById('rsDate').value||null,p_note:document.getElementById('rsNote').value.trim()||null});
      if(r.error){btn.disabled=false;btn.textContent='Confirm Stock OUT';return showToast(r.error.message,'err')}
      closeModal();showToast('Customer stock released.');inv.locations=[];inv.balances=[];await renderStockInventory();
    };
  };

  window.openStartStockCount=async function(){
    await loadCore();
    openModal('Start Stock Count',`<form id="startCountForm" class="space-y-4">
      <div class="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">A count freezes the current system quantity as the comparison snapshot. For easier counting, start one location at a time.</div>
      <div><label class="text-xs font-semibold">Month</label><input id="scMonth" type="month" value="${new Date().toISOString().slice(0,7)}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Location *</label><select id="scLocation" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions()}</select></div>
      <div><label class="text-xs font-semibold">Note</label><textarea id="scNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5"></textarea></div>
      <button id="scStart" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Create Count Sheet</button>
    </form>`);
    document.getElementById('startCountForm').onsubmit=async e=>{
      e.preventDefault();const btn=document.getElementById('scStart');btn.disabled=true;btn.textContent='Creating...';
      const r=await db.rpc('start_stock_count',{p_period_month:document.getElementById('scMonth').value+'-01',p_location_id:document.getElementById('scLocation').value,p_note:document.getElementById('scNote').value.trim()||null});
      if(r.error){btn.disabled=false;btn.textContent='Create Count Sheet';return showToast(r.error.message,'err')}
      closeModal();await openStockCount(r.data);
    };
  };

  window.saveStockCountRow=async function(itemId){
    const row=document.querySelector(`[data-count-item="${itemId}"]`);if(!row)return;
    const physical=row.querySelector('.count-physical').value;
    const qb=row.querySelector('.count-qb').value;
    const note=row.querySelector('.count-note').value.trim()||null;
    const r=await db.rpc('save_stock_count_item',{p_item_id:itemId,p_physical_qty:physical===''?null:n(physical),p_qb_qty:qb===''?null:n(qb),p_note:note});
    if(r.error)return showToast(r.error.message,'err');
    const system=n(row.dataset.system),p=physical===''?null:n(physical),qv=qb===''?null:n(qb);
    row.querySelector('.count-var').textContent=p==null?'-':q(p-system);
    row.querySelector('.count-qbvar').textContent=qv==null?'-':q(qv-system);
    showToast('Count row saved.');
  };

  window.openStockCount=async function(countId){
    openModal('Stock Count','<div class="py-12 text-center text-sm text-gray-400">Loading stock count...</div>');
    const [c,items]=await Promise.all([
      db.from('stock_counts').select('*,stock_locations(code,name)').eq('id',countId).single(),
      db.from('stock_count_items').select('*,product_catalog(code,item_name,brand),stock_locations(code,name)').eq('stock_count_id',countId).order('updated_at').limit(2000)
    ]);
    if(c.error||items.error){document.getElementById('modalBody').innerHTML=`<div class="text-red-600">${esc((c.error||items.error).message)}</div>`;return}
    const count=c.data,rows=items.data||[],closed=count.status==='closed';
    const canEditCount=canAdmin()||(isStockController()&&count.status==='draft');
    document.getElementById('modalBody').innerHTML=`<div class="space-y-4">
      <div class="rounded-xl border bg-gray-50 p-4 flex flex-wrap gap-4 justify-between"><div><div class="text-[9px] uppercase font-bold text-gray-400">Period</div><b>${esc(String(count.period_month).slice(0,7))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Location</div><b>${esc(count.stock_locations?.code||'All')}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Status</div><b>${esc(titleCase(count.status))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Items</div><b>${rows.length}</b></div></div>
      <div class="max-h-[58vh] overflow-auto border rounded-xl"><div class="min-w-[900px] divide-y">
        <div class="sticky top-0 z-10 bg-gray-50 p-2 grid grid-cols-[1.6fr_90px_110px_110px_80px_80px_1fr_70px] gap-2 text-[9px] uppercase font-bold text-gray-400"><div>Product</div><div>System</div><div>Physical</div><div>QB Qty</div><div>Var</div><div>QB Var</div><div>Note</div><div></div></div>
        ${rows.map(i=>`<div data-count-item="${i.id}" data-system="${n(i.system_qty)}" class="p-2 grid grid-cols-[1.6fr_90px_110px_110px_80px_80px_1fr_70px] gap-2 items-center text-xs"><div><div class="text-[9px] font-bold text-[#a77d1a]">${esc(i.product_catalog?.code||'')}</div><div class="truncate">${esc(i.product_catalog?.item_name||'')}</div></div><b>${q(i.system_qty)}</b><input class="count-physical border rounded-lg px-2 py-1.5" type="number" min="0" step="0.01" value="${i.physical_qty==null?'':n(i.physical_qty)}" ${!canEditCount?'disabled':''}><input class="count-qb border rounded-lg px-2 py-1.5" type="number" min="0" step="0.01" value="${i.qb_qty==null?'':n(i.qb_qty)}" ${!canEditCount?'disabled':''}><b class="count-var ${i.physical_qty!=null&&n(i.physical_qty)!==n(i.system_qty)?'text-red-600':''}">${i.physical_qty==null?'-':q(n(i.physical_qty)-n(i.system_qty))}</b><span class="count-qbvar">${i.qb_qty==null?'-':q(n(i.qb_qty)-n(i.system_qty))}</span><input class="count-note border rounded-lg px-2 py-1.5" value="${esc(i.note||'')}" ${!canEditCount?'disabled':''}><button onclick="saveStockCountRow('${i.id}')" class="px-2 py-1.5 border rounded-lg text-[9px] font-semibold ${!canEditCount?'hidden':''}">Save</button></div>`).join('')}
      </div></div>
      <div class="flex flex-wrap gap-2 justify-end">
        ${!closed&&count.status==='draft'&&(isStockController()||canAdmin())?`<button onclick="submitStockCount('${count.id}')" class="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">Submit Count</button>`:''}
        ${!closed&&canReconcile()&&['submitted','reconciled'].includes(count.status)?`<button onclick="closeStockCountNow('${count.id}')" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Close & Apply Variances</button>`:''}
        ${closed&&canAdmin()?`<button onclick="reopenStockCountAdmin('${count.id}')" class="px-4 py-2 border border-amber-200 bg-amber-50 text-amber-700 rounded-xl text-xs font-semibold">Reopen Count</button>`:''}
        ${canAdmin()?`<button onclick="deleteStockCountAdmin('${count.id}')" class="px-4 py-2 border border-red-200 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">Delete Count</button>`:''}
      </div>
    </div>`;
  };

  window.submitStockCount=async function(id){
    const r=await db.rpc('submit_stock_count',{p_count_id:id});if(r.error)return showToast(r.error.message,'err');showToast('Stock count submitted.');await openStockCount(id);
  };
  window.closeStockCountNow=async function(id){
    if(!canReconcile())return showToast('Admin or Super Admin access required.','err');
    if(!confirm('Close this stock count and apply physical-count variances to live stock? This creates audited adjustment movements.'))return;
    const r=await db.rpc('close_stock_count',{p_count_id:id});if(r.error)return showToast(r.error.message,'err');
    showToast('Stock count closed and variances applied.');inv.locations=[];inv.balances=[];await openStockCount(id);
  };

  window.exportStockMovementCSV=function(){
    const rows=filteredMovements();
    const cols=['Date','Type','Code','Item','Qty','From','To','Reference','Counterparty','Remark','Created By'];
    const val=v=>`"${String(v??'').replaceAll('"','""')}"`;
    const csv=[cols.map(val).join(','),...rows.map(m=>[
      m.movement_date,movementLabel(m.movement_type),m.code,m.item_name,m.qty,m.from_location,m.to_location,
      m.reference_no,m.counterparty,m.note,m.created_by_name
    ].map(val).join(','))].join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='Stock_Movement_'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(a.href);
  };

  // Stock Controller gets a stock-safe Product catalog: product identity + live stock, without costing/payment controls.
  const previousRenderProducts=window.renderProducts;
  if(typeof previousRenderProducts==='function'){
    window.renderProducts=async function(){
      if(role()!=='stock_controller')return previousRenderProducts.apply(this,arguments);
      await loadCore(true);
      state.productQuery=state.productQuery||'';
      const s=String(state.productQuery||'').toLowerCase();
      const rows=inv.balances.filter(p=>!s||[p.code,p.item_name,p.brand,p.class].filter(Boolean).join(' ').toLowerCase().includes(s));
      document.getElementById('content').innerHTML=`
        <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
          <input id="stockControllerProductSearch" value="${esc(state.productQuery||'')}" oninput="stockControllerProductSearch(this.value)" class="border rounded-xl px-4 py-2 w-full max-w-md" placeholder="Search code, item, brand...">
          <button onclick="go('stock-inventory')" class="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-sm font-semibold">Open Stock & Inventory</button>
        </div>
        <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 mb-4"><b>Stock Controller view:</b> product identity and inventory quantities only. Confidential costing and commercial pricing controls are not shown here.</div>
        <div class="text-xs text-gray-400 mb-3">${rows.length.toLocaleString()} products</div>
        <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          ${rows.slice(0,900).map(p=>`<button onclick="openProductStockHistory('${p.product_id}')" class="card rounded-2xl p-4 flex gap-4 text-left hover:shadow-md transition w-full">
            <div class="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden shrink-0">${p.image_url?`<img src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[9px] text-gray-400">No image</div>'}</div>
            <div class="min-w-0 flex-1">
              <div class="text-[10px] gold font-bold truncate">${esc(p.code||'')}</div>
              <div class="font-semibold truncate">${esc(p.item_name||'')}</div>
              <div class="text-xs text-gray-400 truncate">${esc(p.brand||'')}</div>
              <div class="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                <div><span class="text-gray-400">On Hand</span><div class="font-bold text-sm">${q(p.on_hand)}</div></div>
                <div><span class="text-gray-400">Reserved</span><div class="font-bold text-sm text-amber-600">${q(p.reserved)}</div></div>
                <div><span class="text-gray-400">Available</span><div class="font-bold text-sm text-green-600">${q(p.available)}</div></div>
              </div>
            </div>
          </button>`).join('')||'<div class="col-span-full py-12 text-center text-sm text-gray-400">No products found.</div>'}
        </div>
        ${rows.length>900?'<div class="mt-4 text-center text-xs text-gray-400">Showing first 900 results. Use search to narrow the list.</div>':''}
      `;
    };
  }

  window.stockControllerProductSearch=function(v){
    state.productQuery=v||'';
    return window.renderProducts();
  };

  // Navigation / permissions.
  const previousNavItems=window.navItems;
  if(typeof previousNavItems==='function'){
    window.navItems=function(){
      const items=previousNavItems.apply(this,arguments)||[];
      if(role()==='stock_controller'){
        return [['products','Products','◇'],['stock-inventory','Stock & Inventory','▦']];
      }
      if(!canView())return items.filter(x=>x[0]!=='stock-inventory');
      if(items.some(x=>x[0]==='stock-inventory'))return items;
      const out=[];let placed=false;
      for(const x of items){
        out.push(x);
        if(x[0]==='products'){out.push(['stock-inventory','Stock & Inventory','▦']);placed=true;}
      }
      if(!placed)out.push(['stock-inventory','Stock & Inventory','▦']);
      return out;
    };
  }

  const previousGo=window.go;
  if(typeof previousGo==='function'){
    window.go=async function(page){
      if(role()==='stock_controller'&&page==='dashboard')page='stock-inventory';
      if(page!=='stock-inventory')return previousGo.apply(this,[page]);
      if(!canView())return showToast('Inventory access required.','err');
      state.page='stock-inventory';renderNav();
      document.getElementById('pageTitle').textContent='Stock & Inventory';
      document.getElementById('pageSubtitle').textContent='Live stock balance, movement ledger, PO receiving, customer release and month-end reconciliation';
      document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
      try{await renderStockInventory()}catch(err){document.getElementById('content').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
    };
  }

  // Make stock movement functions available to other modules such as Manage PO.
  window.inventoryCanOperate=canOperate;

  try{
    if(state?.profile){
      renderNav();
      if(role()==='stock_controller'&&state.page==='dashboard')setTimeout(()=>go('stock-inventory'),0);
    }
  }catch(_){}
})();