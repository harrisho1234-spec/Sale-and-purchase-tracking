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
    agingRows:[],
    agingMap:new Map(),
    locationFilter:'',
    ageFilter:'',
    reportPeriod:'week',
    reportFrom:'',
    reportTo:'',
    taskBadges:{},
    taskData:{},
    taskLoadedAt:0,
    limits:{balance:30,movements:30,receive:30,delivery:30,counts:30,reports:30,requests:30}
  };

  function role(){return state.profile?.role||''}
  function canView(){return ['stock_controller','accountant','manager','admin','super_admin'].includes(role())}
  function canOperate(){return ['stock_controller','admin','super_admin'].includes(role())}
  function canAdmin(){return ['admin','super_admin'].includes(role())}
  function canReconcile(){return canAdmin()}
  function isStockController(){return role()==='stock_controller'}
  function n(v){return Number(v||0)}
  function stockLocationLabel(loc){
    const code=String(loc?.code||'').trim();
    const name=String(loc?.name||'').trim();
    if(!name||name.toLowerCase()===code.toLowerCase())return code||name;
    return code&&name?`${code} · ${name}`:(code||name);
  }
  function stockWholeQtyInput(id,allowZero=false,label='Quantity'){
    const el=document.getElementById(id);
    const raw=String(el?.value??'').trim();
    const x=Number(raw);
    const ok=raw!==''&&Number.isInteger(x)&&(allowZero?x>=0:x>0);
    if(!ok){
      showToast(label+' must be a whole number '+(allowZero?'(0, 1, 2, 3...)':'(1, 2, 3...)')+'. Decimals are not allowed.','err');
      el?.focus();
      return null;
    }
    return x;
  }
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
    return `<option value="">${esc(blankLabel)}</option>${inv.locations.filter(x=>x.active).map(x=>`<option value="${x.id}" ${String(selected)===String(x.id)?'selected':''}>${esc(stockLocationLabel(x))}</option>`).join('')}`;
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
    const [locs,bals,aging]=await Promise.all([
      db.from('stock_locations').select('*').order('sort_order').order('code'),
      db.from('inventory_product_balance').select('*').order('item_name'),
      db.rpc('get_inventory_stock_aging')
    ]);
    if(locs.error)throw locs.error;if(bals.error)throw bals.error;if(aging.error)throw aging.error;
    inv.locations=locs.data||[];
    inv.balances=bals.data||[];
    inv.agingRows=aging.data||[];
    inv.agingMap=new Map(inv.agingRows.map(x=>[x.product_id,x]));
    inv.balanceMap=new Map(inv.balances.map(x=>[x.product_id,x]));
    window.inventoryBalanceMap=inv.balanceMap;
  }

  function injectStyles(){
    if(document.getElementById('inventory-workspace-css'))return;
    const st=document.createElement('style');st.id='inventory-workspace-css';st.textContent=`
      .inv-tabs{display:flex;gap:4px;overflow:auto;border-bottom:1px solid #e9e5de;margin-bottom:18px}
      .inv-tab{white-space:nowrap;padding:11px 13px;font-size:12px;font-weight:700;color:#8b8b95;border-bottom:2px solid transparent}
      .inv-tab.active{color:#171717;border-bottom-color:#b38b2e}
      .inv-tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:5px;border-radius:999px;background:#f3f4f6;color:#6b7280;font-size:9px;font-weight:800}
      .inv-tab.active .inv-tab-badge{background:#fff4d6;color:#8a5a00}
      .inv-task-card{background:#fff;border:1px solid #ece8e0;border-radius:15px;padding:14px;text-align:left;transition:.15s ease}
      .inv-task-card:hover{box-shadow:0 5px 16px rgba(0,0,0,.05);transform:translateY(-1px)}
      .inv-progress-track{height:7px;border-radius:999px;background:#f1f1f1;overflow:hidden}
      .inv-progress-fill{height:100%;border-radius:999px;background:#b38b2e;transition:width .15s ease}
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

  function invalidateInventoryTasks(){inv.taskLoadedAt=0}

  async function loadInventoryTasks(force=false){
    const now=Date.now();
    if(!force&&inv.taskLoadedAt&&now-inv.taskLoadedAt<30000)return inv.taskData;
    const [poQ,delQ,countQ,reqQ]=await Promise.all([
      db.rpc('get_inventory_po_receiving_queue',{p_search:null}),
      db.rpc('get_inventory_delivery_queue',{p_search:null}),
      db.from('stock_counts').select('id,status,period_month,location_id,created_at,stock_locations(code,name)').order('period_month',{ascending:false}).limit(500),
      (canAdmin()||isStockController())
        ?db.from('stock_change_requests').select('id,status,requested_by,requested_at').order('requested_at',{ascending:false}).limit(500)
        :Promise.resolve({data:[],error:null})
    ]);
    if(poQ.error)throw poQ.error;
    if(delQ.error)throw delQ.error;
    if(countQ.error)throw countQ.error;
    if(reqQ.error)throw reqQ.error;

    const today=new Date().toISOString().slice(0,10);
    const plus7=new Date();plus7.setDate(plus7.getDate()+7);
    const plus7Iso=plus7.toISOString().slice(0,10);
    const poRows=poQ.data||[],delRows=delQ.data||[],countRows=countQ.data||[],reqRows=reqQ.data||[];
    const openCounts=countRows.filter(x=>String(x.status||'').toLowerCase()!=='closed');
    const pendingRequests=reqRows.filter(x=>String(x.status||'').toLowerCase()==='pending');
    const duePO=poRows.filter(x=>x.eta&&String(x.eta).slice(0,10)<=plus7Iso);
    const overduePO=poRows.filter(x=>x.eta&&String(x.eta).slice(0,10)<today);
    const aged365=inv.agingRows.filter(x=>x.age_bucket==='365+').length;
    const unassigned=inv.balances.filter(p=>(p.locations||[]).some(l=>String(l.code||'').toUpperCase()==='UNASSIGNED'&&n(l.qty)>0)).length;

    inv.taskBadges={
      receive:poRows.length,
      delivery:delRows.length,
      counts:openCounts.length,
      requests:pendingRequests.length
    };
    inv.taskData={poRows,delRows,countRows,reqRows,openCounts,pendingRequests,duePO,overduePO,aged365,unassigned};
    inv.taskLoadedAt=now;
    return inv.taskData;
  }

  function savedInventoryViewsKey(){
    return 'limperial_inventory_views_'+String(state.user?.id||state.profile?.email||role()||'user');
  }
  function savedInventoryViews(){
    try{
      const x=JSON.parse(localStorage.getItem(savedInventoryViewsKey())||'[]');
      return Array.isArray(x)?x:[];
    }catch{return []}
  }
  function writeSavedInventoryViews(rows){
    localStorage.setItem(savedInventoryViewsKey(),JSON.stringify(rows||[]));
  }
  window.saveCurrentInventoryView=function(){
    const name=prompt('Name this Stock view:');
    if(!name||!name.trim())return;
    const rows=savedInventoryViews();
    const clean=name.trim();
    const view={name:clean,tab:inv.tab,search:inv.search||'',locationFilter:inv.locationFilter||'',ageFilter:inv.ageFilter||''};
    const idx=rows.findIndex(x=>String(x.name||'').toLowerCase()===clean.toLowerCase());
    if(idx>=0)rows[idx]=view;else rows.push(view);
    writeSavedInventoryViews(rows.slice(-20));
    showToast('Stock view saved.');
    renderStockInventoryBody();
  };
  window.applySavedInventoryView=function(index){
    if(index==='')return;
    const row=savedInventoryViews()[Number(index)];
    if(!row)return;
    inv.tab=row.tab||'balance';
    inv.search=row.search||'';
    inv.locationFilter=row.locationFilter||'';
    inv.ageFilter=row.ageFilter||'';
    resetInventoryLimit(inv.tab);
    renderStockInventory();
  };
  window.openSavedInventoryViews=function(){
    const rows=savedInventoryViews();
    openModal('Saved Stock Views',`<div class="space-y-3">
      ${rows.length?rows.map((x,i)=>`<div class="rounded-xl border p-3 flex items-center justify-between gap-3"><button onclick="applySavedInventoryView('${i}');closeModal()" class="text-left min-w-0"><b class="text-sm">${esc(x.name||'Saved View')}</b><div class="text-[10px] text-gray-400 mt-1">${esc(titleCase(x.tab||'balance'))}${x.locationFilter?' · Location filter':''}${x.ageFilter?' · Aging '+esc(x.ageFilter):''}${x.search?' · Search: '+esc(x.search):''}</div></button><button onclick="deleteSavedInventoryView(${i})" class="px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-[10px] font-semibold">Delete</button></div>`).join(''):'<div class="py-10 text-center text-sm text-gray-400">No saved Stock views yet.</div>'}
    </div>`);
  };
  window.deleteSavedInventoryView=function(index){
    const rows=savedInventoryViews();rows.splice(Number(index),1);writeSavedInventoryViews(rows);openSavedInventoryViews();
  };

  function tabs(){
    const t=[
      ['dashboard','Dashboard',0],
      ['movements','Movements',0],
      ['balance','Stock Balance',0],
      ['receive','Receive PO',inv.taskBadges.receive||0],
      ['delivery','Customer Delivery',inv.taskBadges.delivery||0]
    ];
    t.push(['counts','Stock Count',inv.taskBadges.counts||0],['reports','Reports',0]);
    if(canAdmin()||isStockController())t.push(['requests',canAdmin()?'Edit Requests':'My Requests',inv.taskBadges.requests||0]);
    return t;
  }

  function topActions(){
    if(!canOperate())return '';
    return `<div class="flex gap-2 flex-wrap justify-end">
      <button onclick="openQuickStockAction()" class="px-3 py-2 bg-[#211d18] text-white rounded-xl text-xs font-semibold">＋ Quick Stock Action</button>
      <button onclick="openStockTransfer()" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">⇄ Transfer</button>
    </div>`;
  }

  window.quickInventoryGo=function(tab,startCount=false){
    closeModal();inv.tab=tab;inv.search='';resetInventoryLimit(tab);renderStockInventory();
    if(startCount)setTimeout(()=>openStartStockCount(),250);
  };
  window.openQuickStockAction=function(){
    if(!canOperate())return;
    const btn=(title,sub,action,tone='')=>`<button onclick="${action}" class="text-left rounded-xl border p-3 hover:shadow-sm ${tone}"><div class="font-bold text-sm">${title}</div><div class="text-[10px] text-gray-500 mt-1">${sub}</div></button>`;
    openModal('Quick Stock Action',`<div class="grid sm:grid-cols-2 gap-3">
      ${btn('Receive PO','Receive incoming supplier items into a location',"quickInventoryGo('receive')",'bg-blue-50/40 border-blue-100')}
      ${btn('Transfer Location','Move existing stock from one location to another',"openStockTransfer()",'bg-blue-50/40 border-blue-100')}
      ${btn('Stock OUT','Manual stock release / OUT',"openStockMovement('out')",'bg-red-50/40 border-red-100')}
      ${btn('Customer Return','Return stock back into a location',"openStockMovement('return')",'bg-green-50/40 border-green-100')}
      ${btn('Broken / Damaged','Record damaged stock and reduce a location',"openStockMovement('broken')",'bg-amber-50/40 border-amber-100')}
      ${btn('Stock IN','Manual stock addition into a location',"openStockMovement('in')",'bg-green-50/40 border-green-100')}
      ${btn('Customer Delivery','Release tracked customer stock orders',"quickInventoryGo('delivery')")}
      ${btn('Start Stock Count','Start a monthly physical count for a location',"quickInventoryGo('counts',true)")}
      ${btn('Find Product','Search a product and open its Stock Card',"openInventoryProductFinder()")}
    </div>`);
  };

  window.openInventoryProductFinder=async function(){
    await loadCore();
    openModal('Find Product',`<div><label class="text-xs font-semibold">SKU / Product / Brand</label><div class="relative"><input id="invFindProduct" autocomplete="off" onfocus="showInventoryFinderSuggestions(this)" oninput="showInventoryFinderSuggestions(this)" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Type SKU, item name or brand..."><div id="invFindSuggestions" class="absolute z-[150] left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-white border rounded-xl shadow-xl"></div></div></div>`);
    setTimeout(()=>document.getElementById('invFindProduct')?.focus(),50);
  };
  window.showInventoryFinderSuggestions=function(input){
    const box=document.getElementById('invFindSuggestions');if(!box)return;
    const rows=stockProductMatches(input?.value||'').slice(0,30);
    box.innerHTML=rows.length?rows.map(p=>`<button onclick="openProductStockCard('${p.product_id}')" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-0 flex gap-3 items-center"><div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p.image_url?`<img src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'')}</div><div class="font-semibold text-sm truncate">${esc(p.item_name||'')}</div><div class="text-[10px] text-gray-400">On hand ${q(p.on_hand)} · Available ${q(p.available)} · Incoming ${q(p.incoming)}</div></div></button>`).join(''):'<div class="p-4 text-sm text-gray-400">No matching product.</div>';
  };


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

  function ageLabel(a){
    if(!a||a.age_bucket==='Unknown')return 'Unknown';
    return `${a.age_bucket} days`;
  }
  function ageBadgeClass(bucket){
    if(bucket==='0-30')return 'bg-green-50 text-green-700 border-green-200';
    if(bucket==='31-90')return 'bg-blue-50 text-blue-700 border-blue-200';
    if(bucket==='91-180')return 'bg-amber-50 text-amber-700 border-amber-200';
    if(bucket==='181-365'||bucket==='365+')return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-gray-50 text-gray-500 border-gray-200';
  }
  function inventoryFilterControls(context){
    const locOptions=inv.locations.filter(x=>x.active).map(x=>`<option value="${x.id}" ${String(inv.locationFilter)===String(x.id)?'selected':''}>${esc(stockLocationLabel(x))}</option>`).join('');
    const ages=[['','All Aging'],['0-30','0–30 days'],['31-90','31–90 days'],['91-180','91–180 days'],['181-365','181–365 days'],['365+','365+ days'],['Unknown','Unknown / Pre-history']];
    const saved=savedInventoryViews();
    return `<div class="mb-4 flex flex-wrap gap-2 items-center">
      <select onchange="setInventoryLocationFilter(this.value)" class="border rounded-xl px-3 py-2 bg-white text-xs"><option value="">All Locations</option>${locOptions}</select>
      <select onchange="setInventoryAgeFilter(this.value)" class="border rounded-xl px-3 py-2 bg-white text-xs">${ages.map(([v,l])=>`<option value="${v}" ${inv.ageFilter===v?'selected':''}>${l}</option>`).join('')}</select>
      <select onchange="applySavedInventoryView(this.value);this.value=''" class="border rounded-xl px-3 py-2 bg-white text-xs"><option value="">Saved Views</option>${saved.map((x,i)=>`<option value="${i}">${esc(x.name||'Saved View')}</option>`).join('')}</select>
      <button onclick="saveCurrentInventoryView()" class="px-3 py-2 border rounded-xl text-xs font-semibold bg-white">Save View</button>
      ${saved.length?`<button onclick="openSavedInventoryViews()" class="px-3 py-2 border rounded-xl text-xs bg-white text-gray-500">Manage</button>`:''}
      ${inv.locationFilter||inv.ageFilter?`<button onclick="clearInventoryFilters()" class="px-3 py-2 border rounded-xl text-xs font-semibold bg-white">Clear Filters</button>`:''}
      <div class="text-[10px] text-gray-400 ml-auto">Aging uses the oldest remaining recorded inbound layer (FIFO estimate). Stock older than imported history appears as Unknown.</div>
    </div>`;
  }
  window.setInventoryLocationFilter=function(v){inv.locationFilter=v||'';resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  window.setInventoryAgeFilter=function(v){inv.ageFilter=v||'';resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  window.clearInventoryFilters=function(){inv.locationFilter='';inv.ageFilter='';resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  function productPassesInventoryFilters(p){
    if(inv.locationFilter){
      const ok=(p.locations||[]).some(l=>String(l.location_id)===String(inv.locationFilter)&&n(l.qty)!==0);
      if(!ok)return false;
    }
    if(inv.ageFilter){
      const a=inv.agingMap.get(p.product_id);
      if((a?.age_bucket||'Unknown')!==inv.ageFilter)return false;
    }
    return true;
  }

  function balanceFiltered(){
    const s=String(inv.search||'').trim().toLowerCase();
    return inv.balances.filter(x=>{
      const searchOk=!s||[
        x.code,x.item_name,x.brand,x.class,
        ...(Array.isArray(x.locations)?x.locations.map(l=>l.code):[])
      ].filter(Boolean).join(' ').toLowerCase().includes(s);
      return searchOk&&productPassesInventoryFilters(x);
    });
  }

  async function renderBalance(){
    await loadCore();
    const rows=balanceFiltered(),shown=rows.slice(0,inventoryLimit('balance'));
    return `${inventoryFilterControls('balance')}<div class="card rounded-2xl overflow-hidden">
      <div class="divide-y">${shown.length?shown.map(p=>{const a=inv.agingMap.get(p.product_id);return `<div class="p-4 grid xl:grid-cols-[1.55fr_80px_80px_80px_80px_105px_1.4fr_165px] gap-3 items-center">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden shrink-0">${p.image_url?`<img src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
          <div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code)}</div><div class="font-semibold text-sm truncate">${esc(p.item_name)}</div><div class="text-[10px] text-gray-400">${esc(p.brand||'')}</div></div>
        </div>
        <div class="text-xs"><div class="text-gray-400">On Hand</div><b class="text-sm">${q(p.on_hand)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Reserved</div><b class="text-sm text-amber-600">${q(p.reserved)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Available</div><b class="text-sm ${n(p.available)<0?'text-red-600':'text-green-600'}">${q(p.available)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Incoming</div><b class="text-sm text-blue-600">${q(p.incoming)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Aging</div><span class="inline-flex mt-1 px-2 py-1 rounded-lg border text-[9px] font-bold ${ageBadgeClass(a?.age_bucket||'Unknown')}">${esc(ageLabel(a))}</span>${a?.oldest_remaining_date?`<div class="text-[9px] text-gray-400 mt-1">Since ${esc(dateText(a.oldest_remaining_date))}</div>`:''}</div>
        <div class="text-[10px] text-gray-500">${(p.locations||[]).filter(l=>n(l.qty)!==0).map(l=>`<span class="inline-flex mr-1 mb-1 px-2 py-1 rounded-lg border ${inv.locationFilter&&String(l.location_id)===String(inv.locationFilter)?'bg-blue-50 border-blue-200 text-blue-700':'bg-gray-50'}"><b>${esc(l.code)}</b>&nbsp;${q(l.qty)}</span>`).join('')||'<span class="text-gray-400">No stock location</span>'}</div>
        <div class="flex gap-1.5 justify-end">${canOperate()?`<button onclick="openStockTransfer('${p.product_id}')" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-semibold">Move</button>`:''}<button onclick="openProductStockHistory('${p.product_id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">History</button></div>
      </div>`}).join(''):'<div class="p-10 text-center text-sm text-gray-400">No products match your search / filters.</div>'}</div>
      ${inventoryListControls('balance',rows.length)}
    </div>`;
  }

  function movementRow(m){
    const path=m.from_location&&m.to_location?`${m.from_location} → ${m.to_location}`:m.to_location?`→ ${m.to_location}`:m.from_location?`${m.from_location} →`:'-';
    const p=m.product_id?inv.balanceMap.get(m.product_id):null;
    const liveId=!m.legacy&&String(m.history_id||'').startsWith('live:')?String(m.history_id).slice(5):'';
    const moveBtn=canOperate()&&m.product_id?`<button onclick="openStockTransfer('${m.product_id}')" class="px-2 py-1.5 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-[9px] font-semibold">Move</button>`:'';
    let actions='';
    if(canAdmin()){
      actions=`<div class="flex gap-1.5 flex-wrap justify-end">${moveBtn}<button onclick="openAdminStockMovementEdit('${esc(m.history_id||'')}')" class="px-2 py-1.5 border rounded-lg text-[9px] font-semibold">Edit</button><button onclick="deleteStockMovementAdmin('${esc(m.history_id||'')}')" class="px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-[9px] font-semibold">Delete</button></div>`;
    }else if(isStockController()&&liveId){
      actions=`<div class="flex gap-1.5 flex-wrap justify-end">${moveBtn}<button onclick="openStockMovementEditRequest('${liveId}')" class="px-2 py-1.5 border border-amber-200 bg-amber-50 text-amber-700 rounded-lg text-[9px] font-semibold">Request Edit</button><button onclick="requestStockMovementDelete('${liveId}')" class="px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-[9px] font-semibold">Request Delete</button></div>`;
    }else if(moveBtn){
      actions=`<div class="flex gap-1.5 flex-wrap justify-end">${moveBtn}</div>`;
    }
    return `<div class="py-3 grid md:grid-cols-[105px_1.55fr_110px_90px_1fr_170px] gap-3 items-center text-xs">
      <div><b>${esc(dateText(m.movement_date))}</b><div class="text-[9px] text-gray-400">${esc(m.created_by_name||'System')}${m.legacy?' · Historical':''}</div></div>
      <div class="flex items-center gap-3 min-w-0"><div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p?.image_url?`<img src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(m.code||'')}</div><div class="font-semibold truncate">${esc(m.item_name||'')}</div><div class="text-[9px] text-gray-400 truncate">${esc(m.reference_no||m.counterparty||'')}</div></div></div>
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

  function isoLocalDate(d){
    const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function reportRange(type,base=new Date()){
    const d=new Date(base.getFullYear(),base.getMonth(),base.getDate());
    let from=new Date(d),to=new Date(d);
    if(type==='week'){
      const dow=(d.getDay()+6)%7;
      from.setDate(d.getDate()-dow);
      to=new Date(from);to.setDate(from.getDate()+6);
    }else if(type==='month'){
      from=new Date(d.getFullYear(),d.getMonth(),1);
      to=new Date(d.getFullYear(),d.getMonth()+1,0);
    }else if(type==='quarter'){
      const qm=Math.floor(d.getMonth()/3)*3;
      from=new Date(d.getFullYear(),qm,1);
      to=new Date(d.getFullYear(),qm+3,0);
    }
    return {from:isoLocalDate(from),to:isoLocalDate(to)};
  }
  function ensureReportRange(){
    if(inv.reportFrom&&inv.reportTo)return;
    const r=reportRange(inv.reportPeriod||'week');
    inv.reportFrom=r.from;inv.reportTo=r.to;
  }
  function longReportDate(v){
    if(!v)return '-';
    const d=new Date(v+'T00:00:00');
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  }
  window.setStockReportPeriod=function(type){
    inv.reportPeriod=type;
    const r=reportRange(type);
    inv.reportFrom=r.from;inv.reportTo=r.to;
    resetInventoryLimit('reports');renderStockInventoryBody();
  };
  window.setStockReportDate=function(which,value){
    inv.reportPeriod='custom';
    if(which==='from')inv.reportFrom=value||'';
    else inv.reportTo=value||'';
    resetInventoryLimit('reports');renderStockInventoryBody();
  };
  function reportPeriodControls(){
    ensureReportRange();
    const btn=(v,l)=>`<button onclick="setStockReportPeriod('${v}')" class="px-3 py-2 rounded-xl border text-xs font-semibold ${inv.reportPeriod===v?'bg-[#211d18] text-white border-[#211d18]':'bg-white'}">${l}</button>`;
    return `<div class="inv-card mb-4">
      <div class="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
        <div>
          <div class="text-[9px] uppercase font-bold text-gray-400 mb-2">Report Period</div>
          <div class="flex flex-wrap gap-2">${btn('week','Weekly')}${btn('month','Monthly')}${btn('quarter','Quarterly')}</div>
        </div>
        <div class="grid sm:grid-cols-2 gap-2">
          <div><label class="text-[9px] uppercase font-bold text-gray-400">From Date</label><input type="date" value="${esc(inv.reportFrom)}" onchange="setStockReportDate('from',this.value)" class="mt-1 border rounded-xl px-3 py-2 text-xs"></div>
          <div><label class="text-[9px] uppercase font-bold text-gray-400">To Date</label><input type="date" value="${esc(inv.reportTo)}" onchange="setStockReportDate('to',this.value)" class="mt-1 border rounded-xl px-3 py-2 text-xs"></div>
        </div>
      </div>
    </div>`;
  }
  function movementOverallDelta(m){
    const qty=n(m.qty);
    if(['in','return','adjustment_in','po_receipt'].includes(m.movement_type))return qty;
    if(['out','broken','adjustment_out','sale_delivery'].includes(m.movement_type))return -qty;
    return 0;
  }
  function movementLocationDelta(m,locationCode){
    if(!locationCode)return movementOverallDelta(m);
    const qty=n(m.qty);
    if(m.movement_type==='transfer'){
      let d=0;if(m.to_location===locationCode)d+=qty;if(m.from_location===locationCode)d-=qty;return d;
    }
    if(['in','return','adjustment_in','po_receipt'].includes(m.movement_type))return m.to_location===locationCode?qty:0;
    if(['out','broken','adjustment_out','sale_delivery'].includes(m.movement_type))return m.from_location===locationCode?-qty:0;
    return 0;
  }
  function reportLocation(){
    return inv.locations.find(x=>String(x.id)===String(inv.locationFilter))||null;
  }
  function balanceAsOfMap(endDate){
    const loc=reportLocation(),locCode=loc?.code||'';
    const deltaAfter=new Map();
    for(const m of inv.movementRows){
      if(!m.product_id||!m.movement_date||m.movement_date<=endDate)continue;
      const d=movementLocationDelta(m,locCode);
      deltaAfter.set(m.product_id,(deltaAfter.get(m.product_id)||0)+d);
    }
    const out=new Map();
    for(const p of inv.balances){
      let current=n(p.on_hand);
      if(loc){
        const l=(p.locations||[]).find(x=>String(x.location_id)===String(loc.id)||x.code===loc.code);
        current=n(l?.qty);
      }
      out.set(p.product_id,current-(deltaAfter.get(p.product_id)||0));
    }
    return out;
  }
  function previousISODate(v){
    const d=new Date(v+'T00:00:00');d.setDate(d.getDate()-1);return isoLocalDate(d);
  }
  function buildStockPeriodSummary(rows){
    ensureReportRange();
    const opening=balanceAsOfMap(previousISODate(inv.reportFrom));
    const ending=balanceAsOfMap(inv.reportTo);
    const loc=reportLocation(),locCode=loc?.code||'';
    const agg=new Map();

    for(const p of inv.balances){
      const search=String(inv.search||'').trim().toLowerCase();
      const searchOk=!search||[p.code,p.item_name,p.brand,p.class].filter(Boolean).join(' ').toLowerCase().includes(search);
      if(!searchOk)continue;
      if(inv.ageFilter&&(inv.agingMap.get(p.product_id)?.age_bucket||'Unknown')!==inv.ageFilter)continue;
      agg.set(p.product_id,{product_id:p.product_id,code:p.code||'',item_name:p.item_name||'',brand:p.brand||'',opening:n(opening.get(p.product_id)),ending:n(ending.get(p.product_id)),in:0,out:0,return:0,broken:0,transfer_in:0,transfer_out:0});
    }
    for(const m of rows){
      if(!m.product_id||!agg.has(m.product_id))continue;
      const a=agg.get(m.product_id),qty=n(m.qty);
      if(['in','adjustment_in','po_receipt'].includes(m.movement_type))a.in+=qty;
      else if(['out','adjustment_out','sale_delivery'].includes(m.movement_type))a.out+=qty;
      else if(m.movement_type==='return')a.return+=qty;
      else if(m.movement_type==='broken')a.broken+=qty;
      else if(m.movement_type==='transfer'){
        if(locCode){
          if(m.to_location===locCode)a.transfer_in+=qty;
          if(m.from_location===locCode)a.transfer_out+=qty;
        }else{
          a.transfer_in+=qty;a.transfer_out+=qty;
        }
      }
    }
    return [...agg.values()].filter(a=>Math.abs(a.opening)>0.000001||Math.abs(a.ending)>0.000001||a.in||a.out||a.return||a.broken||a.transfer_in||a.transfer_out).sort((a,b)=>String(a.code).localeCompare(String(b.code)));
  }

  function reportFilteredMovements(){
    ensureReportRange();
    const base=filteredMovements();
    const loc=reportLocation();
    return base.filter(m=>{
      if(inv.reportFrom&&m.movement_date<inv.reportFrom)return false;
      if(inv.reportTo&&m.movement_date>inv.reportTo)return false;
      if(loc&&m.from_location!==loc.code&&m.to_location!==loc.code)return false;
      if(inv.ageFilter){
        const a=inv.agingMap.get(m.product_id);
        if((a?.age_bucket||'Unknown')!==inv.ageFilter)return false;
      }
      return true;
    });
  }

  async function renderMovements(){
    await loadMovements();
    const rows=filteredMovements(),shown=rows.slice(0,inventoryLimit('movements'));
    return `<div class="inv-card"><div class="divide-y">${shown.length?shown.map(m=>movementRow(m)).join(''):'<div class="py-10 text-center text-xs text-gray-400">No movements found.</div>'}</div>${inventoryListControls('movements',rows.length)}</div>`;
  }

  window.toggleInventoryPOGroup=function(poId){
    const id=String(poId||'');
    if(!id)return;
    const expanded=!inv.poExpanded.has(id);
    if(expanded)inv.poExpanded.add(id);else inv.poExpanded.delete(id);

    // Expand/collapse in place so the Receive PO list keeps its current scroll position.
    const domKey=encodeURIComponent(id);
    const detail=document.getElementById('inv-po-detail-'+domKey);
    const label=document.getElementById('inv-po-label-'+domKey);
    const icon=document.getElementById('inv-po-icon-'+domKey);

    if(detail)detail.classList.toggle('hidden',!expanded);
    if(label)label.textContent=expanded?'Hide Items':'View / Receive Items';
    if(icon)icon.textContent=expanded?'↑':'↓';
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
          <div class="text-right text-xs font-semibold text-[#a77d1a]"><span id="inv-po-label-${encodeURIComponent(g.id)}">${expanded?'Hide Items':'View / Receive Items'}</span> <span id="inv-po-icon-${encodeURIComponent(g.id)}">${expanded?'↑':'↓'}</span></div>
        </button>
        <div id="inv-po-detail-${encodeURIComponent(g.id)}" class="${expanded?'':'hidden'} border-t bg-[#faf9f6]">
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
    ensureReportRange();
    const rows=reportFilteredMovements(),shown=rows.slice(0,inventoryLimit('reports'));
    const summary=buildStockPeriodSummary(rows),summaryShown=summary.slice(0,inventoryLimit('reports'));
    const ins=rows.filter(x=>['in','adjustment_in','po_receipt'].includes(x.movement_type)).reduce((a,x)=>a+n(x.qty),0);
    const outs=rows.filter(x=>['out','adjustment_out','sale_delivery'].includes(x.movement_type)).reduce((a,x)=>a+n(x.qty),0);
    const returns=rows.filter(x=>x.movement_type==='return').reduce((a,x)=>a+n(x.qty),0);
    const transfers=rows.filter(x=>x.movement_type==='transfer').reduce((a,x)=>a+n(x.qty),0);
    const broken=rows.filter(x=>x.movement_type==='broken').reduce((a,x)=>a+n(x.qty),0);
    const historical=rows.filter(x=>x.legacy).length;
    const live=rows.length-historical;
    const endingQty=summary.reduce((a,x)=>a+n(x.ending),0);
    const loc=reportLocation();
    return `${reportPeriodControls()}${inventoryFilterControls('reports')}
    <div class="rounded-2xl border border-amber-200 bg-[#fffaf0] p-4 mb-4">
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div><div class="text-[10px] uppercase font-bold text-[#a77d1a]">${inv.reportPeriod==='custom'?'Custom':titleCase(inv.reportPeriod)} Stock Report</div><h3 class="text-lg font-bold mt-1">Stock Report from (${esc(longReportDate(inv.reportFrom))}) to (${esc(longReportDate(inv.reportTo))})</h3><div class="text-[10px] text-gray-500 mt-1">${loc?'Location: '+esc(loc.code+' · '+loc.name):'All Locations'}${inv.ageFilter?' · Aging: '+esc(inv.ageFilter)+' days':''}</div></div>
        <button onclick="exportStockReportExcel()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Export Styled Excel Report</button>
      </div>
    </div>
    <div class="grid sm:grid-cols-2 xl:grid-cols-6 gap-3 mb-4">
      <div class="inv-stat"><div class="inv-stat-label">Ending Balance</div><div class="inv-stat-value">${q(endingQty)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">In</div><div class="inv-stat-value text-green-600">${q(ins)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Out</div><div class="inv-stat-value text-red-500">${q(outs)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Return</div><div class="inv-stat-value text-blue-600">${q(returns)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Broken</div><div class="inv-stat-value text-amber-700">${q(broken)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Transfer</div><div class="inv-stat-value text-purple-600">${q(transfers)}</div></div>
    </div>
    <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 mb-4"><b>Movement history:</b> ${historical.toLocaleString()} imported rows + ${live.toLocaleString()} live app movements in this report period.</div>

    <div class="mb-2 flex items-center justify-between"><div><h4 class="font-bold">Movement Detail</h4><div class="text-[10px] text-gray-400">Matches the movement section of your stock report template.</div></div></div>
    <div class="inv-card mb-5"><div class="divide-y">${shown.length?shown.map(m=>movementRow(m)).join(''):'<div class="py-10 text-center text-xs text-gray-400">No movement rows found for this period.</div>'}</div>${inventoryListControls('reports',rows.length)}</div>

    <div class="mb-2"><h4 class="font-bold">Ending Balance by Item Code</h4><div class="text-[10px] text-gray-400">Opening + In + Return − Out − Broken ± Transfers = Ending Balance for the selected period.</div></div>
    <div class="card rounded-2xl overflow-hidden">
      <div class="grid grid-cols-[1.1fr_2fr_85px_70px_70px_70px_70px_85px_85px_95px] gap-2 px-4 py-2.5 bg-gray-50 border-b text-[9px] uppercase font-bold text-gray-400">
        <div>Code</div><div>Item Name</div><div>Opening</div><div>In</div><div>Out</div><div>Return</div><div>Broken</div><div>Transfer In</div><div>Transfer Out</div><div>Ending</div>
      </div>
      <div class="divide-y">${summaryShown.length?summaryShown.map(x=>`<div class="grid grid-cols-[1.1fr_2fr_85px_70px_70px_70px_70px_85px_85px_95px] gap-2 px-4 py-3 items-center text-xs"><div class="font-bold text-[#a77d1a] truncate">${esc(x.code)}</div><div class="truncate">${esc(x.item_name)}</div><div>${q(x.opening)}</div><div class="text-green-600">${q(x.in)}</div><div class="text-red-500">${q(x.out)}</div><div class="text-blue-600">${q(x.return)}</div><div class="text-amber-700">${q(x.broken)}</div><div>${q(x.transfer_in)}</div><div>${q(x.transfer_out)}</div><div class="font-bold">${q(x.ending)}</div></div>`).join(''):'<div class="p-10 text-center text-sm text-gray-400">No ending-balance rows for this period/filter.</div>'}</div>
      ${summary.length>summaryShown.length?`<div class="p-3 text-center text-[10px] text-gray-400 border-t">Showing ${summaryShown.length.toLocaleString()} of ${summary.length.toLocaleString()} item codes on screen. Excel export includes all item codes.</div>`:''}
    </div>`;
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
          <div><label class="text-xs font-semibold">Qty</label><input id="aleQty" type="number" min="1" step="1" value="${n(m.qty)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
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
        const qty=stockWholeQtyInput('aleQty',false,'Quantity');if(qty==null)return;
        const x=await db.rpc('admin_update_stock_legacy_history',{
          p_id:Number(legacyId),p_movement_date:document.getElementById('aleDate').value||null,
          p_reference_no:document.getElementById('aleRef').value.trim()||null,
          p_counterparty:document.getElementById('aleParty').value.trim()||null,
          p_product_code:document.getElementById('aleCode').value.trim(),
          p_item_name:document.getElementById('aleItem').value.trim()||null,
          p_location_code:document.getElementById('aleLocation').value.trim()||null,
          p_qty:qty,
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
        <div><label class="text-xs font-semibold">Quantity</label><input id="aseQty" type="number" min="1" step="1" value="${n(m.qty)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
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
      const qty=stockWholeQtyInput('aseQty',false,'Quantity');if(qty==null)return;
      const x=await db.rpc('admin_update_stock_movement',{
        p_movement_id:id,p_movement_date:document.getElementById('aseDate').value||null,
        p_movement_type:locked?m.movement_type:document.getElementById('aseType').value,
        p_qty:qty,
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
        <div><label class="text-xs font-semibold">Quantity</label><input id="serQty" type="number" min="1" step="1" value="${n(m.qty)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div><div></div>
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
      const qty=stockWholeQtyInput('serQty',false,'Quantity');if(qty==null)return;
      const changes={
        movement_date:document.getElementById('serDate').value||m.movement_date,
        movement_type:locked?m.movement_type:document.getElementById('serType').value,
        qty:qty,
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
        <div><label class="text-xs font-semibold">Quantity *</label><input id="smQty" type="number" min="1" step="1" value="1" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
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
      const qty=stockWholeQtyInput('smQty',false,'Quantity');if(qty==null)return;
      const btn=document.getElementById('smSave');btn.disabled=true;btn.textContent='Saving...';
      const args={
        p_product_id:p.product_id,p_movement_type:document.getElementById('smType').value,
        p_qty:qty,
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
        <div><label class="text-xs font-semibold">Receive Qty *</label><input id="rpoQty" type="number" min="1" step="1" max="${n(x.remaining_qty)}" value="${n(x.remaining_qty)}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Receive To Location *</label><select id="rpoLocation" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${locationOptions()}</select></div>
        <div><label class="text-xs font-semibold">Receipt Date</label><input id="rpoDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Remark</label><input id="rpoNote" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>
      </div>
      <button id="rpoSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Confirm Receipt</button>
    </form>`);
    document.getElementById('receivePOForm').onsubmit=async e=>{
      e.preventDefault();
      const qty=stockWholeQtyInput('rpoQty',false,'Receive Qty');if(qty==null)return;
      const btn=document.getElementById('rpoSave');btn.disabled=true;btn.textContent='Receiving...';
      const r=await db.rpc('receive_po_stock',{p_supplier_po_item_id:itemId,p_qty:qty,p_location_id:document.getElementById('rpoLocation').value,p_receipt_date:document.getElementById('rpoDate').value||null,p_note:document.getElementById('rpoNote').value.trim()||null});
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
        <div><label class="text-xs font-semibold">Release Qty *</label><input id="rsQty" type="number" min="1" max="${n(x.remaining_qty)}" step="1" value="${n(x.remaining_qty)}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">From Location *</label><select id="rsLocation" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Select stock location</option>${locs.map(l=>`<option value="${l.location_id}">${esc(l.code)} · Available ${q(l.qty)}</option>`).join('')}</select></div>
        <div><label class="text-xs font-semibold">Delivery Date</label><input id="rsDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Remark</label><input id="rsNote" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      </div>
      <button id="rsSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Confirm Stock OUT</button>
    </form>`);
    document.getElementById('releaseStockForm').onsubmit=async e=>{
      e.preventDefault();
      const qty=stockWholeQtyInput('rsQty',false,'Release Qty');if(qty==null)return;
      const btn=document.getElementById('rsSave');btn.disabled=true;btn.textContent='Releasing...';
      const r=await db.rpc('release_sales_stock',{p_sales_order_item_id:itemId,p_qty:qty,p_location_id:document.getElementById('rsLocation').value,p_delivery_date:document.getElementById('rsDate').value||null,p_note:document.getElementById('rsNote').value.trim()||null});
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
    const physical=row.querySelector('.count-physical').value.trim();
    const qb=row.querySelector('.count-qb').value.trim();
    if(physical!==''&&(!Number.isInteger(Number(physical))||Number(physical)<0))return showToast('Physical Qty must be a whole number: 0, 1, 2, 3...','err');
    if(qb!==''&&(!Number.isInteger(Number(qb))||Number(qb)<0))return showToast('QB Qty must be a whole number: 0, 1, 2, 3...','err');
    const note=row.querySelector('.count-note').value.trim()||null;
    const r=await db.rpc('save_stock_count_item',{p_item_id:itemId,p_physical_qty:physical===''?null:Number(physical),p_qb_qty:qb===''?null:Number(qb),p_note:note});
    if(r.error)return showToast(r.error.message,'err');
    const system=n(row.dataset.system),p=physical===''?null:n(physical),qv=qb===''?null:n(qb);
    row.querySelector('.count-var').textContent=p==null?'-':q(p-system);
    row.querySelector('.count-qbvar').textContent=qv==null?'-':q(qv-system);
    showToast('Count row saved.');
  };

  window.setStockCountPhysicalZero=async function(itemId){
    const row=document.querySelector('[data-count-item="'+itemId+'"]');
    if(!row)return;
    const input=row.querySelector('.count-physical');
    if(!input||input.disabled)return;
    input.value='0';
    await saveStockCountRow(itemId);
  };

  window.fillStockCountBlanksZero=async function(countId){
    if(!confirm('Mark every remaining blank Physical Qty as 0? Use this only after the location has been physically checked. Blank means NOT COUNTED; 0 means COUNTED and none found.'))return;
    const r=await db.rpc('fill_stock_count_blank_physical_zero',{p_count_id:countId});
    if(r.error)return showToast(r.error.message,'err');
    showToast((r.data||0)+' blank item(s) marked as 0.');
    await openStockCount(countId);
  };

  window.openAddStockCountItem=async function(countId){
    await loadCore();
    openModal('Add Item to Stock Count',`<div class="space-y-4">
      <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Use this when the product is physically found at this location but was not already listed.</b> This includes products where the system quantity is currently 0.</div>
      <div><label class="text-xs font-semibold">Product / SKU</label><div class="relative"><input id="scAddProductSearch" autocomplete="off" oninput="showStockCountAddSuggestions(this,'${countId}')" onfocus="showStockCountAddSuggestions(this,'${countId}')" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Type product code or item name..."><div id="scAddProductSuggestions" class="absolute z-[150] left-0 right-0 top-full mt-1 max-h-80 overflow-y-auto bg-white border rounded-xl shadow-xl"></div></div></div>
      <div class="text-[10px] text-gray-400">After adding it, enter the Physical Qty and save it like the other count rows.</div>
    </div>`);
    setTimeout(()=>document.getElementById('scAddProductSearch')?.focus(),50);
  };

  window.showStockCountAddSuggestions=function(input,countId){
    const box=document.getElementById('scAddProductSuggestions');if(!box)return;
    const rows=stockProductMatches(input?.value||'');
    if(!rows.length){box.innerHTML='<div class="px-4 py-3 text-sm text-gray-400">No matching product</div>';return}
    box.innerHTML=rows.map(p=>`<button type="button" onclick="addStockCountProduct('${countId}','${p.product_id}')" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-0 flex gap-3 items-center"><div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p.image_url?`<img src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'')}</div><div class="text-sm font-semibold truncate">${esc(p.item_name||'')}</div><div class="text-[10px] text-gray-400">${esc(p.brand||'')} · Current total on hand ${q(p.on_hand)}</div></div></button>`).join('');
  };

  window.addStockCountProduct=async function(countId,productId){
    const r=await db.rpc('add_stock_count_item',{p_count_id:countId,p_product_id:productId});
    if(r.error)return showToast(r.error.message,'err');
    showToast('Item added to this Stock Count.');
    await openStockCount(countId);
  };

  window.openStockCount=async function(countId){
    openModal('Stock Count','<div class="py-12 text-center text-sm text-gray-400">Loading stock count...</div>');
    const [c,items]=await Promise.all([
      db.from('stock_counts').select('*,stock_locations(code,name)').eq('id',countId).single(),
      db.from('stock_count_items').select('*,product_catalog(code,item_name,brand,image_url),stock_locations(code,name)').eq('stock_count_id',countId).order('updated_at').limit(2000)
    ]);
    if(c.error||items.error){document.getElementById('modalBody').innerHTML=`<div class="text-red-600">${esc((c.error||items.error).message)}</div>`;return}
    const count=c.data,rows=items.data||[],closed=count.status==='closed';
    const canEditCount=canAdmin()||(isStockController()&&count.status==='draft');
    document.getElementById('modalBody').innerHTML=`<div class="space-y-4">
      <div class="rounded-xl border bg-gray-50 p-4 flex flex-wrap gap-4 justify-between"><div><div class="text-[9px] uppercase font-bold text-gray-400">Period</div><b>${esc(String(count.period_month).slice(0,7))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Location</div><b>${esc(count.stock_locations?.code||'All')}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Status</div><b>${esc(titleCase(count.status))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Items</div><b>${rows.length}</b></div></div>
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
        <div class="text-[10px] text-gray-500"><b>Physical Qty:</b> blank = not counted yet · <b>0</b> = counted and none physically found.</div>
        ${canEditCount&&count.status==='draft'?`<div class="flex flex-wrap gap-2"><button onclick="openAddStockCountItem('${count.id}')" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">+ Add Item</button><button onclick="fillStockCountBlanksZero('${count.id}')" class="px-3 py-2 border border-gray-200 bg-white rounded-xl text-xs font-semibold">Mark Remaining Blanks = 0</button></div>`:''}
      </div>
      <div class="max-h-[58vh] overflow-auto border rounded-xl">
        <div class="divide-y" style="min-width:1166px">
          <div class="sticky top-0 z-10 bg-gray-50 p-2 grid gap-2 text-[9px] uppercase font-bold text-gray-400" style="grid-template-columns:320px 90px 140px 110px 80px 80px 220px 70px">
            <div>Product</div><div>System</div><div>Physical</div><div>QB Qty</div><div>Var</div><div>QB Var</div><div>Note</div><div></div>
          </div>
          ${rows.map(i=>`<div data-count-item="${i.id}" data-system="${n(i.system_qty)}" class="p-2 grid gap-2 items-center text-xs" style="grid-template-columns:320px 90px 140px 110px 80px 80px 220px 70px"><div class="min-w-0 flex items-center gap-2.5"><div class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 border shrink-0">${i.product_catalog?.image_url?`<img src="${esc(i.product_catalog.image_url)}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden')"><div class="hidden w-full h-full items-center justify-center text-[7px] text-gray-400">No Photo</div>`:'<div class="w-full h-full flex items-center justify-center text-[7px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[9px] font-bold text-[#a77d1a] truncate">${esc(i.product_catalog?.code||'')}</div><div class="truncate">${esc(i.product_catalog?.item_name||'')}</div></div></div><b class="text-right pr-2">${q(i.system_qty)}</b><div class="flex items-center gap-1"><input class="count-physical min-w-0 w-full border rounded-lg px-2 py-1.5" type="number" min="0" step="1" value="${i.physical_qty==null?'':n(i.physical_qty)}" ${!canEditCount?'disabled':''}>${canEditCount?`<button type="button" onclick="setStockCountPhysicalZero('${i.id}')" class="shrink-0 w-7 h-7 rounded-lg border bg-gray-50 text-[9px] font-bold" title="Counted: zero physical stock">0</button>`:''}</div><input class="count-qb min-w-0 w-full border rounded-lg px-2 py-1.5" type="number" min="0" step="1" value="${i.qb_qty==null?'':n(i.qb_qty)}" ${!canEditCount?'disabled':''}><b class="count-var text-right pr-2 ${i.physical_qty!=null&&n(i.physical_qty)!==n(i.system_qty)?'text-red-600':''}">${i.physical_qty==null?'-':q(n(i.physical_qty)-n(i.system_qty))}</b><span class="count-qbvar text-right pr-2">${i.qb_qty==null?'-':q(n(i.qb_qty)-n(i.system_qty))}</span><input class="count-note min-w-0 w-full border rounded-lg px-2 py-1.5" value="${esc(i.note||'')}" ${!canEditCount?'disabled':''}><button onclick="saveStockCountRow('${i.id}')" class="px-2 py-1.5 border rounded-lg text-[9px] font-semibold ${!canEditCount?'hidden':''}">Save</button></div>`).join('')}
        </div>
      </div>
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

  function stockReportType(m){
    if(['in','adjustment_in','po_receipt'].includes(m.movement_type))return 'In';
    if(['out','adjustment_out','sale_delivery'].includes(m.movement_type))return 'Out';
    if(m.movement_type==='return')return 'Return';
    if(m.movement_type==='broken')return 'Broken';
    if(m.movement_type==='transfer')return 'Transfer';
    return movementLabel(m.movement_type);
  }
  function stockReportRemark(m){
    const path=m.from_location&&m.to_location?`${m.from_location} → ${m.to_location}`:m.to_location?`To ${m.to_location}`:m.from_location?`From ${m.from_location}`:'';
    return [path,m.note].filter(Boolean).join(' · ');
  }
  window.exportStockReportExcel=async function(){
    ensureReportRange();
    if(typeof ExcelJS==='undefined')return showToast('Excel report library is still loading. Refresh once and try again.','err');
    await loadCore();await loadMovements();
    const rows=reportFilteredMovements().slice().sort((a,b)=>String(a.movement_date).localeCompare(String(b.movement_date))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
    const summary=buildStockPeriodSummary(rows);
    const wb=new ExcelJS.Workbook();
    wb.creator='L’Imperial Stock & Inventory';
    wb.created=new Date();

    const loc=reportLocation();
    const locText=loc?`${stockLocationLabel(loc)}`:'All Locations';
    const periodTitle=`Stock Report from (${longReportDate(inv.reportFrom)}) to (${longReportDate(inv.reportTo)})`;
    const totals={
      in:rows.filter(x=>['in','adjustment_in','po_receipt'].includes(x.movement_type)).reduce((a,x)=>a+n(x.qty),0),
      out:rows.filter(x=>['out','adjustment_out','sale_delivery'].includes(x.movement_type)).reduce((a,x)=>a+n(x.qty),0),
      return:rows.filter(x=>x.movement_type==='return').reduce((a,x)=>a+n(x.qty),0),
      broken:rows.filter(x=>x.movement_type==='broken').reduce((a,x)=>a+n(x.qty),0)
    };

    const ws=wb.addWorksheet('Movement Report',{views:[{state:'frozen',ySplit:4}]});
    ws.mergeCells('A1:H1');
    ws.getCell('A1').value=periodTitle;
    ws.getCell('A1').font={bold:true,size:14,color:{argb:'FF7A5200'}};
    ws.getCell('A1').alignment={horizontal:'center',vertical:'middle'};
    ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};
    ws.getRow(1).height=26;

    ws.getCell('A2').value='From Date';ws.getCell('B2').value=longReportDate(inv.reportFrom);
    ws.getCell('C2').value='To Date';ws.getCell('D2').value=longReportDate(inv.reportTo);
    ws.getCell('E2').value='Location';ws.getCell('F2').value=locText;
    ws.getCell('G2').value='Aging';ws.getCell('H2').value=inv.ageFilter||'All';
    ['A2','C2','E2','G2'].forEach(a=>{ws.getCell(a).font={bold:true,color:{argb:'FF7A5200'}};ws.getCell(a).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}}});

    ws.mergeCells('A3:D3');ws.getCell('A3').value=`SEARCH: ${inv.search||'All'}`;
    ws.mergeCells('E3:H3');ws.getCell('E3').value=`Total: In: ${q(totals.in)}  |  Out: ${q(totals.out)}  |  Return: ${q(totals.return)}  |  Broken: ${q(totals.broken)}`;
    ws.getCell('E3').font={bold:true,color:{argb:'FF9C0006'}};ws.getCell('E3').alignment={horizontal:'right'};

    const movementHeader=['Date','PO/INV','Customer & Vendor','Items Code','Items Name','Unit','Type','Remark'];
    const hr=ws.addRow(movementHeader);
    hr.height=22;
    hr.eachCell(cell=>{cell.font={bold:true,color:{argb:'FF000000'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE2F0D9'}};cell.border={top:{style:'thin',color:{argb:'FF000000'}},left:{style:'thin',color:{argb:'FF000000'}},bottom:{style:'thin',color:{argb:'FF000000'}},right:{style:'thin',color:{argb:'FF000000'}}};cell.alignment={vertical:'middle'};});

    for(const m of rows){
      const row=ws.addRow([dateText(m.movement_date),m.reference_no||'',m.counterparty||'',m.code||'',m.item_name||'',n(m.qty),stockReportType(m),stockReportRemark(m)]);
      row.eachCell(cell=>{cell.border={bottom:{style:'hair',color:{argb:'FFD9D9D9'}}};cell.alignment={vertical:'top',wrapText:true};});
    }
    ws.autoFilter={from:'A4',to:'H4'};
    ws.columns=[{width:16},{width:18},{width:24},{width:24},{width:58},{width:10},{width:12},{width:42}];

    const es=wb.addWorksheet('Ending Balance',{views:[{state:'frozen',ySplit:4}]});
    es.mergeCells('A1:J1');es.getCell('A1').value=`Ending Balance — ${periodTitle}`;
    es.getCell('A1').font={bold:true,size:14,color:{argb:'FF7A5200'}};es.getCell('A1').alignment={horizontal:'center'};es.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};
    es.mergeCells('A2:J2');es.getCell('A2').value=`Location: ${locText} · Aging: ${inv.ageFilter||'All'} · Search: ${inv.search||'All'}`;
    es.getCell('A2').font={italic:true,color:{argb:'FF666666'}};
    es.mergeCells('A3:J3');es.getCell('A3').value='Opening + In + Return − Out − Broken + Transfer In − Transfer Out = Ending Balance';
    es.getCell('A3').font={bold:true,color:{argb:'FF3F6600'}};

    const balanceHeader=['Items Code','Items Name','Brand','Opening Balance','In','Out','Return','Broken','Transfer In','Transfer Out','Ending Balance'];
    const bhr=es.addRow(balanceHeader);
    bhr.eachCell(cell=>{cell.font={bold:true};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE2F0D9'}};cell.border={top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};});
    for(const x of summary){
      const row=es.addRow([x.code,x.item_name,x.brand,n(x.opening),n(x.in),n(x.out),n(x.return),n(x.broken),n(x.transfer_in),n(x.transfer_out),n(x.ending)]);
      for(let col=4;col<=11;col++)row.getCell(col).numFmt='#,##0.00';
      row.eachCell(cell=>{cell.border={bottom:{style:'hair',color:{argb:'FFD9D9D9'}}};cell.alignment={vertical:'top',wrapText:true};});
    }
    es.autoFilter={from:'A4',to:'K4'};
    es.columns=[{width:25},{width:55},{width:20},{width:16},{width:11},{width:11},{width:11},{width:11},{width:14},{width:14},{width:16}];

    const buffer=await wb.xlsx.writeBuffer();
    const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    const period=(inv.reportPeriod||'custom').replaceAll(' ','_');
    a.download=`Stock_Report_${period}_${inv.reportFrom}_to_${inv.reportTo}.xlsx`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    showToast('Stock report exported with Movement Report and Ending Balance sheets.');
  };
  window.exportStockMovementCSV=window.exportStockReportExcel;

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
        return [['tracking','Order Tracking','◎'],['products','Products','◇'],['stock-inventory','Stock & Inventory','▦']];
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