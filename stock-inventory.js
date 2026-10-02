// Stock & Inventory workspace.
// Live ledger in Supabase; compact movement outbox is reserved for Google Sheet mirroring.
(function(){
  const inv={
    tab:'dashboard',
    taxOnly:false,
    search:'',
    locations:[],
    balances:[],
    taxBalances:[],
    taxBalanceMap:new Map(),
    taxLoadedAt:0,
    taxAgingLoading:false,
    taxAgingLoaded:false,
    taxSaleAlerts:[],
    taxSaleAlertsLoadedAt:0,
    taxSaleExpanded:new Set(),
    taxSalePanelCollapsed:true,
    taxCodes:[],
    taxCodesLoadedAt:0,
    taxCodePanelCollapsed:true,
    taxCodeEditor:null,
    declaredSetCatalog:[],
    declaredSetCatalogLoaded:false,
    declaredSetState:null,
    balanceMap:new Map(),
    movementRows:[],
    poRows:[],
    poExpanded:new Set(),
    deliveryRows:[],
    agingRows:[],
    agingMap:new Map(),
    locationCompanies:[],
    locationGroups:[],
    locationMemberships:[],
    companyFilter:'',
    groupFilter:'',
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
  function canView(){
    return typeof window.hasAppPermission==='function'
      ?window.hasAppPermission('inventory.view')
      :['stock_controller','accountant','manager','admin','super_admin'].includes(role());
  }
  function canOperate(){
    return typeof window.hasAppPermission==='function'
      ?window.hasAppPermission('inventory.operate')
      :['stock_controller','admin','super_admin'].includes(role());
  }
  function canAdmin(){
    return typeof window.hasAppPermission==='function'
      ?window.hasAppPermission('inventory.approve')
      :['admin','super_admin'].includes(role());
  }
  function canReconcile(){return typeof window.hasAppPermission==='function'?window.hasAppPermission('inventory.reconcile'):canAdmin()}
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
  function locationCompany(id){return inv.locationCompanies.find(x=>String(x.id)===String(id))||null}
  function locationMembershipSet(groupId){
    return new Set(inv.locationMemberships.filter(x=>String(x.group_id)===String(groupId)).map(x=>String(x.location_id)));
  }
  async function loadLocationMetadata(force=false){
    if(!force&&inv.locationCompanies.length&&inv.locationGroups.length)return;
    const [cr,gr,mr]=await Promise.all([
      db.from('stock_location_companies').select('*').order('sort_order').order('name'),
      db.from('stock_location_groups').select('*').order('sort_order').order('name'),
      db.from('stock_location_group_memberships').select('*')
    ]);
    if(cr.error)throw cr.error;if(gr.error)throw gr.error;if(mr.error)throw mr.error;
    inv.locationCompanies=cr.data||[];
    inv.locationGroups=gr.data||[];
    inv.locationMemberships=mr.data||[];
  }
  function locationOptions(selected='',blankLabel='Select location'){
    return `<option value="">${esc(blankLabel)}</option>${inv.locations.filter(x=>x.active).map(x=>{const c=locationCompany(x.company_id);const label=c?`${c.name} · ${stockLocationLabel(x)}`:stockLocationLabel(x);return `<option value="${x.id}" ${String(selected)===String(x.id)?'selected':''}>${esc(label)}</option>`}).join('')}`;
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
      taxFetchAll('inventory_product_tax_balance','*','product_id').then(data=>({data})),
      taxFetchAll('get_inventory_stock_aging','*','product_id',true).then(data=>({data})),
      loadLocationMetadata(force)
    ]);
    if(locs.error)throw locs.error;if(bals.error)throw bals.error;if(aging.error)throw aging.error;
    inv.locations=locs.data||[];
    inv.balances=(bals.data||[]).sort((a,b)=>String(a.item_name||'').localeCompare(String(b.item_name||'')));
    inv.agingRows=aging.data||[];
    inv.agingMap=new Map(inv.agingRows.map(x=>[x.product_id,x]));
    inv.balanceMap=new Map(inv.balances.map(x=>[x.product_id,x]));
    inv.taxBalances=inv.balances.filter(x=>!!x.tax_item);
    inv.taxBalanceMap=new Map(inv.taxBalances.map(x=>[x.product_id,x]));
    inv.taxLoadedAt=Date.now();
    inv.taxAgingLoaded=true;
    window.inventoryBalanceMap=inv.balanceMap;
  }

  async function fetchTaxBalances(){
    const rows=[];
    for(let from=0;;from+=250){
      const r=await db.from('inventory_product_tax_balance')
        .select('*')
        .eq('tax_item',true)
        .order('product_id')
        .range(from,from+249);
      if(r.error)throw r.error;
      rows.push(...(r.data||[]));
      if((r.data||[]).length<250)return rows;
    }
  }

  async function ensureTaxAgingBackground(){
    if(inv.taxAgingLoaded||inv.taxAgingLoading)return;
    inv.taxAgingLoading=true;
    try{
      const data=await taxFetchAll('get_inventory_stock_aging','*','product_id',true);
      inv.agingRows=data||[];
      inv.agingMap=new Map(inv.agingRows.map(x=>[x.product_id,x]));
      inv.taxAgingLoaded=true;
      if(state.page==='stock-inventory'&&inv.tab==='tax'&&window.renderStockInventoryBody){
        await window.renderStockInventoryBody();
      }
    }catch(err){
      console.warn('Tax Inventory aging background load failed:',err);
    }finally{
      inv.taxAgingLoading=false;
    }
  }

  async function loadTaxCore(force=false){
    if(!canView())throw new Error('Inventory access required.');
    const now=Date.now();
    if(!force&&inv.taxLoadedAt&&now-inv.taxLoadedAt<60000&&inv.locations.length)return;

    const locPromise=inv.locations.length
      ?Promise.resolve({data:inv.locations,error:null})
      :db.from('stock_locations').select('*').order('sort_order').order('code');
    const [locs,taxRows]=await Promise.all([locPromise,fetchTaxBalances(),loadLocationMetadata(force)]);
    if(locs.error)throw locs.error;

    inv.locations=locs.data||[];
    inv.taxBalances=(taxRows||[]).sort((a,b)=>String(a.item_name||'').localeCompare(String(b.item_name||'')));
    inv.taxBalanceMap=new Map(inv.taxBalances.map(x=>[x.product_id,x]));
    for(const [id,row] of inv.taxBalanceMap)inv.balanceMap.set(id,row);
    inv.taxLoadedAt=now;
    window.inventoryBalanceMap=inv.balanceMap;

    setTimeout(()=>ensureTaxAgingBackground(),0);
  }


  async function loadTaxDeclaredCodes(force=false){
    if(!canView())throw new Error('Inventory access required.');
    const now=Date.now();
    if(!force&&inv.taxCodesLoadedAt&&now-inv.taxCodesLoadedAt<30000)return inv.taxCodes;
    const r=await db.rpc('get_tax_declared_codes',{p_include_inactive:role()==='super_admin'});
    if(r.error)throw r.error;
    inv.taxCodes=Array.isArray(r.data)?r.data:[];
    inv.taxCodesLoadedAt=now;
    return inv.taxCodes;
  }

  async function loadTaxSaleAlerts(force=false){
    if(role()!=='super_admin'){
      inv.taxSaleAlerts=[];
      inv.taxSaleAlertsLoadedAt=Date.now();
      return inv.taxSaleAlerts;
    }
    const now=Date.now();
    if(!force&&inv.taxSaleAlertsLoadedAt&&now-inv.taxSaleAlertsLoadedAt<30000)return inv.taxSaleAlerts;
    const r=await db.rpc('get_tax_sale_alerts',{p_status:'open'});
    if(r.error)throw r.error;
    inv.taxSaleAlerts=Array.isArray(r.data)?r.data:[];
    inv.taxSaleAlertsLoadedAt=now;
    return inv.taxSaleAlerts;
  }


  window.toggleTaxCodePanel=function(){
    inv.taxCodePanelCollapsed=!inv.taxCodePanelCollapsed;
    renderStockInventoryBody();
  };

  function taxDeclaredCodesHtml(){
    if(inv.tab!=='tax')return '';
    const search=String(inv.search||'').trim().toLowerCase();
    const rows=(inv.taxCodes||[]).filter(function(x){
      if(!search)return true;
      const parts=[x.code,x.name,x.tax_note,x.tax_pricing_note];
      (x.components||[]).forEach(function(p){parts.push(p.code,p.item_name,p.brand,p.class)});
      return parts.filter(Boolean).join(' ').toLowerCase().includes(search);
    });
    let html='<div class="mb-4 rounded-2xl border border-amber-200 bg-amber-50/20 overflow-hidden">';
    html+='<div class="px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3'+(inv.taxCodePanelCollapsed?'':' border-b border-amber-100')+'">';
    html+='<button type="button" onclick="toggleTaxCodePanel()" class="flex-1 text-left flex items-start gap-3"><span class="mt-0.5 text-amber-700">'+(inv.taxCodePanelCollapsed?'▸':'▾')+'</span><span><span class="font-bold text-sm text-amber-900">Tax Codes / Sets</span><span class="block text-[10px] text-amber-800 mt-1">Tax-only Codes are declarations, not physical stock items. Their Qty is calculated from the component Codes and Required Qty underneath.</span></span></button>';
    html+='<div class="flex items-center gap-2"><span class="px-2.5 py-1.5 rounded-lg border border-amber-200 bg-white text-[10px] font-bold text-amber-800">'+(inv.taxCodes||[]).filter(function(x){return x.active!==false}).length+' active</span>';
    if(canAdmin())html+='<button onclick="exportTaxCodesExcel()" class="px-3 py-2 rounded-xl border bg-white text-xs font-semibold">Export Sets</button>';
    if(role()==='super_admin')html+='<button onclick="openTaxCodeEditor()" class="px-3 py-2 rounded-xl bg-[#211d18] text-white text-xs font-semibold">+ Create Tax Code / Set</button>';
    html+='</div></div>';
    if(!inv.taxCodePanelCollapsed){
      html+='<div class="p-3">';
      if(!rows.length)html+='<div class="py-8 text-center text-sm text-gray-400">No Tax Codes / Sets yet. Create one and add physical product Codes with their Required Qty.</div>';
      else{
        html+='<div class="grid xl:grid-cols-2 gap-3">';
        rows.forEach(function(x){
          const comps=Array.isArray(x.components)?x.components:[];
          html+='<div class="rounded-2xl border bg-white p-4'+(x.active===false?' opacity-60':'')+'">';
          html+='<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"><div class="min-w-0">';
          html+='<div class="flex flex-wrap items-center gap-2"><span class="text-[10px] font-black text-[#a77d1a]">'+esc(x.code||'')+'</span><span class="px-2 py-0.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[8px] font-bold">TAX-ONLY CODE</span>'+(x.active===false?'<span class="px-2 py-0.5 rounded-lg border text-[8px] font-bold text-gray-500">INACTIVE</span>':'')+'</div>';
          html+='<div class="font-bold text-base mt-1">'+esc(x.name||'Tax Set')+'</div><div class="text-[10px] text-gray-400 mt-1">'+comps.length+' component'+(comps.length===1?'':'s')+' · no separate physical stock</div></div>';
          html+='<div class="grid grid-cols-2 gap-2"><div class="rounded-xl border bg-gray-50 px-3 py-2 text-center"><div class="text-[8px] uppercase font-bold text-gray-400">Sets On Hand</div><div class="text-lg font-black">'+q(x.on_hand_sets)+'</div></div><div class="rounded-xl border bg-green-50 px-3 py-2 text-center"><div class="text-[8px] uppercase font-bold text-green-700">Available Qty</div><div class="text-lg font-black text-green-700">'+q(x.available_sets)+'</div></div></div></div>';
          if(role()==='super_admin')html+='<div class="mt-3 flex flex-wrap gap-2 text-[10px]"><span class="px-2 py-1 rounded-lg border bg-amber-50"><b>Tax Cost:</b> '+(x.tax_cost==null?'—':money(n(x.tax_cost),x.tax_currency||'USD'))+'</span><span class="px-2 py-1 rounded-lg border bg-amber-50"><b>Tax Sale:</b> '+(x.tax_sale_price==null?'—':money(n(x.tax_sale_price),x.tax_currency||'USD'))+'</span></div>';
          html+='<div class="mt-3 grid sm:grid-cols-2 gap-2">';
          comps.slice(0,8).forEach(function(p){
            html+='<div class="flex items-center gap-2 rounded-xl border bg-gray-50 p-2 min-w-0">'
              +'<div class="w-10 h-10 rounded-lg overflow-hidden border bg-white shrink-0">'+(p.image_url?'<img loading="lazy" decoding="async" src="'+esc(p.image_url)+'" class="w-full h-full object-cover" alt="">':'<div class="w-full h-full flex items-center justify-center text-[7px] text-gray-400">No Photo</div>')+'</div>'
              +'<div class="min-w-0 flex-1"><div class="text-[9px] font-bold text-[#a77d1a] truncate">'+esc(p.code||'')+'</div><div class="text-[10px] font-semibold truncate">'+esc(p.item_name||'')+'</div><div class="text-[9px] text-gray-400">Required × '+q(p.required_qty)+' · Available '+q(p.available)+'</div></div>'
              +'</div>';
          });
          if(comps.length>8)html+='<div class="text-[9px] text-gray-400 flex items-center">+'+(comps.length-8)+' more components</div>';
          html+='</div>';
          if(x.tax_note)html+='<div class="mt-2 text-[10px] text-gray-500">'+esc(x.tax_note)+'</div>';
          if(canAdmin())html+='<div class="mt-3 flex justify-end gap-2 flex-wrap"><button onclick="exportTaxCodesExcel(\''+x.id+'\')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Export</button>'+(role()==='super_admin'?'<button onclick="openTaxCodeEditor(\''+x.id+'\')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Edit</button><button onclick="setTaxCodeActive(\''+x.id+'\','+(x.active===false?'true':'false')+')" class="px-3 py-2 border '+(x.active===false?'border-green-200 text-green-700':'border-red-200 text-red-600')+' rounded-lg text-[10px] font-semibold">'+(x.active===false?'Reactivate':'Deactivate')+'</button>':'')+'</div>';
          html+='</div>';
        });
        html+='</div>';
      }
      html+='</div>';
    }
    html+='</div>';
    return html;
  }

  function renderTaxCodeEditor(){
    const e=inv.taxCodeEditor,body=document.getElementById('modalBody');
    if(!e||!body)return;
    let html='<div class="space-y-4"><div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-900"><b>Tax-only Code:</b> this does not create a physical product or Stock IN / OUT. Available Qty is calculated from the products below.</div>';
    html+='<div class="grid md:grid-cols-2 gap-3">';
    html+='<div><label class="text-xs font-semibold">Tax Code *</label><input value="'+esc(e.code||'')+'" oninput="taxCodeEditorField(\'code\',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="TAX-VENUS-01"></div>';
    html+='<div><label class="text-xs font-semibold">Tax Name *</label><input value="'+esc(e.name||'')+'" oninput="taxCodeEditorField(\'name\',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Venus Mirror Set"></div>';
    html+='<div><label class="text-xs font-semibold">Tax Cost</label><input type="number" min="0" step="0.01" value="'+esc(e.tax_cost??'')+'" oninput="taxCodeEditorField(\'tax_cost\',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>';
    html+='<div><label class="text-xs font-semibold">Tax Sale Price</label><input type="number" min="0" step="0.01" value="'+esc(e.tax_sale_price??'')+'" oninput="taxCodeEditorField(\'tax_sale_price\',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>';
    html+='<div><label class="text-xs font-semibold">Tax Currency</label><select onchange="taxCodeEditorField(\'tax_currency\',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option '+(e.tax_currency==='USD'?'selected':'')+'>USD</option><option '+(e.tax_currency==='EUR'?'selected':'')+'>EUR</option><option '+(e.tax_currency==='CNY'?'selected':'')+'>CNY</option><option '+(e.tax_currency==='GBP'?'selected':'')+'>GBP</option></select></div>';
    html+='<div><label class="text-xs font-semibold">Tax Pricing Note</label><input value="'+esc(e.tax_pricing_note||'')+'" oninput="taxCodeEditorField(\'tax_pricing_note\',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div></div>';
    html+='<div><label class="text-xs font-semibold">Tax Note</label><textarea oninput="taxCodeEditorField(\'tax_note\',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 min-h-[70px]">'+esc(e.tax_note||'')+'</textarea></div>';
    html+='<div class="rounded-2xl border p-4"><div class="font-bold text-sm">Add Product Code + Required Qty</div><div class="grid lg:grid-cols-[1fr_110px_1fr_120px] gap-2 mt-3"><input id="taxCodeProductInput" list="taxCodeProductList" class="border rounded-xl px-3 py-2 text-xs" placeholder="Search Code or product"><datalist id="taxCodeProductList">'+productOptions()+'</datalist><input id="taxCodeRequiredQty" type="number" min="0.0001" step="0.01" value="1" class="border rounded-xl px-3 py-2 text-xs"><input id="taxCodeComponentNote" class="border rounded-xl px-3 py-2 text-xs" placeholder="Optional note"><button onclick="addTaxCodeEditorComponent()" class="px-3 py-2 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Add</button></div></div>';
    html+='<div class="rounded-2xl border overflow-hidden"><div class="px-4 py-3 bg-gray-50 border-b"><b class="text-sm">Components</b><div class="text-[10px] text-gray-400">One Tax Code can contain one or many physical products.</div></div><div class="divide-y">';
    if(!e.components.length)html+='<div class="p-8 text-center text-sm text-gray-400">Add at least one product Code and Required Qty.</div>';
    e.components.forEach(function(p,i){
      html+='<div class="p-4 grid lg:grid-cols-[58px_1.25fr_120px_1fr_90px] gap-3 items-center">'        +'<div class="w-14 h-14 rounded-xl overflow-hidden border bg-gray-50">'+(p.image_url?'<img loading="lazy" decoding="async" src="'+esc(p.image_url)+'" class="w-full h-full object-cover" alt="">':'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>')+'</div>'        +'<div><div class="text-[10px] font-bold text-[#a77d1a]">'+esc(p.code||'')+'</div><div class="font-semibold text-sm">'+esc(p.item_name||'')+'</div><div class="text-[9px] text-gray-400">On hand '+q(p.on_hand)+' · Available '+q(p.available)+'</div></div>'        +'<input type="number" min="0.0001" step="0.01" value="'+esc(p.required_qty)+'" oninput="taxCodeEditorComponentField('+i+',\'required_qty\',this.value)" class="border rounded-lg px-2 py-1.5 text-xs">'        +'<input value="'+esc(p.note||'')+'" oninput="taxCodeEditorComponentField('+i+',\'note\',this.value)" class="border rounded-lg px-2 py-1.5 text-xs" placeholder="Note">'        +'<button onclick="removeTaxCodeEditorComponent('+i+')" class="px-2.5 py-2 border border-red-200 text-red-600 rounded-lg text-[10px] font-semibold">Remove</button></div>';
    });
    html+='</div></div><div class="flex justify-end gap-2"><button onclick="closeModal()" class="px-4 py-2.5 border rounded-xl text-xs font-semibold">Cancel</button><button onclick="saveTaxCodeEditor()" class="px-5 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Save Tax Code / Set</button></div></div>';
    body.innerHTML=html;
  }

  window.taxCodeEditorField=function(field,value){if(inv.taxCodeEditor)inv.taxCodeEditor[field]=value};
  window.taxCodeEditorComponentField=function(i,field,value){if(inv.taxCodeEditor&&inv.taxCodeEditor.components[i])inv.taxCodeEditor.components[i][field]=value};

  window.openTaxCodeEditor=async function(id){
    if(role()!=='super_admin')return showToast('Super Admin only.','err');
    try{
      await Promise.all([loadTaxDeclaredCodes(true),loadCore()]);
      const row=id?(inv.taxCodes||[]).find(function(x){return String(x.id)===String(id)}):null;
      inv.taxCodeEditor={id:row?.id||null,code:row?.code||'',name:row?.name||'',tax_cost:row?.tax_cost??'',tax_sale_price:row?.tax_sale_price??'',tax_currency:row?.tax_currency||'USD',tax_note:row?.tax_note||'',tax_pricing_note:row?.tax_pricing_note||'',components:(row?.components||[]).map(function(p){return Object.assign({},p,{note:p.note||''})})};
      openModal(row?'Edit Tax Code / Set':'Create Tax Code / Set','');
      renderTaxCodeEditor();
    }catch(err){showToast(err.message||'Could not open Tax Code editor.','err')}
  };

  window.addTaxCodeEditorComponent=function(){
    const e=inv.taxCodeEditor;if(!e)return;
    const p=findProduct(document.getElementById('taxCodeProductInput')?.value||'');
    const qty=n(document.getElementById('taxCodeRequiredQty')?.value);
    const note=document.getElementById('taxCodeComponentNote')?.value.trim()||'';
    if(!p)return showToast('Choose a valid product Code.','err');
    if(qty<=0)return showToast('Required Qty must be greater than 0.','err');
    if(e.components.some(function(x){return String(x.product_id)===String(p.product_id)}))return showToast('This product is already added.','err');
    e.components.push({product_id:p.product_id,code:p.code,item_name:p.item_name,brand:p.brand,class:p.class,image_url:p.image_url||'',on_hand:p.on_hand,available:p.available,required_qty:qty,note:note});
    renderTaxCodeEditor();
  };
  window.removeTaxCodeEditorComponent=function(i){if(inv.taxCodeEditor){inv.taxCodeEditor.components.splice(i,1);renderTaxCodeEditor()}};

  window.saveTaxCodeEditor=async function(){
    const e=inv.taxCodeEditor;if(!e||role()!=='super_admin')return;
    const code=String(e.code||'').trim(),name=String(e.name||'').trim();
    if(!code||!name)return showToast('Tax Code and Tax Name are required.','err');
    if(!e.components.length)return showToast('Add at least one physical product component.','err');
    const components=e.components.map(function(p){return {product_id:p.product_id,required_qty:Number(p.required_qty),note:String(p.note||'').trim()||null}});
    if(components.some(function(p){return !Number.isFinite(p.required_qty)||p.required_qty<=0}))return showToast('Every Required Qty must be greater than 0.','err');
    const numOrNull=function(v){return String(v??'').trim()===''?null:Number(v)};
    const r=await db.rpc('save_tax_declared_code',{p_id:e.id||null,p_code:code,p_name:name,p_tax_cost:numOrNull(e.tax_cost),p_tax_sale_price:numOrNull(e.tax_sale_price),p_tax_currency:e.tax_currency||'USD',p_tax_note:String(e.tax_note||'').trim()||null,p_tax_pricing_note:String(e.tax_pricing_note||'').trim()||null,p_components:components});
    if(r.error)return showToast(r.error.message,'err');
    inv.taxCodeEditor=null;closeModal();inv.taxCodesLoadedAt=0;await loadTaxDeclaredCodes(true);await renderStockInventoryBody();
    showToast('Tax Code / Set saved. Physical stock was not changed.');
  };

  window.setTaxCodeActive=async function(id,active){
    if(role()!=='super_admin')return;
    const row=(inv.taxCodes||[]).find(function(x){return String(x.id)===String(id)});if(!row)return;
    if(!confirm((active?'Reactivate ':'Deactivate ')+(row.code||'this Tax Code')+'?\n\nPhysical inventory will not change.'))return;
    const r=await db.rpc('set_tax_declared_code_active',{p_id:id,p_active:!!active});
    if(r.error)return showToast(r.error.message,'err');
    inv.taxCodesLoadedAt=0;await loadTaxDeclaredCodes(true);await renderStockInventoryBody();
  };


  function safeTaxExportName(v){
    return String(v||'Tax').trim().replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,'_').slice(0,80)||'Tax';
  }

  function styleTaxExportSheet(ws,headerRow){
    headerRow=headerRow||1;
    const row=ws.getRow(headerRow);
    row.font={bold:true};
    row.alignment={vertical:'middle'};
    row.height=22;
    ws.views=[{state:'frozen',ySplit:headerRow}];
    if(ws.columnCount)ws.autoFilter={from:{row:headerRow,column:1},to:{row:headerRow,column:ws.columnCount}};
    ws.columns.forEach(function(col){
      let max=String(col.header||'').length;
      col.eachCell({includeEmpty:true},function(cell){
        const v=cell.value&&typeof cell.value==='object'&&cell.value.text?cell.value.text:cell.value;
        max=Math.max(max,String(v==null?'':v).length);
      });
      col.width=Math.min(Math.max(max+2,11),42);
    });
  }

  async function downloadTaxWorkbook(wb,filename){
    const buffer=await wb.xlsx.writeBuffer();
    const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href)},1500);
  }

  window.exportTaxProductsExcel=async function(productId){
    productId=productId||null;
    if(!canAdmin())return showToast('Admin access required to export Tax Inventory.','err');
    if(typeof ExcelJS==='undefined')return showToast('Excel export library is still loading. Refresh once and try again.','err');
    try{
      await Promise.all([
        loadTaxCore(true),
        typeof window.loadTaxProducts==='function'?window.loadTaxProducts():Promise.resolve([])
      ]);
      let rows=(inv.taxBalances||[]).filter(function(p){return !productId||String(p.product_id)===String(productId)});
      if(!rows.length)return showToast('No Tax Items available to export.','err');

      const wb=new ExcelJS.Workbook();
      wb.creator="L'Imperial Tax Inventory";
      wb.created=new Date();
      const ws=wb.addWorksheet(productId?'Tax Product':'Tax Products');
      const includePricing=role()==='super_admin';
      const headers=['Code','Item Name','Brand','Category','On Hand','Reserved','Available','On Order','Incoming','Arrived Pending','Tax Group / Set'];
      if(includePricing)headers.push('Tax Cost','Tax Sale Price','Tax Currency','Tax Pricing Note');
      headers.push('Tax Note','Image');
      ws.addRow(headers);

      rows.sort(function(a,b){return String(a.code||'').localeCompare(String(b.code||''))}).forEach(function(p){
        const tp=typeof window.taxProduct==='function'?window.taxProduct(p):p;
        const vals=[p.code||'',p.item_name||'',p.brand||'',p.class||'',n(p.on_hand),n(p.reserved),n(p.available),n(p.on_order),n(p.incoming),n(p.arrived_pending_receive),tp.tax_group_or_set||''];
        if(includePricing)vals.push(tp.tax_cost==null?'':tp.tax_cost,tp.tax_sale_price==null?'':tp.tax_sale_price,tp.tax_currency||'USD',tp.tax_pricing_note||'');
        vals.push(tp.tax_note||'',p.image_url?'Open Photo':'');
        const row=ws.addRow(vals);
        if(p.image_url){
          const cell=row.getCell(headers.length);
          cell.value={text:'Open Photo',hyperlink:p.image_url};
          cell.font={underline:true};
        }
      });

      styleTaxExportSheet(ws,1);
      const filename=productId?'Tax_Product_'+safeTaxExportName(rows[0]&&rows[0].code)+'.xlsx':'Tax_Products_'+new Date().toISOString().slice(0,10)+'.xlsx';
      await downloadTaxWorkbook(wb,filename);
      showToast((productId?'Tax Product':'Tax Items')+' exported to Excel.');
    }catch(err){showToast(err.message||'Could not export Tax Items.','err')}
  };

  window.exportTaxCodesExcel=async function(taxCodeId){
    taxCodeId=taxCodeId||null;
    if(!canAdmin())return showToast('Admin access required to export Tax Codes / Sets.','err');
    if(typeof ExcelJS==='undefined')return showToast('Excel export library is still loading. Refresh once and try again.','err');
    try{
      await loadTaxDeclaredCodes(true);
      const sets=(inv.taxCodes||[]).filter(function(x){return !taxCodeId||String(x.id)===String(taxCodeId)});
      if(!sets.length)return showToast('No Tax Codes / Sets available to export.','err');

      const wb=new ExcelJS.Workbook();
      wb.creator="L'Imperial Tax Inventory";
      wb.created=new Date();
      const includePricing=role()==='super_admin';

      const sws=wb.addWorksheet('Tax Sets');
      const setHeaders=['Tax Code','Tax Name','Active','Sets On Hand','Available Sets','Component Count'];
      if(includePricing)setHeaders.push('Tax Cost','Tax Sale Price','Currency','Tax Pricing Note');
      setHeaders.push('Tax Note');
      sws.addRow(setHeaders);
      sets.forEach(function(x){
        const comps=Array.isArray(x.components)?x.components:[];
        const vals=[x.code||'',x.name||'',x.active===false?'No':'Yes',n(x.on_hand_sets),n(x.available_sets),comps.length];
        if(includePricing)vals.push(x.tax_cost==null?'':x.tax_cost,x.tax_sale_price==null?'':x.tax_sale_price,x.tax_currency||'USD',x.tax_pricing_note||'');
        vals.push(x.tax_note||'');
        sws.addRow(vals);
      });
      styleTaxExportSheet(sws,1);

      const cws=wb.addWorksheet('Components');
      const compHeaders=['Tax Code','Tax Name','Component Code','Component Name','Brand','Category','Required Qty','On Hand','Reserved','Available','Incoming','Note','Image'];
      cws.addRow(compHeaders);
      sets.forEach(function(x){
        (x.components||[]).forEach(function(p){
          const row=cws.addRow([x.code||'',x.name||'',p.code||'',p.item_name||'',p.brand||'',p.class||'',n(p.required_qty),n(p.on_hand),n(p.reserved),n(p.available),n(p.incoming),p.note||'',p.image_url?'Open Photo':'']);
          if(p.image_url){
            const cell=row.getCell(compHeaders.length);
            cell.value={text:'Open Photo',hyperlink:p.image_url};
            cell.font={underline:true};
          }
        });
      });
      styleTaxExportSheet(cws,1);

      const filename=taxCodeId?'Tax_Set_'+safeTaxExportName((sets[0]&&sets[0].code)||(sets[0]&&sets[0].name))+'.xlsx':'Tax_Sets_'+new Date().toISOString().slice(0,10)+'.xlsx';
      await downloadTaxWorkbook(wb,filename);
      showToast((taxCodeId?'Tax Set':'Tax Codes / Sets')+' exported to Excel.');
    }catch(err){showToast(err.message||'Could not export Tax Codes / Sets.','err')}
  };

  window.acknowledgeTaxSaleAlert=async function(id){
    if(role()!=='super_admin')return showToast('Super Admin only.','err');
    const a=(inv.taxSaleAlerts||[]).find(x=>String(x.id)===String(id));
    const label=[a?.invoice_no||a?.order_no,a?.code,a?.item_name].filter(Boolean).join(' · ');
    const ok=confirm(
      'Acknowledge this Tax sale alert'+(label?' — '+label:'')+'?\n\n'+
      'This only marks the alert as reviewed and removes it from the open alert list.\n'+
      'It does NOT change stock, Tax Inventory quantity, the Sales Order / invoice, or the sale record.'
    );
    if(!ok)return;
    const r=await db.rpc('acknowledge_tax_sale_alert',{p_alert_id:id});
    if(r.error)return showToast(r.error.message,'err');
    if(r.data!==true)return showToast('This Tax sale alert was already acknowledged or is no longer open.');
    inv.taxSaleExpanded.delete(String(id));
    inv.taxSaleAlertsLoadedAt=0;
    await loadTaxSaleAlerts(true);
    await renderStockInventoryBody();
    if(typeof window.refreshAppNotifications==='function')window.refreshAppNotifications();
    showToast('Tax sale alert acknowledged. No stock or sales data was changed.');
  };

  function taxSaleStatusBadge(a){
    if(a.alert_type!=='declared_set')return '<span class="inline-flex px-2 py-1 rounded-lg border bg-red-50 text-red-700 text-[9px] font-bold">DIRECT TAX ITEM</span>';
    const status=String(a.set_status||'partial').toLowerCase();
    const cls=status==='multiple'?'bg-purple-50 text-purple-700 border-purple-200':status==='complete'?'bg-green-50 text-green-700 border-green-200':'bg-amber-50 text-amber-700 border-amber-200';
    const label=status==='multiple'?'MULTIPLE SETS':status==='complete'?'COMPLETE SET':'PARTIAL SET';
    return '<span class="inline-flex px-2 py-1 rounded-lg border '+cls+' text-[9px] font-bold">'+label+'</span>';
  }

  function taxSaleComponentsHtml(a){
    if(a.alert_type!=='declared_set')return '';
    const rows=Array.isArray(a.components)?a.components:[];
    if(!rows.length)return '';
    return '<div class="mt-2 flex flex-wrap gap-1">'+rows.map(c=>{
      const sold=n(c.sold_qty),req=n(c.required_qty),met=sold>=req;
      return '<span class="inline-flex px-2 py-1 rounded-lg border text-[9px] '+(met?'bg-green-50 border-green-200 text-green-700':'bg-amber-50 border-amber-200 text-amber-700')+'"><b>'+esc(c.code||'')+'</b>&nbsp;'+q(sold)+' / '+q(req)+'</span>';
    }).join('')+'</div>';
  }

  window.toggleTaxSaleAlertPanel=function(){
    inv.taxSalePanelCollapsed=!inv.taxSalePanelCollapsed;
    renderStockInventoryBody();
  };

  window.toggleTaxSaleAlertDetails=function(id){
    const key=String(id);
    if(inv.taxSaleExpanded.has(key))inv.taxSaleExpanded.delete(key);
    else inv.taxSaleExpanded.add(key);
    renderStockInventoryBody();
  };

  function taxAlertMoney(v,currency='USD'){
    if(v==null||v==='')return '—';
    const x=Number(v);
    if(!Number.isFinite(x))return esc(String(v));
    const cur=String(currency||'USD').toUpperCase();
    try{return new Intl.NumberFormat(undefined,{style:'currency',currency:cur,maximumFractionDigits:2}).format(x)}
    catch(_){return cur+' '+x.toLocaleString(undefined,{maximumFractionDigits:2})}
  }

  function taxAlertLocationsHtml(a){
    const rows=Array.isArray(a.locations)?a.locations:[];
    if(!rows.length)return '<div class="text-[10px] text-gray-400">No location breakdown recorded.</div>';
    return '<div class="flex flex-wrap gap-1.5">'+rows.map(l=>{
      const name=l.location_code||l.code||l.location_name||l.name||'Location';
      const qty=l.on_hand??l.qty??l.quantity??l.balance??'—';
      return '<span class="inline-flex px-2 py-1 rounded-lg border bg-white text-[9px]"><b>'+esc(name)+'</b>&nbsp;'+esc(qty)+'</span>';
    }).join('')+'</div>';
  }

  function taxSaleAlertDetailsHtml(a){
    const isSet=a.alert_type==='declared_set';
    const components=Array.isArray(a.components)?a.components:[];
    return `<div class="px-4 pb-4 bg-white/80">
      <div class="ml-0 lg:ml-[84px] rounded-xl border border-red-100 bg-[#fffdfc] p-4 grid xl:grid-cols-[1.2fr_1fr_1fr] gap-4">
        <div>
          <div class="text-[9px] uppercase font-bold text-gray-400">Product / Tax Details</div>
          <div class="mt-2 flex gap-3">
            <div class="w-20 h-20 rounded-xl overflow-hidden border bg-white shrink-0">${a.image_url?`<img loading="lazy" decoding="async" src="${esc(a.image_url)}" class="w-full h-full object-cover" alt="">`:'<div class="w-full h-full flex items-center justify-center text-[9px] text-gray-400">No Photo</div>'}</div>
            <div class="min-w-0">
              <div class="text-[10px] font-bold text-[#a77d1a]">Code: ${esc(a.code||'—')}</div>
              <div class="font-semibold text-sm mt-1">${esc(a.item_name||'Tax Item')}</div>
              <div class="text-[10px] text-gray-500 mt-1">${[a.brand,a.product_class].filter(Boolean).map(esc).join(' · ')||'Brand / category not recorded'}</div>
              <div class="text-[10px] text-gray-500 mt-1">Tax Group / Set: <b>${esc(a.tax_group_or_set||'—')}</b></div>
            </div>
          </div>
          ${a.tax_note?`<div class="mt-3 rounded-lg border bg-white p-2 text-[10px]"><b>Tax Note:</b> ${esc(a.tax_note)}</div>`:''}
        </div>

        <div>
          <div class="text-[9px] uppercase font-bold text-gray-400">Sale Details</div>
          <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
            <div><span class="text-gray-400">Document</span><div class="font-semibold">${esc(a.invoice_no||a.order_no||'Sales Order')}</div></div>
            <div><span class="text-gray-400">Order Date</span><div class="font-semibold">${esc(dateText(a.order_date))}</div></div>
            <div><span class="text-gray-400">Customer</span><div class="font-semibold">${esc(a.customer_name||'Customer')}</div></div>
            <div><span class="text-gray-400">Sales Rep</span><div class="font-semibold">${esc(a.sales_rep_name||'Not recorded')}</div></div>
            <div><span class="text-gray-400">Sold Qty</span><div class="font-semibold text-red-600">${q(a.qty)}</div></div>
            <div><span class="text-gray-400">Recorded</span><div class="font-semibold">${a.sold_at?esc(new Date(a.sold_at).toLocaleString()):'—'}</div></div>
            <div><span class="text-gray-400">On Hand</span><div class="font-semibold">${q(a.on_hand)}</div></div>
            <div><span class="text-gray-400">Available</span><div class="font-semibold">${q(a.available)}</div></div>
          </div>
          <div class="mt-3"><div class="text-[9px] uppercase font-bold text-gray-400 mb-1.5">Stock Locations</div>${taxAlertLocationsHtml(a)}</div>
        </div>

        <div>
          <div class="text-[9px] uppercase font-bold text-gray-400">Tax Pricing & Set Review</div>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <div class="rounded-lg border bg-white p-2"><div class="text-[9px] text-gray-400">Tax Cost</div><div class="text-xs font-bold">${taxAlertMoney(a.tax_cost,a.tax_currency)}</div></div>
            <div class="rounded-lg border bg-white p-2"><div class="text-[9px] text-gray-400">Tax Sale Price</div><div class="text-xs font-bold text-amber-800">${taxAlertMoney(a.tax_sale_price,a.tax_currency)}</div></div>
            <div class="rounded-lg border bg-white p-2"><div class="text-[9px] text-gray-400">Normal Sale Price</div><div class="text-xs font-bold">${taxAlertMoney(a.normal_sales_price,a.normal_currency)}</div></div>
            <div class="rounded-lg border bg-white p-2"><div class="text-[9px] text-gray-400">${isSet?'Complete Sets':'Alert Type'}</div><div class="text-xs font-bold">${isSet?q(a.complete_sets):'Direct Tax Item'}</div></div>
          </div>
          ${a.tax_pricing_note?`<div class="mt-2 rounded-lg border bg-white p-2 text-[10px]"><b>Pricing Note:</b> ${esc(a.tax_pricing_note)}</div>`:''}
          ${isSet&&components.length?`<div class="mt-3"><div class="text-[9px] uppercase font-bold text-gray-400 mb-1.5">Declared Set Components</div><div class="space-y-1">${components.map(c=>`<div class="flex justify-between gap-3 rounded-lg border bg-white px-2 py-1.5 text-[10px]"><div><b>${esc(c.code||'')}</b> ${esc(c.item_name||'')}</div><div>Sold ${q(c.sold_qty)} / Required ${q(c.required_qty)}</div></div>`).join('')}</div></div>`:''}
        </div>
      </div>
    </div>`;
  }

  function taxSaleAlertsHtml(){
    if(role()!=='super_admin')return '';
    const rows=inv.taxSaleAlerts||[];
    if(!rows.length){
      return '<div class="mb-4 rounded-2xl border border-green-100 bg-green-50/30 p-4"><div class="font-bold text-sm text-green-800">Tax Sales Alerts</div><div class="text-xs text-green-700 mt-1">No unreviewed Tax Item or Declared Set sales.</div></div>';
    }
    return `<div class="mb-4 rounded-2xl border border-red-200 bg-red-50/30 overflow-hidden">
      <div class="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${inv.taxSalePanelCollapsed?'':'border-b border-red-100'}">
        <button type="button" onclick="toggleTaxSaleAlertPanel()" class="flex-1 text-left flex items-start gap-3 group">
          <span class="mt-0.5 text-red-500 text-sm">${inv.taxSalePanelCollapsed?'▸':'▾'}</span>
          <span><span class="font-bold text-sm text-red-800">Tax Sale · Action Required</span><span class="block text-[10px] text-red-600 mt-1">Direct Tax Items and Declared Sets are monitored here. ${inv.taxSalePanelCollapsed?'Click to show alerts.':'Click an alert to review details.'} These alerts never deduct stock; approved delivery / stock tasks remain the only posting path.</span></span>
        </button>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[9px] text-red-600 font-semibold">${inv.taxSalePanelCollapsed?'Show alerts':'Collapse'}</span>
          <span class="inline-flex min-w-[28px] h-7 px-2 rounded-full bg-red-600 text-white text-xs font-bold items-center justify-center">${rows.length}</span>
        </div>
      </div>
      ${inv.taxSalePanelCollapsed?'':`<div class="divide-y divide-red-100">
        ${rows.slice(0,12).map(a=>{
          const expanded=inv.taxSaleExpanded.has(String(a.id));
          return `<div class="bg-white/80">
            <div onclick="toggleTaxSaleAlertDetails('${a.id}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleTaxSaleAlertDetails('${a.id}')}" class="p-4 grid lg:grid-cols-[68px_1.45fr_1.2fr_110px_140px] gap-3 items-center cursor-pointer hover:bg-red-50/30 transition-colors">
              <div class="w-14 h-14 rounded-xl overflow-hidden border bg-white shrink-0">${a.image_url?`<img loading="lazy" decoding="async" src="${esc(a.image_url)}" class="w-full h-full object-cover" alt="">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
              <div class="min-w-0">
                <div class="flex flex-wrap gap-2 items-center"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(a.code||'')}${taxBadge({tax_item:true})}</div>${taxSaleStatusBadge(a)}</div>
                <div class="font-semibold text-sm truncate mt-1">${esc(a.item_name||'Tax Item')}</div>
                <div class="text-[10px] text-gray-400 mt-1">${esc(a.invoice_no||a.order_no||'Sales Order')} · ${esc(dateText(a.order_date))}</div>
                ${taxSaleComponentsHtml(a)}
              </div>
              <div class="min-w-0"><div class="text-xs font-semibold truncate">${esc(a.customer_name||'Customer')}</div><div class="text-[10px] text-gray-400 truncate">${a.sales_rep_name?'Sales: '+esc(a.sales_rep_name):'Sales rep not recorded'}</div><div class="text-[10px] text-gray-400 mt-1">${esc(new Date(a.sold_at).toLocaleString())}</div></div>
              <div class="text-xs">${a.alert_type==='declared_set'?'<div class="text-gray-400">Complete Sets</div><b class="text-base '+(n(a.complete_sets)>0?'text-green-700':'text-amber-700')+'">'+q(a.complete_sets)+'</b><div class="text-[9px] text-gray-400">Component qty '+q(a.qty)+'</div>':'<div class="text-gray-400">Sold</div><b class="text-base text-red-600">'+q(a.qty)+'</b><div class="text-[9px] text-gray-400">On hand '+q(a.on_hand)+'</div>'}</div>
              <div class="flex items-center justify-end gap-2">
                <span class="text-[9px] text-gray-400">${expanded?'Hide details':'View details'}</span>
                <span class="text-gray-400 text-sm">${expanded?'▴':'▾'}</span>
                <button onclick="event.stopPropagation();acknowledgeTaxSaleAlert('${a.id}')" class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-[10px] font-semibold">Acknowledge</button>
              </div>
            </div>
            ${expanded?taxSaleAlertDetailsHtml(a):''}
          </div>`;
        }).join('')}
      </div>
      ${rows.length>12?`<div class="px-4 py-3 text-center text-[10px] text-red-600">Showing 12 of ${rows.length} open Tax sale alerts.</div>`:''}`}
    </div>`;
  }


  async function loadDeclaredSetCatalog(){
    if(inv.declaredSetCatalogLoaded)return inv.declaredSetCatalog;
    inv.declaredSetCatalog=await taxFetchAll('product_catalog','id,code,item_name,brand,class,image_url,tax_item,active','code');
    inv.declaredSetCatalogLoaded=true;
    return inv.declaredSetCatalog;
  }

  function declaredSetAvailability(rows,key){
    if(!rows.length)return 0;
    return Math.max(0,Math.min(...rows.map(x=>Math.floor(n(x[key])/Math.max(n(x.required_qty),0.000001)))));
  }

  function declaredSetTaxPriceTotals(rows,key){
    const totals=new Map();
    rows.forEach(x=>{
      if(x[key]==null||x[key]==='')return;
      const cur=String(x.tax_currency||'USD').toUpperCase();
      totals.set(cur,(totals.get(cur)||0)+(n(x[key])*n(x.required_qty)));
    });
    return totals;
  }

  function declaredSetTaxPriceText(totals){
    const parts=[...totals.entries()].map(([cur,val])=>money(val,cur));
    return parts.length?parts.join(' + '):'—';
  }

  function renderDeclaredSetModal(){
    const st=inv.declaredSetState;
    const body=document.getElementById('modalBody');
    if(!st||!body)return;
    const p=typeof taxProduct==='function'?taxProduct(st.parent):st.parent;
    const rows=(st.components||[]).map(x=>typeof taxProduct==='function'?taxProduct(x):x);
    const onHandSets=declaredSetAvailability(rows,'on_hand');
    const availableSets=declaredSetAvailability(rows,'available');
    const componentTaxCost=declaredSetTaxPriceTotals(rows,'tax_cost');
    const componentTaxSale=declaredSetTaxPriceTotals(rows,'tax_sale_price');
    body.innerHTML=`<div class="space-y-4">
      <div class="rounded-2xl border bg-[#fcfbf8] p-4">
        <div class="flex flex-col md:flex-row md:items-center gap-4">
          <div class="w-20 h-20 rounded-xl overflow-hidden border bg-white shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[9px] text-gray-400">No Photo</div>'}</div>
          <div class="min-w-0 flex-1"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'')}${taxBadge(p)}</div><div class="font-bold text-lg">${esc(p.item_name||'Declared Tax Item')}</div><div class="text-xs text-gray-400 mt-1">Declared parent · Physical inventory remains on the component Codes below.</div></div>
          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="rounded-xl border bg-white px-4 py-3"><div class="text-[9px] uppercase font-bold text-gray-400">Sets On Hand</div><div class="text-xl font-black">${rows.length?q(onHandSets):'—'}</div></div>
            <div class="rounded-xl border bg-white px-4 py-3"><div class="text-[9px] uppercase font-bold text-gray-400">Sets Available</div><div class="text-xl font-black text-green-700">${rows.length?q(availableSets):'—'}</div></div>
            <div class="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3"><div class="text-[9px] uppercase font-bold text-amber-700">Component Tax Cost / Set</div><div class="text-sm font-black text-amber-900">${declaredSetTaxPriceText(componentTaxCost)}</div></div>
            <div class="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3"><div class="text-[9px] uppercase font-bold text-amber-700">Component Tax Sale / Set</div><div class="text-sm font-black text-amber-900">${declaredSetTaxPriceText(componentTaxSale)}</div></div>
          </div>
        </div>
      </div>

      ${role()==='super_admin'?`<div class="rounded-2xl border p-4">
        <div class="font-bold text-sm">Add Existing Product to This Declared Set</div>
        <div class="text-[10px] text-gray-400 mt-1">A component keeps its own Code, stock and locations. One component Code can belong to one primary Declared Tax Item.</div>
        <div class="grid lg:grid-cols-[1fr_110px_1fr_120px] gap-2 mt-3">
          <div class="relative"><input id="taxSetComponentSearch" oninput="showTaxDeclaredComponentSuggestions(this)" class="w-full border rounded-xl px-3 py-2 text-xs" placeholder="Search Code, product or brand..."><input id="taxSetComponentId" type="hidden"><div id="taxSetComponentSuggestions" class="absolute left-0 right-0 top-full mt-1 z-30 bg-white border rounded-xl shadow-xl max-h-64 overflow-auto hidden"></div></div>
          <input id="taxSetRequiredQty" type="number" min="0.0001" step="0.01" value="1" class="border rounded-xl px-3 py-2 text-xs" placeholder="Required qty">
          <input id="taxSetComponentNote" class="border rounded-xl px-3 py-2 text-xs" placeholder="Optional note">
          <button onclick="addTaxDeclaredComponent()" class="px-3 py-2 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Add Component</button>
        </div>
      </div>`:''}

      <div class="rounded-2xl border overflow-hidden">
        <div class="px-4 py-3 bg-gray-50 border-b flex items-center justify-between gap-3"><div><div class="font-bold text-sm">Set Components</div><div class="text-[10px] text-gray-400">${rows.length} mapped product${rows.length===1?'':'s'}</div></div><div class="text-[10px] text-gray-500">Complete set = every component meets its Required Qty.</div></div>
        <div class="divide-y">${rows.length?rows.map(x=>`<div class="p-4 grid xl:grid-cols-[1.35fr_95px_95px_150px_1.05fr_220px] gap-3 items-center">
          <div class="flex items-center gap-3 min-w-0"><div class="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden shrink-0">${x.image_url?`<img loading="lazy" decoding="async" src="${esc(x.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(x.code||'')}${x.tax_item?taxBadge({tax_item:true}):''}</div><div class="font-semibold text-sm truncate">${esc(x.item_name||'')}</div><div class="text-[10px] text-gray-400">${esc(x.brand||'')}</div></div></div>
          <div class="text-xs"><div class="text-gray-400">On Hand</div><b class="text-base">${q(x.on_hand)}</b><div class="text-[9px] text-gray-400">Available ${q(x.available)}</div></div>
          <div class="text-xs">${role()==='super_admin'?`<label class="text-gray-400">Required Qty</label><input id="taxSetReq_${x.id}" type="number" min="0.0001" step="0.01" value="${esc(x.required_qty)}" class="mt-1 w-full border rounded-lg px-2 py-1.5 text-xs">`:`<div class="text-gray-400">Required</div><b class="text-base">${q(x.required_qty)}</b>`}</div>
          <div class="text-xs"><div class="text-gray-400">Tax Pricing</div><div class="mt-1"><b>${x.tax_cost==null?'—':money(n(x.tax_cost),x.tax_currency||'USD')}</b><div class="text-[9px] text-gray-400">Cost</div></div><div class="mt-1"><b class="text-amber-800">${x.tax_sale_price==null?'—':money(n(x.tax_sale_price),x.tax_currency||'USD')}</b><div class="text-[9px] text-gray-400">Sale</div></div></div>
          <div class="text-[10px] text-gray-500">${(x.locations||[]).filter(l=>n(l.qty)!==0).map(l=>`<span class="inline-flex mr-1 mb-1 px-2 py-1 rounded-lg border bg-gray-50"><b>${esc(l.code)}</b>&nbsp;${q(l.qty)}</span>`).join('')||'<span class="text-gray-400">No stock location</span>'}</div>
          <div>${role()==='super_admin'?`<input id="taxSetNote_${x.id}" value="${esc(x.note||'')}" class="w-full border rounded-lg px-2 py-1.5 text-[10px]" placeholder="Component note"><div class="flex justify-end gap-1.5 mt-2"><button onclick="saveTaxDeclaredComponent('${x.id}','${x.component_product_id}')" class="px-2.5 py-1.5 border rounded-lg text-[10px] font-semibold">Save</button><button onclick="removeTaxDeclaredComponent('${x.id}')" class="px-2.5 py-1.5 border border-red-200 text-red-600 rounded-lg text-[10px] font-semibold">Remove</button></div>`:x.note?`<div class="text-[10px] text-gray-500">${esc(x.note)}</div>`:''}</div>
        </div>`).join(''):'<div class="p-10 text-center text-sm text-gray-400">No components mapped yet. This Tax Item currently behaves as a direct Tax Item.</div>'}</div>
      </div>
      <div class="rounded-xl border border-amber-100 bg-amber-50 p-3 text-[10px] text-amber-800"><b>Important:</b> Declared Set mapping never moves or combines physical stock. Sales are classified as Partial / Complete / Multiple Sets for tax monitoring only. Actual deductions still require the approved stock workflow.</div>
    </div>`;
  }

  window.openTaxDeclaredSet=async function(productId){
    if(!canView())return showToast('Inventory access required.','err');
    try{
      if(inv.tab==='tax')await loadTaxCore();else await loadCore();
      const p=inv.taxBalanceMap.get(productId)||inv.balanceMap.get(productId);
      if(!p||!p.tax_item)return showToast('Only Tax Items can be Declared Items.','err');
      openModal('Declared Tax Set — '+(p.code||p.item_name||'Tax Item'),'<div class="py-12 text-center text-sm text-gray-400">Loading declared set...</div>');
      const [r]=await Promise.all([
        db.rpc('get_tax_declared_set_components',{p_declared_product_id:productId}),
        role()==='super_admin'?loadDeclaredSetCatalog():Promise.resolve([])
      ]);
      if(r.error)throw r.error;
      inv.declaredSetState={parent:p,components:Array.isArray(r.data)?r.data:[]};
      renderDeclaredSetModal();
    }catch(err){
      const body=document.getElementById('modalBody');
      if(body)body.innerHTML='<div class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">'+esc(err.message||'Unable to load Declared Set.')+'</div>';
      else showToast(err.message||'Unable to load Declared Set.','err');
    }
  };

  window.showTaxDeclaredComponentSuggestions=function(input){
    const st=inv.declaredSetState,box=document.getElementById('taxSetComponentSuggestions');
    if(!st||!box)return;
    document.getElementById('taxSetComponentId').value='';
    const s=String(input?.value||'').trim().toLowerCase();
    if(!s){box.classList.add('hidden');box.innerHTML='';return}
    const used=new Set((st.components||[]).map(x=>String(x.component_product_id)));
    const rows=(inv.declaredSetCatalog||[]).filter(p=>p.active!==false&&String(p.id)!==String(st.parent.product_id)&&!used.has(String(p.id))&&[p.code,p.item_name,p.brand,p.class].filter(Boolean).join(' ').toLowerCase().includes(s)).slice(0,25);
    box.innerHTML=rows.length?rows.map(p=>'<button type="button" onclick="selectTaxDeclaredComponent(\''+p.id+'\')" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-0"><div class="text-[10px] font-bold text-[#a77d1a]">'+esc(p.code||'')+(p.tax_item?taxBadge({tax_item:true}):'')+'</div><div class="text-xs font-semibold">'+esc(p.item_name||'')+'</div><div class="text-[9px] text-gray-400">'+esc(p.brand||'')+'</div></button>').join(''):'<div class="p-3 text-xs text-gray-400">No matching available product.</div>';
    box.classList.remove('hidden');
  };

  window.selectTaxDeclaredComponent=function(id){
    const p=(inv.declaredSetCatalog||[]).find(x=>String(x.id)===String(id));
    if(!p)return;
    document.getElementById('taxSetComponentId').value=p.id;
    document.getElementById('taxSetComponentSearch').value=(p.code||'')+' · '+(p.item_name||'');
    document.getElementById('taxSetComponentSuggestions').classList.add('hidden');
  };

  async function reloadDeclaredSetState(){
    const st=inv.declaredSetState;
    if(!st)return;
    const r=await db.rpc('get_tax_declared_set_components',{p_declared_product_id:st.parent.product_id});
    if(r.error)throw r.error;
    st.components=Array.isArray(r.data)?r.data:[];
    renderDeclaredSetModal();
  }

  window.addTaxDeclaredComponent=async function(){
    if(role()!=='super_admin')return showToast('Super Admin only.','err');
    const st=inv.declaredSetState;if(!st)return;
    const componentId=document.getElementById('taxSetComponentId')?.value||'';
    const qty=n(document.getElementById('taxSetRequiredQty')?.value);
    const note=document.getElementById('taxSetComponentNote')?.value.trim()||null;
    if(!componentId)return showToast('Choose a product from the suggestions.','err');
    if(qty<=0)return showToast('Required Qty must be greater than 0.','err');
    const r=await db.rpc('set_tax_declared_set_component',{p_declared_product_id:st.parent.product_id,p_component_product_id:componentId,p_required_qty:qty,p_note:note});
    if(r.error)return showToast(r.error.message,'err');
    await reloadDeclaredSetState();
    inv.taxSaleAlertsLoadedAt=0;
    await loadTaxSaleAlerts(true);
    if(typeof window.refreshAppNotifications==='function')window.refreshAppNotifications();
    showToast('Component added to Declared Set.');
  };

  window.saveTaxDeclaredComponent=async function(mappingId,componentId){
    if(role()!=='super_admin')return;
    const st=inv.declaredSetState;if(!st)return;
    const qty=n(document.getElementById('taxSetReq_'+mappingId)?.value);
    const note=document.getElementById('taxSetNote_'+mappingId)?.value.trim()||null;
    if(qty<=0)return showToast('Required Qty must be greater than 0.','err');
    const r=await db.rpc('set_tax_declared_set_component',{p_declared_product_id:st.parent.product_id,p_component_product_id:componentId,p_required_qty:qty,p_note:note});
    if(r.error)return showToast(r.error.message,'err');
    await reloadDeclaredSetState();
    inv.taxSaleAlertsLoadedAt=0;
    await loadTaxSaleAlerts(true);
    if(typeof window.refreshAppNotifications==='function')window.refreshAppNotifications();
    showToast('Declared Set component updated.');
  };

  window.removeTaxDeclaredComponent=async function(mappingId){
    if(role()!=='super_admin')return;
    const r=await db.rpc('remove_tax_declared_set_component',{p_mapping_id:mappingId});
    if(r.error)return showToast(r.error.message,'err');
    await reloadDeclaredSetState();
    inv.taxSaleAlertsLoadedAt=0;
    await loadTaxSaleAlerts(true);
    if(typeof window.refreshAppNotifications==='function')window.refreshAppNotifications();
    showToast('Component removed from Declared Set.');
  };

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
  window.setInventoryTab=function(tab){inv.tab=tab;window.inventoryReservedOnly=false;resetInventoryLimit(tab);renderStockInventory()};
  window.setInventorySearch=function(v){inv.search=v;window.inventoryReservedOnly=false;resetInventoryLimit(inv.tab);renderStockInventoryBody()};

  function invalidateInventoryTasks(){inv.taskLoadedAt=0}
  window.invalidateInventoryCache=function(){inv.taskLoadedAt=0;inv.locations=[];inv.balances=[];inv.taxBalances=[];inv.taxBalanceMap=new Map();inv.taxLoadedAt=0;inv.taxSaleAlertsLoadedAt=0;inv.taxCodes=[];inv.taxCodesLoadedAt=0;inv.declaredSetCatalog=[];inv.declaredSetCatalogLoaded=false;inv.balanceMap=new Map();inv.locationCompanies=[];inv.locationGroups=[];inv.locationMemberships=[];inv.deliveryRows=[];inv.poRows=[];};

  async function loadInventoryTasks(force=false){
    const now=Date.now();
    if(!force&&inv.taskLoadedAt&&now-inv.taskLoadedAt<30000)return inv.taskData;
    const [poQ,delQ,countQ,reqQ]=await Promise.all([
      db.rpc('get_inventory_po_receiving_queue',{p_search:null}),
      db.rpc('get_inventory_fulfillment_queue',{p_search:null}),
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
    const poRows=poQ.data||[],fulfillmentRows=delQ.data||[],delRows=fulfillmentRows.filter(x=>!!x.inventory_tracking_enabled),countRows=countQ.data||[],reqRows=reqQ.data||[];
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
    inv.taskData={poRows,delRows,fulfillmentRows,countRows,reqRows,openCounts,pendingRequests,duePO,overduePO,aged365,unassigned};
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
    const view={name:clean,tab:inv.tab,search:inv.search||'',companyFilter:inv.companyFilter||'',groupFilter:inv.groupFilter||'',locationFilter:inv.locationFilter||'',ageFilter:inv.ageFilter||'',taxOnly:inv.taxOnly};
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
    window.inventoryReservedOnly=false;
    inv.search=row.search||'';
    inv.companyFilter=row.companyFilter||'';
    inv.groupFilter=row.groupFilter||'';
    inv.locationFilter=row.locationFilter||'';
    inv.ageFilter=row.ageFilter||'';inv.taxOnly=!!row.taxOnly;
    resetInventoryLimit(inv.tab);
    renderStockInventory();
  };
  window.openSavedInventoryViews=function(){
    const rows=savedInventoryViews();
    openModal('Saved Stock Views',`<div class="space-y-3">
      ${rows.length?rows.map((x,i)=>`<div class="rounded-xl border p-3 flex items-center justify-between gap-3"><button onclick="applySavedInventoryView('${i}');closeModal()" class="text-left min-w-0"><b class="text-sm">${esc(x.name||'Saved View')}</b><div class="text-[10px] text-gray-400 mt-1">${esc(titleCase(x.tab||'balance'))}${x.companyFilter?' · Company filter':''}${x.groupFilter?' · Group filter':''}${x.locationFilter?' · Location filter':''}${x.ageFilter?' · Aging '+esc(x.ageFilter):''}${x.search?' · Search: '+esc(x.search):''}</div></button><button onclick="deleteSavedInventoryView(${i})" class="px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-[10px] font-semibold">Delete</button></div>`).join(''):'<div class="py-10 text-center text-sm text-gray-400">No saved Stock views yet.</div>'}
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
      ['tax','Tax Inventory',0],
      ['receive','Receive PO',inv.taskBadges.receive||0],
      ['delivery','Customer Fulfillment',inv.taskBadges.delivery||0]
    ];
    t.push(['counts','Stock Count',inv.taskBadges.counts||0],['reports','Reports',0]);
    if(canReconcile())t.push(['history-reconstruction','History Repair',0]);
    if(canAdmin()||isStockController())t.push(['requests',canAdmin()?'Approvals / Requests':'My Requests',inv.taskBadges.requests||0]);
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
      ${btn('Customer Fulfillment','Review and release tracked customer stock orders',"quickInventoryGo('delivery')")}
      ${btn('Start Stock Count','Start a monthly physical count for a location',"quickInventoryGo('counts',true)")}
      ${btn('Find Product','Search a product and open its Stock Card',"openInventoryProductFinder()")}
    </div>`);
  };

  window.openInventoryProductFinder=async function(){
    await loadCore();
    openModal('Find Product',`<div><label class="text-xs font-semibold">Code / Product / Brand</label><div class="relative"><input id="invFindProduct" autocomplete="off" onfocus="showInventoryFinderSuggestions(this)" oninput="showInventoryFinderSuggestions(this)" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Type Code, item name or brand..."><div id="invFindSuggestions" class="absolute z-[150] left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-white border rounded-xl shadow-xl"></div></div></div>`);
    setTimeout(()=>document.getElementById('invFindProduct')?.focus(),50);
  };
  window.showInventoryFinderSuggestions=function(input){
    const box=document.getElementById('invFindSuggestions');if(!box)return;
    const rows=stockProductMatches(input?.value||'').slice(0,30);
    box.innerHTML=rows.length?rows.map(p=>`<button onclick="openProductStockCard('${p.product_id}')" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-0 flex gap-3 items-center"><div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'')}${taxBadge(p)}</div><div class="font-semibold text-sm truncate">${esc(p.item_name||'')}</div><div class="text-[10px] text-gray-400">On hand ${q(p.on_hand)} · Available ${q(p.available)} · On order ${q(p.on_order)} · Incoming ${q(p.incoming)} · Arrived ${q(p.arrived_pending_receive)}</div></div></button>`).join(''):'<div class="p-4 text-sm text-gray-400">No matching product.</div>';
  };


  async function renderDashboard(){
    await loadCore();
    const tasks=await loadInventoryTasks();
    const onHand=inv.balances.reduce((a,x)=>a+n(x.on_hand),0);
    const reserved=inv.balances.reduce((a,x)=>a+n(x.reserved),0);
    const available=inv.balances.reduce((a,x)=>a+n(x.available),0);
    const onOrder=inv.balances.reduce((a,x)=>a+n(x.on_order),0);
    const incoming=inv.balances.reduce((a,x)=>a+n(x.incoming),0);
    const arrivedPending=inv.balances.reduce((a,x)=>a+n(x.arrived_pending_receive),0);
    const stocked=inv.balances.filter(x=>n(x.on_hand)>0).length;
    const noAvail=inv.balances.filter(x=>n(x.on_hand)>0&&n(x.available)<=0).length;

    const mov=await db.from('inventory_movement_history').select('*').neq('movement_type','opening').order('movement_date',{ascending:false}).order('created_at',{ascending:false}).limit(8);
    if(mov.error)throw mov.error;
    const recent=mov.data||[];
    const dashMatches=inv.search?stockProductMatches(inv.search).slice(0,8):[];
    return `<div class="grid sm:grid-cols-2 xl:grid-cols-8 gap-3 mb-5">
      <div class="inv-stat"><div class="inv-stat-label">On Hand</div><div class="inv-stat-value">${q(onHand)}</div></div>
      <button onclick="openAllReservedStockDetails()" class="inv-stat text-left hover:shadow-sm transition" title="View products reserved for active Sales Orders"><div class="inv-stat-label">Reserved</div><div class="inv-stat-value text-amber-600">${q(reserved)}</div><div class="text-[9px] text-gray-400 mt-1">Click to view orders</div></button>
      <div class="inv-stat"><div class="inv-stat-label">Available</div><div class="inv-stat-value text-green-600">${q(available)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">On Order</div><div class="inv-stat-value text-amber-700">${q(onOrder)}</div><div class="text-[9px] text-gray-400 mt-1">Ordered / Production / Ready</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Incoming</div><div class="inv-stat-value text-blue-600">${q(incoming)}</div><div class="text-[9px] text-gray-400 mt-1">Shipping only</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Arrived Pending Receive</div><div class="inv-stat-value text-purple-600">${q(arrivedPending)}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Codes In Stock</div><div class="inv-stat-value">${stocked.toLocaleString()}</div></div>
      <div class="inv-stat"><div class="inv-stat-label">Fully Reserved</div><div class="inv-stat-value ${noAvail?'text-red-500':''}">${noAvail.toLocaleString()}</div></div>
    </div>

    ${inv.search?`<div class="inv-card mb-5"><div class="flex items-center justify-between gap-3 mb-3"><div><h3 class="font-bold">Product Search</h3><div class="text-[10px] text-gray-400">Quick stock results for "${esc(inv.search)}".</div></div><button onclick="setInventorySearch('')" class="text-xs text-gray-500">Clear</button></div><div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">${dashMatches.length?dashMatches.map(p=>`<button onclick="openProductStockCard('${p.product_id}')" class="rounded-xl border p-3 text-left hover:bg-amber-50/30 flex gap-3 items-center"><div class="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'')}${taxBadge(p)}</div><div class="text-sm font-semibold truncate">${esc(p.item_name||'')}</div><div class="text-[10px] text-gray-400">On hand ${q(p.on_hand)} · Available ${q(p.available)}</div></div></button>`).join(''):'<div class="col-span-full py-6 text-center text-sm text-gray-400">No matching product.</div>'}</div></div>`:''}

    <div class="flex items-end justify-between gap-3 mb-3">
      <div><h3 class="font-bold text-lg">Today's Work</h3><div class="text-[10px] text-gray-400">Open the task that needs attention instead of searching through every tab.</div></div>
      ${canOperate()?`<button onclick="openQuickStockAction()" class="px-3 py-2 bg-[#211d18] text-white rounded-xl text-xs font-semibold">＋ Quick Action</button>`:''}
    </div>
    <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
      <button onclick="setInventoryTab('receive')" class="inv-task-card border-purple-100 bg-purple-50/30"><div class="text-[9px] uppercase font-bold text-gray-400">Arrived Pending Receive</div><div class="text-2xl font-black mt-1">${tasks.poRows.length.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">Only PO items marked Arrived and waiting for warehouse receipt</div></button>
      <button onclick="setInventoryTab('delivery')" class="inv-task-card border-amber-100 bg-amber-50/30"><div class="text-[9px] uppercase font-bold text-gray-400">Customer Fulfillment</div><div class="text-2xl font-black mt-1">${tasks.delRows.length.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">Linked customer item lines waiting for fulfillment / release</div></button>
      <button onclick="setInventoryTab('counts')" class="inv-task-card"><div class="text-[9px] uppercase font-bold text-gray-400">Open Stock Counts</div><div class="text-2xl font-black mt-1">${tasks.openCounts.length.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">Draft / submitted counts needing completion or reconciliation</div></button>
      ${(canAdmin()||isStockController())?`<button onclick="setInventoryTab('requests')" class="inv-task-card"><div class="text-[9px] uppercase font-bold text-gray-400">${canAdmin()?'Pending Edit Requests':'My Pending Requests'}</div><div class="text-2xl font-black mt-1">${tasks.pendingRequests.length.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">Movement corrections waiting for action</div></button>`:''}
      <button onclick="openInventoryTask('aged')" class="inv-task-card border-red-100 bg-red-50/20"><div class="text-[9px] uppercase font-bold text-gray-400">Aging 365+ Days</div><div class="text-2xl font-black mt-1">${tasks.aged365.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">Products with old remaining stock</div></button>
      <button onclick="openInventoryTask('unassigned')" class="inv-task-card border-amber-100 bg-amber-50/20"><div class="text-[9px] uppercase font-bold text-gray-400">Unassigned Location</div><div class="text-2xl font-black mt-1">${tasks.unassigned.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">Products still sitting in UNASSIGNED / review</div></button>
      <button onclick="openInventoryTask('reserved')" class="inv-task-card"><div class="text-[9px] uppercase font-bold text-gray-400">Fully Reserved</div><div class="text-2xl font-black mt-1">${noAvail.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">On-hand products with no available quantity</div></button>
      <button onclick="openInventoryProductFinder()" class="inv-task-card"><div class="text-[9px] uppercase font-bold text-gray-400">Find Product</div><div class="text-2xl font-black mt-1">${stocked.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">Open a Stock Card by Code, product or brand</div></button>
    </div>

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

  window.openInventoryTask=function(kind){
    inv.search='';inv.companyFilter='';inv.groupFilter='';inv.locationFilter='';inv.ageFilter='';window.inventoryReservedOnly=false;
    if(kind==='aged'){inv.tab='balance';inv.ageFilter='365+'}
    else if(kind==='unassigned'){
      inv.tab='balance';
      const l=inv.locations.find(x=>String(x.code||'').toUpperCase()==='UNASSIGNED');
      if(l)inv.locationFilter=l.id;else inv.search='UNASSIGNED';
    }else if(kind==='reserved'){inv.tab='balance';window.inventoryReservedOnly=true}
    renderStockInventory();
  };

  window.openAllReservedStockDetails=async function(){
    try{
      await loadCore();
      const rows=(inv.balances||[]).filter(x=>n(x.reserved)>0).sort((a,b)=>n(b.reserved)-n(a.reserved));
      const total=rows.reduce((s,x)=>s+n(x.reserved),0);
      openModal('Reserved Stock',`<div class="space-y-4">
        <div class="rounded-2xl border bg-amber-50/40 border-amber-100 p-4">
          <div class="text-xs text-gray-500">Stock committed to active Sales Orders and not yet delivered.</div>
          <div class="mt-2 flex flex-wrap gap-4 text-xs">
            <span>Reserved Qty <b class="text-amber-700">${q(total)}</b></span>
            <span>Products <b>${rows.length.toLocaleString()}</b></span>
          </div>
        </div>
        <div class="divide-y border rounded-xl px-4 max-h-[62vh] overflow-auto">
          ${rows.length?rows.map(p=>`<button onclick="openReservedStockDetails('${p.product_id}')" class="w-full py-3 flex items-center justify-between gap-4 text-left hover:bg-gray-50">
            <div class="min-w-0 flex items-center gap-3">
              <div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
              <div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'')}${taxBadge(p)}</div><div class="text-sm font-semibold truncate">${esc(p.item_name||'')}</div><div class="text-[10px] text-gray-400">On Hand ${q(p.on_hand)} · Available ${q(p.available)}</div></div>
            </div>
            <div class="text-right shrink-0"><div class="text-[9px] uppercase font-bold text-gray-400">Reserved</div><div class="text-lg font-black text-amber-600">${q(p.reserved)}</div></div>
          </button>`).join(''):'<div class="py-10 text-center text-sm text-gray-400">No stock is currently reserved.</div>'}
        </div>
      </div>`);
    }catch(err){
      showToast(err.message||'Unable to load reserved stock.','err');
    }
  };

  window.openReservedStockDetails=async function(productId){
    try{
      await loadCore();
      const p=inv.balanceMap.get(productId);
      if(!p)return showToast('Product not found.','err');
      openModal('Reserved Stock — '+(p.code||p.item_name||'Product'),'<div class="py-10 text-center text-sm text-gray-400">Loading reservation details...</div>');
      const r=await db.rpc('get_inventory_reserved_details',{p_product_id:productId});
      if(r.error)throw r.error;
      const rows=r.data||[];
      const total=rows.reduce((s,x)=>s+n(x.reserved_qty),0);
      const body=document.getElementById('modalBody');
      if(!body)return;
      body.innerHTML=`<div class="space-y-4">
        <div class="rounded-2xl border bg-[#fcfbf8] p-4">
          <div class="flex flex-col sm:flex-row sm:items-center gap-4">
            <div class="w-20 h-20 rounded-xl overflow-hidden border bg-white shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
            <div class="min-w-0 flex-1"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'')}${taxBadge(p)}</div><div class="font-bold text-lg">${esc(p.item_name||'')}</div><div class="text-xs text-gray-400 mt-1">${esc(p.brand||'')}</div></div>
            <div class="grid grid-cols-3 gap-2 text-center shrink-0">
              <div class="rounded-xl border bg-white px-3 py-2"><div class="text-[9px] uppercase font-bold text-gray-400">On Hand</div><b>${q(p.on_hand)}</b></div>
              <div class="rounded-xl border bg-amber-50/40 border-amber-100 px-3 py-2"><div class="text-[9px] uppercase font-bold text-gray-400">Reserved</div><b class="text-amber-700">${q(p.reserved)}</b></div>
              <div class="rounded-xl border bg-white px-3 py-2"><div class="text-[9px] uppercase font-bold text-gray-400">Available</div><b class="text-green-700">${q(p.available)}</b></div>
            </div>
          </div>
          <div class="text-[10px] text-gray-400 mt-3">Reserved = active stock-type Sales Order quantity minus stock already released/delivered. Cancelled orders and cancelled items are excluded.</div>
          ${Math.abs(total-n(p.reserved))>0.0001?`<div class="mt-2 text-[10px] text-amber-700">Live detail total ${q(total)} differs from displayed balance ${q(p.reserved)}. Refreshing the Stock tab will update the balance.</div>`:''}
        </div>

        <div>
          <div class="flex items-center justify-between gap-3 mb-2">
            <div><h4 class="font-bold">Sales Orders Reserving This Stock</h4><div class="text-[10px] text-gray-400">Only active, undelivered reservation quantities are shown.</div></div>
            <span class="text-xs font-bold text-amber-700">${q(total)} pcs</span>
          </div>
          <div class="divide-y border rounded-xl px-4 max-h-[58vh] overflow-auto">
            ${rows.length?rows.map(x=>`<div class="py-3 grid md:grid-cols-[1.15fr_1.35fr_90px_1fr_115px] gap-3 items-center text-xs">
              <div class="min-w-0"><div class="font-bold truncate">${esc(x.document_no||'Sales Order')}</div><div class="text-[9px] text-gray-400">${esc(dateText(x.order_date||x.reservation_date))}</div></div>
              <div class="min-w-0"><div class="font-semibold truncate">${esc(x.customer_name||'Customer')}</div><div class="text-[9px] text-gray-400 truncate">${x.sales_rep_name?'Sales: '+esc(x.sales_rep_name):'Sales rep not recorded'}</div></div>
              <div><div class="text-[9px] uppercase font-bold text-gray-400">Reserved</div><b class="text-base text-amber-700">${q(x.reserved_qty)}</b></div>
              <div><span class="inline-flex px-2 py-1 rounded-lg border bg-gray-50 text-[9px] font-bold">${esc(titleCase(x.order_status||'active'))}</span><div class="text-[9px] text-gray-400 mt-1">Item: ${esc(titleCase(x.fulfillment_status||'pending'))}</div></div>
              <div class="text-right"><div class="text-[9px] uppercase font-bold text-gray-400">Reserved On</div><div class="font-semibold">${esc(dateText(x.reservation_date||x.order_date))}</div><div class="text-[9px] text-gray-400">Ordered ${q(x.ordered_qty)} · Released ${q(x.released_qty)}</div></div>
            </div>`).join(''):'<div class="py-10 text-center text-sm text-gray-400">No active Sales Order reservations for this product.</div>'}
          </div>
        </div>
      </div>`;
    }catch(err){
      const body=document.getElementById('modalBody');
      if(body)body.innerHTML=`<div class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">Unable to load reservation details: ${esc(err.message||'Unknown error')}</div>`;
      else showToast(err.message||'Unable to load reservation details.','err');
    }
  };

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
    const locOptions=inv.locations.filter(x=>x.active).map(x=>{const c=locationCompany(x.company_id);const label=c?`${c.name} · ${stockLocationLabel(x)}`:stockLocationLabel(x);return `<option value="${x.id}" ${String(inv.locationFilter)===String(x.id)?'selected':''}>${esc(label)}</option>`}).join('');
    const companyOptions=inv.locationCompanies.filter(x=>x.active).map(x=>`<option value="${x.id}" ${String(inv.companyFilter)===String(x.id)?'selected':''}>${esc(x.name)}</option>`).join('');
    const groupOptions=inv.locationGroups.filter(x=>x.active).map(x=>`<option value="${x.id}" ${String(inv.groupFilter)===String(x.id)?'selected':''}>${esc(x.name)}</option>`).join('');
    const ages=[['','All Aging'],['0-30','0–30 days'],['31-90','31–90 days'],['91-180','91–180 days'],['181-365','181–365 days'],['365+','365+ days'],['Unknown','Unknown / Pre-history']];
    const saved=savedInventoryViews();
    return `<div class="mb-4 flex flex-wrap gap-2 items-center">
      ${context==='balance'?`<label class="text-xs flex gap-2 items-center"><input type="checkbox" ${inv.tab==='tax'||inv.taxOnly?'checked':''} ${inv.tab==='tax'?'disabled':''} onchange="setInventoryTaxOnly(this.checked)">Tax Items Only</label><button onclick="refreshTaxInventory()" class="px-3 py-2 border rounded-xl text-xs">Refresh Balances</button>${role()==='super_admin'?'<button onclick="openBulkTaxTagging()" class="px-3 py-2 border rounded-xl text-xs">Bulk Tax Tagging</button>':''}<select onchange="setInventoryCompanyFilter(this.value)" class="border rounded-xl px-3 py-2 bg-white text-xs"><option value="">All Companies</option>${companyOptions}</select><select onchange="setInventoryGroupFilter(this.value)" class="border rounded-xl px-3 py-2 bg-white text-xs"><option value="">All Location Groups</option>${groupOptions}</select>`:''}
      <select onchange="setInventoryLocationFilter(this.value)" class="border rounded-xl px-3 py-2 bg-white text-xs"><option value="">All Locations</option>${locOptions}</select>
      <select onchange="setInventoryAgeFilter(this.value)" class="border rounded-xl px-3 py-2 bg-white text-xs">${ages.map(([v,l])=>`<option value="${v}" ${inv.ageFilter===v?'selected':''}>${l}</option>`).join('')}</select>
      <select onchange="applySavedInventoryView(this.value);this.value=''" class="border rounded-xl px-3 py-2 bg-white text-xs"><option value="">Saved Views</option>${saved.map((x,i)=>`<option value="${i}">${esc(x.name||'Saved View')}</option>`).join('')}</select>
      <button onclick="saveCurrentInventoryView()" class="px-3 py-2 border rounded-xl text-xs font-semibold bg-white">Save View</button>
      ${saved.length?`<button onclick="openSavedInventoryViews()" class="px-3 py-2 border rounded-xl text-xs bg-white text-gray-500">Manage</button>`:''}
      ${inv.companyFilter||inv.groupFilter||inv.locationFilter||inv.ageFilter||inv.taxOnly?`<button onclick="clearInventoryFilters()" class="px-3 py-2 border rounded-xl text-xs font-semibold bg-white">Clear Filters</button>`:''}
      <div class="text-[10px] text-gray-400 ml-auto">Aging uses the oldest remaining recorded inbound layer (FIFO estimate). Stock older than imported history appears as Unknown.</div>
    </div>`;
  }
  window.setInventoryCompanyFilter=function(v){inv.companyFilter=v||'';window.inventoryReservedOnly=false;resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  window.setInventoryGroupFilter=function(v){inv.groupFilter=v||'';window.inventoryReservedOnly=false;resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  window.setInventoryLocationFilter=function(v){inv.locationFilter=v||'';window.inventoryReservedOnly=false;resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  window.setInventoryAgeFilter=function(v){inv.ageFilter=v||'';window.inventoryReservedOnly=false;resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  window.setInventoryTaxOnly=function(v){inv.taxOnly=!!v;resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  window.refreshTaxInventory=async function(){try{await Promise.all([loadTaxCore(true),loadTaxSaleAlerts(true),loadTaxDeclaredCodes(true)]);await renderStockInventoryBody()}catch(err){showToast(err.message,'err')}};
  window.clearInventoryFilters=function(){inv.taxOnly=false;inv.companyFilter='';inv.groupFilter='';inv.locationFilter='';inv.ageFilter='';window.inventoryReservedOnly=false;resetInventoryLimit(inv.tab);renderStockInventoryBody()};
  function productPassesInventoryFilters(p){
    if((inv.tab==='tax'||inv.taxOnly)&&!p.tax_item)return false;
    if(inv.companyFilter){
      const companyLocs=new Set(inv.locations.filter(x=>String(x.company_id||'')===String(inv.companyFilter)).map(x=>String(x.id)));
      const ok=(p.locations||[]).some(l=>companyLocs.has(String(l.location_id))&&n(l.qty)!==0);
      if(!ok)return false;
    }
    if(inv.groupFilter){
      const groupLocs=locationMembershipSet(inv.groupFilter);
      const ok=(p.locations||[]).some(l=>groupLocs.has(String(l.location_id))&&n(l.qty)!==0);
      if(!ok)return false;
    }
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
    const source=inv.tab==='tax'?inv.taxBalances:inv.balances;
    return source.filter(x=>{
      const searchOk=!s||[
        x.code,x.item_name,x.brand,x.class,x.tax_group_or_set,x.tax_note,
        ...(Array.isArray(x.locations)?x.locations.map(l=>l.code):[])
      ].filter(Boolean).join(' ').toLowerCase().includes(s);
      const reservedOk=!window.inventoryReservedOnly||(n(x.on_hand)>0&&n(x.available)<=0);
      return searchOk&&reservedOk&&productPassesInventoryFilters(x);
    });
  }

  async function renderBalance(){
    if(inv.tab==='tax')await Promise.all([loadTaxCore(),loadTaxSaleAlerts(),loadTaxDeclaredCodes(),typeof loadTaxProducts==='function'?loadTaxProducts():Promise.resolve([])]);else await loadCore();
    const rows=balanceFiltered(),shown=rows.slice(0,inventoryLimit(inv.tab));
    const taxUnits=inv.tab==='tax'?inv.taxBalances.reduce((sum,p)=>sum+n(p.on_hand),0):0;
    const taxNoStock=inv.tab==='tax'?inv.taxBalances.filter(p=>n(p.on_hand)<=0).length:0;
    const taxHeader=inv.tab==='tax'?`<div class="tax-panel text-sm"><div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"><div><b>Tax Inventory</b><p class="mt-1 text-xs">Live mirror of tax-tagged products in the shared stock ledger. Selling a Tax Item or a mapped Declared Set component creates an alert; quantities still change only through approved stock tasks.</p></div><div class="flex items-center gap-2 flex-wrap justify-end">${canAdmin()?'<button onclick="exportTaxProductsExcel()" class="px-3 py-2 rounded-xl border bg-white text-xs font-semibold">Export Tax Items</button>':''}<div class="text-[10px] text-gray-500">Imported master list: Tax Stock LPHome · 30 Sep 2026</div></div></div></div>
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <div class="inv-stat"><div class="inv-stat-label">Physical Tax Items</div><div class="inv-stat-value">${inv.taxBalances.length.toLocaleString()}</div></div>
        <div class="inv-stat"><div class="inv-stat-label">Tax-only Codes / Sets</div><div class="inv-stat-value">${(inv.taxCodes||[]).filter(x=>x.active!==false).length.toLocaleString()}</div></div>
        <div class="inv-stat"><div class="inv-stat-label">Tax Units On Hand</div><div class="inv-stat-value">${q(taxUnits)}</div></div>
        <div class="inv-stat"><div class="inv-stat-label">Tax Items Out of Stock</div><div class="inv-stat-value ${taxNoStock?'text-amber-600':''}">${taxNoStock.toLocaleString()}</div></div>
        <div class="inv-stat"><div class="inv-stat-label">Sold / Action Required</div><div class="inv-stat-value ${inv.taxSaleAlerts.length?'text-red-600':''}">${role()==='super_admin'?inv.taxSaleAlerts.length.toLocaleString():'—'}</div></div>
      </div>
      ${taxDeclaredCodesHtml()}
      ${taxSaleAlertsHtml()}`:'';
    return `${taxHeader}${inventoryFilterControls('balance')}<div class="card rounded-2xl overflow-hidden">
      <div class="divide-y">${shown.length?shown.map(p=>{const a=inv.agingMap.get(p.product_id),tp=typeof taxProduct==='function'?taxProduct(p):p;return `<div class="p-4 grid xl:grid-cols-[1.45fr_68px_68px_68px_68px_68px_82px_92px_1.15fr_150px] gap-3 items-center ${n(p.on_hand)>0&&n(p.available)<=0?'bg-red-50/30 border-l-4 border-red-300':a?.age_bucket==='365+'?'bg-amber-50/25 border-l-4 border-amber-300':''}">
        <button onclick="openProductStockCard('${p.product_id}')" class="flex items-center gap-3 min-w-0 text-left hover:opacity-80">
          <div class="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
          <div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code)}${taxBadge(p)}</div><div class="font-semibold text-sm truncate">${esc(p.item_name)}</div><div class="text-[10px] text-gray-400">${esc(p.brand||'')} · Open Stock Card</div>${p.tax_group_or_set?`<div class="text-xs">${esc(p.tax_group_or_set)}</div>`:''}${inv.tab==='tax'&&role()==='super_admin'?`<div class="text-[10px] mt-1 text-amber-800"><b>Tax Cost:</b> ${tp.tax_cost==null?'—':money(n(tp.tax_cost),tp.tax_currency||'USD')} · <b>Tax Sale:</b> ${tp.tax_sale_price==null?'—':money(n(tp.tax_sale_price),tp.tax_currency||'USD')}</div>`:''}${tp.tax_pricing_note&&inv.tab==='tax'&&role()==='super_admin'?`<div class="text-[9px] text-amber-700 mt-1 truncate">${esc(tp.tax_pricing_note)}</div>`:''}${p.tax_note?`<div class="text-[10px] text-gray-500 whitespace-pre-wrap">${esc(p.tax_note)}</div>`:''}</div>
        </button>
        <div class="text-xs"><div class="text-gray-400">On Hand</div><b class="text-sm">${q(p.on_hand)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Reserved</div>${n(p.reserved)>0?`<button onclick="openReservedStockDetails('${p.product_id}')" class="text-sm font-bold text-amber-600 hover:underline" title="View Sales Orders reserving this stock">${q(p.reserved)}</button>`:`<b class="text-sm text-amber-600">${q(p.reserved)}</b>`}</div>
        <div class="text-xs"><div class="text-gray-400">Available</div><b class="text-sm ${n(p.available)<0?'text-red-600':'text-green-600'}">${q(p.available)}</b></div>
        <div class="text-xs"><div class="text-gray-400">On Order</div><b class="text-sm text-amber-700">${q(p.on_order)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Incoming</div><b class="text-sm text-blue-600">${q(p.incoming)}</b></div>
        <div class="text-xs"><div class="text-gray-400">Arrived</div><b class="text-sm text-purple-600">${q(p.arrived_pending_receive)}</b><div class="text-[8px] text-gray-400">Pending receive</div></div>
        <div class="text-xs"><div class="text-gray-400">Aging</div><span class="inline-flex mt-1 px-2 py-1 rounded-lg border text-[9px] font-bold ${ageBadgeClass(a?.age_bucket||'Unknown')}">${esc(ageLabel(a))}</span>${a?.oldest_remaining_date?`<div class="text-[9px] text-gray-400 mt-1">Since ${esc(dateText(a.oldest_remaining_date))}</div>`:''}</div>
        <div class="text-[10px] text-gray-500">${(p.locations||[]).filter(l=>n(l.qty)!==0).map(l=>`<span class="inline-flex mr-1 mb-1 px-2 py-1 rounded-lg border ${inv.locationFilter&&String(l.location_id)===String(inv.locationFilter)?'bg-blue-50 border-blue-200 text-blue-700':'bg-gray-50'}"><b>${esc(l.code)}</b>&nbsp;${q(l.qty)}</span>`).join('')||'<span class="text-gray-400">No stock location</span>'}</div>
        <div class="flex flex-wrap gap-1.5 justify-end">${inv.tab==='tax'?`<button onclick="exportTaxProductsExcel('${p.product_id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Export</button><button onclick="openTaxDeclaredSet('${p.product_id}')" class="px-3 py-2 border border-amber-200 bg-amber-50 text-amber-800 rounded-lg text-[10px] font-semibold">Declared Set</button>`:''}${canOperate()?`<button onclick="openStockTransfer('${p.product_id}')" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-semibold">Move</button>`:''}<button onclick="openProductStockCard('${p.product_id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Stock Card</button></div>
      </div>`}).join(''):'<div class="p-10 text-center text-sm text-gray-400">No products match your search / filters.</div>'}</div>
      ${inventoryListControls(inv.tab,rows.length)}
    </div>`;
  }

  function movementRow(m){
    const path=m.from_location&&m.to_location?`${m.from_location} → ${m.to_location}`:m.to_location?`→ ${m.to_location}`:m.from_location?`${m.from_location} →`:'-';
    const p=m.product_id?inv.balanceMap.get(m.product_id):null;
    const liveId=!m.legacy&&String(m.history_id||'').startsWith('live:')?String(m.history_id).slice(5):'';
    const moveBtn=canOperate()&&m.product_id?`<button onclick="openStockTransfer('${m.product_id}')" class="px-2 py-1.5 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-[9px] font-semibold">Move</button>`:'';
    const linkFulfillmentBtn=canReconcile()&&liveId&&m.movement_type==='out'?`<button onclick="openLinkExistingStockOutToFulfillment('${liveId}')" class="px-2 py-1.5 border border-green-200 bg-green-50 text-green-700 rounded-lg text-[9px] font-semibold">Link Fulfillment</button>`:'';
    let actions='';
    if(canAdmin()){
      actions=`<div class="flex gap-1.5 flex-wrap justify-end">${linkFulfillmentBtn}${moveBtn}<button onclick="openAdminStockMovementEdit('${esc(m.history_id||'')}')" class="px-2 py-1.5 border rounded-lg text-[9px] font-semibold">Edit</button><button onclick="deleteStockMovementAdmin('${esc(m.history_id||'')}')" class="px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-[9px] font-semibold">Delete</button></div>`;
    }else if(isStockController()&&liveId){
      actions=`<div class="flex gap-1.5 flex-wrap justify-end">${moveBtn}<button onclick="openStockMovementEditRequest('${liveId}')" class="px-2 py-1.5 border border-amber-200 bg-amber-50 text-amber-700 rounded-lg text-[9px] font-semibold">Request Edit</button><button onclick="requestStockMovementDelete('${liveId}')" class="px-2 py-1.5 border border-red-200 text-red-600 rounded-lg text-[9px] font-semibold">Request Delete</button></div>`;
    }else if(moveBtn){
      actions=`<div class="flex gap-1.5 flex-wrap justify-end">${moveBtn}</div>`;
    }
    return `<div class="py-3 grid md:grid-cols-[105px_1.55fr_110px_90px_1fr_170px] gap-3 items-center text-xs">
      <div><b>${esc(dateText(m.movement_date))}</b><div class="text-[9px] text-gray-400">${esc(m.created_by_name||'System')}${m.legacy?' · Historical':''}</div></div>
      <${m.product_id?'button':'div'} ${m.product_id?`onclick="openProductStockCard('${m.product_id}')"`:''} class="flex items-center gap-3 min-w-0 text-left ${m.product_id?'hover:opacity-80':''}"><div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p?.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(m.code||'')}${taxBadge(p)}</div><div class="font-semibold truncate">${esc(m.item_name||'')}</div><div class="text-[9px] text-gray-400 truncate">${esc(m.reference_no||m.counterparty||'')}</div></div></${m.product_id?'button':'div'}>
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
    return `<div class="rounded-xl border border-purple-100 bg-purple-50/30 p-3 mb-4 text-xs text-purple-800"><b>Receive PO:</b> this queue now shows only items already marked <b>Arrived</b>. Ordered / Production / Ready items stay under <b>On Order</b>; Shipping items show as <b>Incoming</b>.</div><div class="grid gap-3">${shownGroups.length?shownGroups.map(g=>{
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
      else if(inv.tab==='balance'||inv.tab==='tax')html=await renderBalance();
      else if(inv.tab==='movements')html=await renderMovements();
      else if(inv.tab==='receive')html=await renderReceive();
      else if(inv.tab==='delivery')html=await renderDelivery();
      else if(inv.tab==='counts')html=await renderCounts();
      else if(inv.tab==='history-reconstruction'&&typeof window.renderHistoricalReconstructionPanel==='function')html=await window.renderHistoricalReconstructionPanel();
      else if(inv.tab==='requests')html=await renderStockRequests();
      else html=await renderReports();
      body.innerHTML=html;
    }catch(err){body.innerHTML=`<div class="inv-card text-red-600">Error: ${esc(err.message)}</div>`}
  };

  window.renderStockInventory=async function(){
    if(!canView())throw new Error('Inventory access required.');
    injectStyles();
    if(inv.tab==='tax')await loadTaxCore();
    else{await loadCore();await loadInventoryTasks()}
    if(!tabs().some(x=>x[0]===inv.tab))inv.tab='dashboard';
    const searchPlaceholder=inv.tab==='receive'?'Search PO, vendor, Code...':inv.tab==='delivery'?'Search invoice, customer, Code...':inv.tab==='history-reconstruction'?'Search historical reference, customer/vendor, Code...':'Search Code, item, brand, location, reference...';
    document.getElementById('content').innerHTML=`<div class="max-w-[1550px] mx-auto">
      <div class="inv-tabs">${tabs().map(([v,l,b])=>`<button class="inv-tab ${inv.tab===v?'active':''}" onclick="setInventoryTab('${v}')">${l}${b?`<span class="inv-tab-badge">${Number(b).toLocaleString()}</span>`:''}</button>`).join('')}</div>
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
        <div class="w-11 h-11 rounded-lg bg-gray-100 overflow-hidden shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
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
    if(typeof window.refreshStockOutCustomerOptions==='function')setTimeout(()=>window.refreshStockOutCustomerOptions(),0);
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
    if(typeof window.refreshStockOutCustomerOptions==='function')setTimeout(()=>window.refreshStockOutCustomerOptions(),0);
  };

  function stockOutArrivedQty(row){
    const rows=Array.isArray(row?.status_breakdown)?row.status_breakdown:[];
    return rows.filter(x=>String(x?.status||'').toLowerCase()==='arrived').reduce((sum,x)=>sum+n(x?.qty),0);
  }

  function stockOutDoItems(req){
    if(Array.isArray(req?.items))return req.items;
    try{return JSON.parse(req?.items||'[]')}catch(_){return []}
  }

  window.refreshStockOutCustomerOptions=async function(){
    const purpose=document.getElementById('smOutPurpose')?.value||'';
    const type=document.getElementById('smType')?.value||'';
    const select=document.getElementById('smSalesFulfillmentItem');
    const info=document.getElementById('smSalesFulfillmentInfo');
    if(!select)return;
    window._stockOutFulfillmentRows=[];
    window._stockOutDoRows=[];
    const doWrap=document.getElementById('smDoWrap');
    if(doWrap)doWrap.classList.add('hidden');
    if(type!=='out'||purpose!=='customer_delivery'){
      select.innerHTML='<option value="">Choose a product first</option>';
      if(info)info.textContent='Select Customer Delivery purpose and a product to load open Sales items.';
      return;
    }
    const productId=String(document.getElementById('smProductId')?.value||'').trim();
    if(!productId){
      select.innerHTML='<option value="">Choose a product first</option>';
      if(info)info.textContent='Choose the product before selecting the customer order.';
      return;
    }
    const p=inv.balanceMap.get(productId)||inv.balances.find(x=>String(x.product_id)===productId);
    select.innerHTML='<option value="">Loading customer orders...</option>';
    if(info)info.textContent='Finding open Customer Fulfillment items for this product...';
    const r=await db.rpc('get_inventory_fulfillment_queue',{p_search:p?.code||null});
    if(r.error){
      select.innerHTML='<option value="">Could not load customer orders</option>';
      if(info)info.textContent=r.error.message||'Could not load Customer Fulfillment.';
      return;
    }
    const rows=(r.data||[]).filter(x=>String(x.product_id)===productId&&n(x.remaining_qty)>0);
    window._stockOutFulfillmentRows=rows;
    if(!rows.length){
      select.innerHTML='<option value="">No open Customer Fulfillment item for this product</option>';
      if(info)info.textContent='No active Sales Order item is waiting for this product.';
      return;
    }
    select.innerHTML='<option value="">Select customer / order / item</option>'+rows.map(x=>{
      const arrived=stockOutArrivedQty(x);
      const ready=!!x.inventory_tracking_enabled&&arrived>0;
      const reason=!x.inventory_tracking_enabled?' · Not linked to Stock':arrived<=0?' · Not Arrived yet':'';
      return `<option value="${esc(x.sales_order_item_id)}" ${ready?'':'disabled'}>${esc(x.document_no||'Sales Order')} · ${esc(x.customer_name||'Customer')} · Remaining ${q(x.remaining_qty)} · Arrived ${q(arrived)}${esc(reason)}</option>`;
    }).join('');
    if(info)info.innerHTML='<b>Customer Delivery requires a live fulfillment item.</b> Items not linked to Stock or not yet Arrived are shown but cannot be selected.';
  };

  window.stockOutPurposeChanged=function(){
    const type=document.getElementById('smType')?.value||'';
    const purpose=document.getElementById('smOutPurpose')?.value||'';
    const customerWrap=document.getElementById('smCustomerDeliveryWrap');
    const show=type==='out'&&purpose==='customer_delivery';
    if(customerWrap)customerWrap.classList.toggle('hidden',!show);
    if(!show){
      const doWrap=document.getElementById('smDoWrap');if(doWrap)doWrap.classList.add('hidden');
      window._stockOutFulfillmentRows=[];window._stockOutDoRows=[];
    }else{
      window.refreshStockOutCustomerOptions();
    }
  };

  window.stockOutFulfillmentChanged=async function(){
    const id=String(document.getElementById('smSalesFulfillmentItem')?.value||'');
    const row=(window._stockOutFulfillmentRows||[]).find(x=>String(x.sales_order_item_id)===id);
    const info=document.getElementById('smSalesFulfillmentInfo');
    const doWrap=document.getElementById('smDoWrap');
    const doSelect=document.getElementById('smDeliveryRequestItem');
    const doInfo=document.getElementById('smDoInfo');
    window._stockOutDoRows=[];
    if(doWrap)doWrap.classList.add('hidden');
    if(doSelect)doSelect.innerHTML='<option value="">No DO linked</option>';
    if(!row){
      if(info)info.textContent='Select the customer order/item this Stock OUT is for.';
      return;
    }
    const arrived=stockOutArrivedQty(row);
    const maxQty=Math.min(n(row.remaining_qty),arrived);
    const qtyEl=document.getElementById('smQty');
    if(qtyEl){
      qtyEl.max=String(maxQty);
      if(n(qtyEl.value)>maxQty)qtyEl.value=String(maxQty);
    }
    const ref=document.getElementById('smRef'),refType=document.getElementById('smReferenceType'),refId=document.getElementById('smReferenceId'),party=document.getElementById('smParty');
    if(ref)ref.value=row.document_no||'';
    if(refType)refType.value='sales_order';
    if(refId)refId.value=row.sales_order_id||'';
    if(party)party.value=row.customer_name||'';
    if(info)info.innerHTML=`<b>${esc(row.customer_name||'Customer')}</b> · ${esc(row.document_no||'Sales Order')} · Remaining <b>${q(row.remaining_qty)}</b> · Arrived <b>${q(arrived)}</b> · Maximum OUT now <b>${q(maxQty)}</b>`;

    const dr=await db.rpc('get_inventory_do_requests',{p_search:row.document_no||row.customer_name||null});
    if(dr.error){
      if(doInfo)doInfo.textContent='Could not check Delivery Order requests: '+(dr.error.message||'Unknown error');
      return;
    }
    const choices=[];
    (dr.data||[]).forEach(req=>{
      stockOutDoItems(req).forEach(item=>{
        if(String(item.sales_order_item_id)===id&&n(item.remaining_qty)>0){
          choices.push({
            delivery_request_id:req.delivery_request_id,
            delivery_request_item_id:item.delivery_request_item_id,
            do_no:req.do_no||'',
            request_status:req.request_status||'',
            remaining_qty:n(item.remaining_qty),
            requested_delivery_date:req.requested_delivery_date||''
          });
        }
      });
    });
    window._stockOutDoRows=choices;
    if(!choices.length)return;
    if(doWrap)doWrap.classList.remove('hidden');
    if(doSelect){
      doSelect.innerHTML='<option value="">Select Delivery Order</option>'+choices.map(x=>`<option value="${esc(x.delivery_request_item_id)}" ${x.do_no?'':'disabled'}>${x.do_no?'DO '+esc(x.do_no):'DO request — number not assigned'} · Remaining ${q(x.remaining_qty)}</option>`).join('');
      const first=choices.find(x=>x.do_no);
      if(first)doSelect.value=first.delivery_request_item_id;
    }
    const assigned=choices.filter(x=>x.do_no);
    if(doInfo)doInfo.innerHTML=assigned.length
      ?'<b>Delivery Order found.</b> The official DO is selected automatically. The approved OUT will be recorded against that DO.'
      :'<b>A Delivery Order request exists, but no official DO number is assigned yet.</b> Assign the DO number before Stock OUT.';
  };

  window.openLinkExistingStockOutToFulfillment=async function(movementId){
    if(!canReconcile())return showToast('Inventory reconciliation permission required.','err');
    try{
      const mr=await db.from('stock_movements').select('id,movement_date,product_id,movement_type,qty,from_location_id,reference_no,counterparty,note,affects_balance,reference_item_id,delivery_request_item_id').eq('id',movementId).maybeSingle();
      if(mr.error)throw mr.error;
      const m=mr.data;
      if(!m||m.movement_type!=='out'||!m.affects_balance)return showToast('Only a posted generic Stock OUT can be linked.','err');
      if(m.reference_item_id||m.delivery_request_item_id)return showToast('This Stock OUT is already linked to fulfillment.','err');

      const pr=await db.from('product_catalog').select('id,code,item_name,image_url').eq('id',m.product_id).maybeSingle();
      if(pr.error)throw pr.error;
      const product=pr.data||{};

      const qr=await db.rpc('get_stock_out_fulfillment_candidates',{
        p_product_id:m.product_id,
        p_reference_no:m.reference_no||null,
        p_counterparty:m.counterparty||null
      });
      if(qr.error)throw qr.error;

      const rows=qr.data||[];
      const selectable=rows.filter(x=>n(x.remaining_qty)+0.0001>=n(m.qty));
      const exact=rows.filter(x=>!!x.exact_reference);
      const customerMatches=rows.filter(x=>!!x.customer_match);
      window._linkExistingOutRows=rows;
      window._linkExistingOutMovement=m;
      window._linkExistingOutDoRows=[];

      let matchMessage='';
      if(selectable.length){
        const strongest=selectable.find(x=>x.exact_reference)||selectable.find(x=>x.customer_match)||null;
        matchMessage=strongest
          ?'<div class="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"><b>Possible match found.</b> Check the customer, document number and remaining quantity before linking.</div>'
          :'<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>No exact reference/customer match was found.</b> Same-product open Sales Orders are shown below for manual review.</div>';
      }else if(rows.length){
        matchMessage='<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>No selectable fulfillment item is currently available for this OUT.</b> Same-product Sales Orders exist, but they are already fulfilled or do not have enough remaining quantity. The Stock OUT has not been changed.</div>';
      }else{
        matchMessage='<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"><b>No Sales Order item for this product exists in the app database.</b> This OUT cannot be linked until its matching Sales Order is created/imported into Sales Tracking. The Stock OUT has not been changed.</div>';
      }

      const refLine=[m.reference_no?'<b>Reference:</b> '+esc(m.reference_no):'',m.counterparty?'<b>Customer:</b> '+esc(m.counterparty):''].filter(Boolean).join(' &nbsp; · &nbsp; ');
      const missingRef=m.reference_no&&!exact.length
        ?'<div class="mt-2 text-[10px] text-red-700"><b>'+esc(m.reference_no)+'</b> is not present as a Sales Order reference in the app database for this product.</div>'
        :'';
      const customerHint=m.counterparty&&!customerMatches.length
        ?'<div class="mt-1 text-[10px] text-amber-800">No same-product Sales Order currently matches customer <b>'+esc(m.counterparty)+'</b>.</div>'
        :'';

      openModal('Link Existing Stock OUT to Customer Fulfillment',`<form id="linkExistingOutForm" class="space-y-4">
        <div class="rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-800"><b>No stock will be deducted again.</b> This only changes the existing OUT from a generic Stock OUT to a Customer Delivery and connects it to the selected Sales Order item.</div>
        <div class="rounded-xl border bg-[#fcfbf8] p-4 flex gap-3 items-center">
          <div class="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0">${product.image_url?`<img src="${esc(product.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div>
          <div class="min-w-0 flex-1"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(product.code||'')}</div><div class="font-semibold">${esc(product.item_name||'')}</div><div class="text-xs text-gray-500 mt-1">Existing OUT Qty <b>${q(m.qty)}</b> · ${esc(dateText(m.movement_date))}</div>${refLine?`<div class="text-[10px] text-gray-500 mt-2">${refLine}</div>`:''}</div>
        </div>
        ${matchMessage}
        <div>
          <label class="text-xs font-semibold">Customer / Sales Order Item *</label>
          <select id="linkExistingOutSalesItem" onchange="linkExistingOutSalesItemChanged()" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">
            <option value="">Select matching customer order</option>
            ${rows.map(x=>{
              const enough=n(x.remaining_qty)+0.0001>=n(m.qty);
              const tags=[x.exact_reference?'Exact reference':'',x.customer_match?'Customer match':''].filter(Boolean).join(' · ');
              const state=enough?'Remaining '+q(x.remaining_qty):'Unavailable · Remaining '+q(x.remaining_qty);
              return `<option value="${esc(x.sales_order_item_id)}" ${enough?'':'disabled'}>${esc(x.document_no||'Sales Order')} · ${esc(x.customer_name||'Customer')} · ${esc(state)}${tags?' · '+esc(tags):''}</option>`;
            }).join('')}
          </select>
          <div id="linkExistingOutSalesInfo" class="text-[10px] text-gray-500 mt-1">
            ${selectable.length?'Choose the exact order/item this OUT was delivered for. Disabled rows are already fulfilled or do not have enough remaining quantity.':'There is currently no valid Sales Order item that can receive this OUT.'}
            ${missingRef}${customerHint}
          </div>
        </div>
        <div id="linkExistingOutDoWrap" class="hidden"><label class="text-xs font-semibold">Delivery Order</label><select id="linkExistingOutDoItem" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"></select><div id="linkExistingOutDoInfo" class="text-[10px] text-gray-400 mt-1"></div></div>
        <div><label class="text-xs font-semibold">Audit Note</label><textarea id="linkExistingOutNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional note about why this OUT is being linked now"></textarea></div>
        <button id="linkExistingOutSave" ${selectable.length?'':'disabled'} class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold disabled:opacity-40">Link to Customer Fulfillment — No Stock Deduction</button>
      </form>`);

      const strongest=selectable.find(x=>x.exact_reference)||selectable.find(x=>x.customer_match);
      if(strongest){
        const sel=document.getElementById('linkExistingOutSalesItem');
        if(sel){sel.value=strongest.sales_order_item_id;setTimeout(()=>window.linkExistingOutSalesItemChanged(),0)}
      }

      document.getElementById('linkExistingOutForm').onsubmit=async e=>{
        e.preventDefault();
        const itemId=document.getElementById('linkExistingOutSalesItem')?.value||'';
        if(!itemId)return showToast('Select the Customer Fulfillment item.','err');
        const chosen=(window._linkExistingOutRows||[]).find(x=>String(x.sales_order_item_id)===String(itemId));
        if(!chosen||n(chosen.remaining_qty)+0.0001<n(m.qty))return showToast('That Sales Order item does not have enough remaining fulfillment quantity.','err');
        const doRows=window._linkExistingOutDoRows||[];
        const doItem=document.getElementById('linkExistingOutDoItem')?.value||'';
        if(doRows.length&&!doItem)return showToast('This item has a Delivery Order request. Assign/select its official DO number first.','err');
        const btn=document.getElementById('linkExistingOutSave');btn.disabled=true;btn.textContent='Linking...';
        const rr=await db.rpc('link_existing_stock_out_to_fulfillment',{
          p_movement_id:movementId,
          p_sales_order_item_id:itemId,
          p_delivery_request_item_id:doItem||null,
          p_note:document.getElementById('linkExistingOutNote')?.value.trim()||null
        });
        if(rr.error){btn.disabled=false;btn.textContent='Link to Customer Fulfillment — No Stock Deduction';return showToast(rr.error.message,'err')}
        closeModal();
        showToast('Existing Stock OUT linked to Customer Fulfillment. Stock was not deducted again.');
        invalidateInventoryTasks();inv.locations=[];inv.balances=[];
        await renderStockInventory();
      };
    }catch(err){showToast(err.message||'Could not open fulfillment linking.','err')}
  };

  window.linkExistingOutSalesItemChanged=async function(){
    const id=document.getElementById('linkExistingOutSalesItem')?.value||'';
    const row=(window._linkExistingOutRows||[]).find(x=>String(x.sales_order_item_id)===String(id));
    const info=document.getElementById('linkExistingOutSalesInfo');
    const wrap=document.getElementById('linkExistingOutDoWrap');
    const sel=document.getElementById('linkExistingOutDoItem');
    const doInfo=document.getElementById('linkExistingOutDoInfo');
    window._linkExistingOutDoRows=[];
    if(wrap)wrap.classList.add('hidden');
    if(!row){if(info)info.textContent='Choose the exact order/item this OUT was delivered for.';return}
    if(info)info.innerHTML=`<b>${esc(row.customer_name||'Customer')}</b> · ${esc(row.document_no||'Sales Order')} · Remaining <b>${q(row.remaining_qty)}</b>`;
    const dr=await db.rpc('get_inventory_do_requests',{p_search:row.document_no||row.customer_name||null});
    if(dr.error)return;
    const choices=[];
    (dr.data||[]).forEach(req=>stockOutDoItems(req).forEach(item=>{
      if(String(item.sales_order_item_id)===String(id)&&n(item.remaining_qty)>0){
        choices.push({delivery_request_item_id:item.delivery_request_item_id,do_no:req.do_no||'',remaining_qty:n(item.remaining_qty)});
      }
    }));
    window._linkExistingOutDoRows=choices;
    if(!choices.length)return;
    if(wrap)wrap.classList.remove('hidden');
    if(sel){
      sel.innerHTML='<option value="">Select Delivery Order</option>'+choices.map(x=>`<option value="${esc(x.delivery_request_item_id)}" ${x.do_no?'':'disabled'}>${x.do_no?'DO '+esc(x.do_no):'DO request — number not assigned'} · Remaining ${q(x.remaining_qty)}</option>`).join('');
      const first=choices.find(x=>x.do_no&&n(x.remaining_qty)+0.0001>=n(window._linkExistingOutMovement?.qty));
      if(first)sel.value=first.delivery_request_item_id;
    }
    if(doInfo)doInfo.innerHTML=choices.some(x=>x.do_no)?'<b>Delivery Order found.</b> It will be linked with this existing OUT.':'<b>DO request exists but has no official DO number yet.</b> Assign it before linking.';
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
      <div><label class="text-xs font-semibold">Product / Code *</label><div class="relative"><input id="smProduct" autocomplete="off" required onfocus="showStockProductSuggestions(this)" oninput="stockProductInputChanged(this)" onblur="setTimeout(()=>document.getElementById('smProductSuggestions')?.classList.add('hidden'),150)" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white" placeholder="Type product code or item name..."><input id="smProductId" type="hidden"><div id="smProductSuggestions" class="hidden absolute z-[140] left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl"></div></div><div id="smProductInfo"></div></div>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Movement Type</label><select id="smType" onchange="stockMovementTypeChanged()" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">
          ${[['in','Stock In'],['out','Stock Out'],['return','Customer Return'],['broken','Broken / Damaged'],['transfer','Transfer Location'],['adjustment_in','Adjustment +'],['adjustment_out','Adjustment −']].map(([v,l])=>`<option value="${v}" ${v===defaultType?'selected':''}>${l}</option>`).join('')}
        </select></div>
        <div><label class="text-xs font-semibold">Quantity *</label><input id="smQty" type="number" min="1" step="1" value="1" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div id="smOutPurposeWrap" class="hidden md:col-span-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <label class="text-xs font-semibold">Stock OUT Purpose *</label>
          <select id="smOutPurpose" onchange="stockOutPurposeChanged()" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">
            <option value="">Choose why this stock is leaving...</option>
            <option value="customer_delivery">Customer Delivery</option>
            <option value="internal_use">Internal Use</option>
            <option value="other">Other / Manual OUT</option>
          </select>
          <div class="text-[10px] text-amber-800 mt-1"><b>Customer Delivery</b> must be linked to the actual customer Sales Order item so approval updates Customer Fulfillment automatically.</div>
        </div>
        <div id="smCustomerDeliveryWrap" class="hidden md:col-span-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
          <label class="text-xs font-semibold">Customer / Sales Order Item *</label>
          <select id="smSalesFulfillmentItem" onchange="stockOutFulfillmentChanged()" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Choose a product first</option></select>
          <div id="smSalesFulfillmentInfo" class="text-[10px] text-gray-500 mt-1">Select the exact Customer Fulfillment item this Stock OUT is for.</div>
          <div id="smDoWrap" class="hidden mt-3">
            <label class="text-xs font-semibold">Delivery Order</label>
            <select id="smDeliveryRequestItem" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"></select>
            <div id="smDoInfo" class="text-[10px] text-gray-500 mt-1"></div>
          </div>
        </div>
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
      if(!p)return showToast('Choose a Product / Code from the suggestion list.','err');
      const qty=stockWholeQtyInput('smQty',false,'Quantity');if(qty==null)return;
      const movementType=document.getElementById('smType').value;
      const outPurpose=movementType==='out'?String(document.getElementById('smOutPurpose')?.value||''):'';
      if(movementType==='out'&&!outPurpose)return showToast('Choose the Stock OUT purpose first.','err');
      const btn=document.getElementById('smSave');

      if(movementType==='out'&&outPurpose==='customer_delivery'){
        const itemId=String(document.getElementById('smSalesFulfillmentItem')?.value||'');
        const row=(window._stockOutFulfillmentRows||[]).find(x=>String(x.sales_order_item_id)===itemId);
        if(!row)return showToast('Select the exact Customer Fulfillment item.','err');
        const arrived=stockOutArrivedQty(row);
        const maxQty=Math.min(n(row.remaining_qty),arrived);
        if(qty>maxQty)return showToast('Customer Delivery OUT cannot exceed '+q(maxQty)+' currently Arrived / remaining.','err');
        const loc=String(document.getElementById('smFrom')?.value||'');
        if(!loc)return showToast('Source location is required.','err');
        const doRows=window._stockOutDoRows||[];
        const doItem=String(document.getElementById('smDeliveryRequestItem')?.value||'');
        if(doRows.length&&!doItem)return showToast('This item has a Delivery Order request. Assign/select the official DO number before Stock OUT.','err');
        btn.disabled=true;btn.textContent='Saving Customer Delivery...';
        const note=document.getElementById('smNote').value.trim()||null;
        const deliveryDate=document.getElementById('smDate').value||null;
        const r=doItem
          ?await db.rpc('release_sales_stock_do',{p_delivery_request_item_id:doItem,p_qty:qty,p_location_id:loc,p_delivery_date:deliveryDate,p_note:note})
          :await db.rpc('release_sales_stock',{p_sales_order_item_id:itemId,p_qty:qty,p_location_id:loc,p_delivery_date:deliveryDate,p_note:note});
        if(r.error){btn.disabled=false;btn.textContent='Save Stock Movement';return showToast(r.error.message,'err')}
        closeModal();showToast(doItem?'Customer Delivery Stock OUT saved and linked to the DO.':'Customer Delivery Stock OUT saved and Customer Fulfillment updated.');
        invalidateInventoryTasks();inv.locations=[];inv.balances=[];await renderStockInventory();return;
      }

      btn.disabled=true;btn.textContent='Saving...';
      const purposeNote=movementType==='out'&&outPurpose
        ?(outPurpose==='internal_use'?'Purpose: Internal Use':'Purpose: Other / Manual OUT')
        :'';
      const rawNote=document.getElementById('smNote').value.trim();
      const args={
        p_product_id:p.product_id,p_movement_type:movementType,
        p_qty:qty,
        p_from_location_id:document.getElementById('smFrom').value||null,
        p_to_location_id:document.getElementById('smTo').value||null,
        p_movement_date:document.getElementById('smDate').value||null,
        p_reference_type:document.getElementById('smReferenceType').value||'manual',
        p_reference_id:document.getElementById('smReferenceId').value||null,
        p_reference_item_id:null,
        p_reference_no:document.getElementById('smRef').value.trim()||null,
        p_counterparty:document.getElementById('smParty').value.trim()||null,
        p_note:[purposeNote,rawNote].filter(Boolean).join(' · ')||null
      };
      const r=await db.rpc('create_stock_movement',args);
      if(r.error){btn.disabled=false;btn.textContent='Save Stock Movement';return showToast(r.error.message,'err')}
      closeModal();showToast('Stock movement saved.');invalidateInventoryTasks();inv.locations=[];inv.balances=[];await renderStockInventory();
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
    const purposeWrap=document.getElementById('smOutPurposeWrap');
    const purpose=document.getElementById('smOutPurpose');
    const isOut=type==='out';
    if(purposeWrap)purposeWrap.classList.toggle('hidden',!isOut);
    if(purpose){
      purpose.required=isOut;
      if(!isOut)purpose.value='';
    }
    if(typeof window.stockOutPurposeChanged==='function')window.stockOutPurposeChanged();
  };
  window.openStockTransfer=function(productId=null){return openStockMovement('transfer',productId)};

  // Replace the old direct Product stock editor. All adjustments now go through the audited ledger.
  window.openAdjustStock=function(productId){
    if(!canOperate())return showToast('Stock Controller or Admin access required.','err');
    return openStockMovement('adjustment_in',productId);
  };

  window.openProductStockCard=async function(productId){
    await loadCore();
    const p=inv.balanceMap.get(productId);
    if(!p)return showToast('Product stock record not found.','err');
    openModal('Product Stock Card — '+(p.code||'Product'),'<div class="py-12 text-center text-sm text-gray-400">Loading product stock card...</div>');

    const orderedPromise=role()==='accountant'
      ?Promise.resolve({data:[],error:null})
      :db.rpc('get_sales_po_ordered_items');

    const [historyRes,receiveRes,orderedRes]=await Promise.all([
      db.from('inventory_movement_history').select('*').eq('product_id',productId).order('movement_date',{ascending:false}).order('created_at',{ascending:false}).limit(30),
      db.rpc('get_inventory_po_receiving_queue',{p_search:p.code||null}),
      orderedPromise
    ]);
    if(historyRes.error){document.getElementById('modalBody').innerHTML=`<div class="text-red-600">${esc(historyRes.error.message)}</div>`;return}

    const history=historyRes.data||[];
    const arrivedPending=(receiveRes.data||[]).filter(x=>String(x.product_id)===String(productId));
    const ordered=(orderedRes.data||[]).filter(x=>String(x.product_id)===String(productId));
    const a=inv.agingMap.get(productId);
    const locs=(p.locations||[]).filter(x=>n(x.qty)!==0);
    const customerAllocations=[];
    ordered.forEach(x=>(Array.isArray(x.allocations)?x.allocations:[]).forEach(y=>customerAllocations.push({...y,po_number:x.po_number||x.po_pending_reference||'PO'})));

    document.getElementById('modalBody').innerHTML=`<div class="space-y-4">
      <div class="rounded-2xl border bg-[#fcfbf8] p-4 flex flex-col md:flex-row md:items-center gap-4">
        <div class="w-24 h-24 rounded-2xl overflow-hidden border bg-white shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-xs text-gray-400">No Photo</div>'}</div>
        <div class="min-w-0 flex-1"><div class="text-xs font-bold text-[#a77d1a]">${esc(p.code||'')}${taxBadge(p)}</div><h3 class="text-xl font-bold mt-1">${esc(p.item_name||'')}</h3><div class="text-xs text-gray-500 mt-1">${[p.brand,p.class].filter(Boolean).map(esc).join(' · ')}</div><div class="mt-3 flex flex-wrap gap-2">${locs.map(l=>`<span class="px-2.5 py-1.5 rounded-lg border bg-white text-xs"><b>${esc(l.code)}</b> ${q(l.qty)}</span>`).join('')||'<span class="text-xs text-gray-400">No live stock location.</span>'}</div></div>
        <div class="flex md:flex-col gap-2">${p.tax_item?`<button onclick="openTaxDeclaredSet('${productId}')" class="px-3 py-2 border border-amber-200 bg-amber-50 text-amber-800 rounded-xl text-xs font-semibold">Declared Set</button>`:''}${canOperate()?`<button onclick="openStockTransfer('${productId}')" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">Move</button><button onclick="openStockMovement('out','${productId}')" class="px-3 py-2 border border-red-200 bg-red-50 text-red-700 rounded-xl text-xs font-semibold">Stock OUT</button><button onclick="openStockMovement('return','${productId}')" class="px-3 py-2 border border-green-200 bg-green-50 text-green-700 rounded-xl text-xs font-semibold">Return</button>`:''}</div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">On Hand</div><b class="text-xl">${q(p.on_hand)}</b></div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Reserved</div>${n(p.reserved)>0?`<button onclick="openReservedStockDetails('${p.product_id}')" class="text-xl font-bold text-amber-600 hover:underline" title="View Sales Orders reserving this stock">${q(p.reserved)}</button>`:`<b class="text-xl text-amber-600">${q(p.reserved)}</b>`}</div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Available</div><b class="text-xl text-green-600">${q(p.available)}</b></div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">On Order</div><b class="text-xl text-amber-700">${q(p.on_order)}</b></div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Incoming</div><b class="text-xl text-blue-600">${q(p.incoming)}</b><div class="text-[8px] text-gray-400 mt-1">Shipping</div></div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Arrived Pending</div><b class="text-xl text-purple-600">${q(p.arrived_pending_receive)}</b></div>
        <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Aging</div><span class="inline-flex mt-1 px-2 py-1 rounded-lg border text-[9px] font-bold ${ageBadgeClass(a?.age_bucket||'Unknown')}">${esc(ageLabel(a))}</span>${a?.oldest_remaining_date?`<div class="text-[9px] text-gray-400 mt-1">Since ${esc(dateText(a.oldest_remaining_date))}</div>`:''}</div>
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <div class="rounded-xl border p-4">
          <div class="flex items-center justify-between mb-2"><div><h4 class="font-bold">Arrived · Pending Receive</h4><div class="text-[10px] text-gray-400">Only PO quantities marked Arrived and still waiting for warehouse receipt.</div></div><span class="text-xs font-bold text-purple-600">${arrivedPending.reduce((s,x)=>s+n(x.remaining_qty),0).toLocaleString()} pcs</span></div>
          <div class="divide-y">${arrivedPending.length?arrivedPending.slice(0,10).map(x=>`<div class="py-2 flex justify-between gap-3 text-xs"><div><b>${esc(x.po_number||'PO')}</b><div class="text-[10px] text-gray-400">${esc(x.vendor_name||'')} · ETA ${esc(dateText(x.eta))}</div></div><div class="text-right"><b class="text-purple-600">${q(x.remaining_qty)}</b><div class="text-[9px] text-gray-400">pending receive</div></div></div>`).join(''):'<div class="py-6 text-center text-xs text-gray-400">Nothing has arrived waiting for receipt.</div>'}</div>
        </div>
        <div class="rounded-xl border p-4">
          <div class="flex items-center justify-between mb-2"><div><h4 class="font-bold">Customer Allocation</h4><div class="text-[10px] text-gray-400">Supplier PO quantities already allocated to customers.</div></div><span class="text-xs font-bold text-amber-700">${customerAllocations.reduce((s,x)=>s+n(x.qty_allocated),0).toLocaleString()} pcs</span></div>
          <div class="divide-y">${customerAllocations.length?customerAllocations.slice(0,12).map(x=>`<div class="py-2 flex justify-between gap-3 text-xs"><div class="min-w-0"><b class="truncate block">${esc(x.customer_name||'Customer')}</b><div class="text-[10px] text-gray-400 truncate">${esc(x.order_ref||'Sales Order')} · ${esc(x.po_number||'PO')}${x.sales_rep_name?' · '+esc(x.sales_rep_name):''}</div></div><b class="shrink-0">${q(x.qty_allocated)}</b></div>`).join(''):'<div class="py-6 text-center text-xs text-gray-400">No customer allocation for incoming PO quantities.</div>'}</div>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between gap-3 mb-2"><div><h4 class="font-bold">Recent Movement History</h4><div class="text-[10px] text-gray-400">Latest 30 ledger movements for this product.</div></div><button onclick="openProductInMovements('${esc(p.code||'')}')" class="text-xs font-semibold text-[#a77d1a]">Open in Movements →</button></div>
        <div class="divide-y border rounded-xl px-4 max-h-[42vh] overflow-auto">${history.length?history.map(m=>movementRow(m)).join(''):'<div class="py-8 text-center text-xs text-gray-400">No history.</div>'}</div>
      </div>
    </div>`;
  };
  window.openProductStockHistory=window.openProductStockCard;
  window.openProductInMovements=function(code){
    closeModal();inv.tab='movements';inv.search=String(code||'');resetInventoryLimit('movements');renderStockInventory();
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
      closeModal();showToast('PO stock received.');invalidateInventoryTasks();inv.locations=[];inv.balances=[];await renderStockInventory();
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
    if(typeof window.openStockFulfillmentRelease==='function'){
      return window.openStockFulfillmentRelease(itemId);
    }
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
      closeModal();showToast('Customer stock released.');invalidateInventoryTasks();inv.locations=[];inv.balances=[];await renderStockInventory();
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

  window.stockCountVarianceOnly=false;

  function stockCountProductType(value){
    const raw=String(value||'').trim();
    if(!raw)return 'Uncategorized';
    const styleWords=new Set(['classic','modern','neo-classic','contemporary','crystal','cast','glass','brass','ceramic']);
    const parts=raw.split(',').map(x=>x.trim()).filter(Boolean);
    const type=parts.find(x=>!styleWords.has(x.toLowerCase()))||parts[0]||'Uncategorized';
    return type||'Uncategorized';
  }

  window.updateStockCountProgress=function(){
    const rows=[...document.querySelectorAll('.stock-count-row')];
    if(!rows.length)return;
    const counted=rows.filter(row=>String(row.querySelector('.count-physical')?.value||'').trim()!=='').length;
    const variance=rows.filter(row=>row.dataset.variance==='1').length;
    const pct=rows.length?Math.round(counted*100/rows.length):0;
    const textEl=document.getElementById('stockCountProgressText');
    const fill=document.getElementById('stockCountProgressFill');
    const varEl=document.getElementById('stockCountVarianceCount');
    if(textEl)textEl.textContent=counted+' / '+rows.length+' counted · '+pct+'%';
    if(fill)fill.style.width=pct+'%';
    if(varEl)varEl.textContent=variance+' variance'+(variance===1?'':'s');
  };
  window.filterStockCountRows=function(){
    const qv=String(document.getElementById('stockCountSearch')?.value||'').trim().toLowerCase();
    const type=String(document.getElementById('stockCountTypeFilter')?.value||'');
    document.querySelectorAll('.stock-count-row').forEach(row=>{
      const searchOk=!qv||String(row.dataset.search||'').includes(qv);
      const varianceOk=!window.stockCountVarianceOnly||row.dataset.variance==='1';
      const typeOk=!type||String(row.dataset.productType||'')===type;
      row.classList.toggle('hidden',!(searchOk&&varianceOk&&typeOk));
    });
    document.querySelectorAll('.stock-count-group-header').forEach(header=>{
      const group=String(header.dataset.productType||'');
      const visible=[...document.querySelectorAll('.stock-count-row')].some(row=>String(row.dataset.productType||'')===group&&!row.classList.contains('hidden'));
      header.classList.toggle('hidden',!visible);
    });
    updateStockCountProgress();
  };
  window.toggleStockCountVarianceOnly=function(){
    window.stockCountVarianceOnly=!window.stockCountVarianceOnly;
    const btn=document.getElementById('stockCountVarianceBtn');
    if(btn){
      btn.textContent=window.stockCountVarianceOnly?'Show All Items':'Show Variance Only';
      btn.classList.toggle('bg-red-50',window.stockCountVarianceOnly);
      btn.classList.toggle('text-red-700',window.stockCountVarianceOnly);
      btn.classList.toggle('border-red-200',window.stockCountVarianceOnly);
    }
    filterStockCountRows();
  };
  window.focusNextStockCountUncounted=function(afterItemId=''){
    const rows=[...document.querySelectorAll('.stock-count-row')];
    if(!rows.length)return;
    let start=afterItemId?rows.findIndex(r=>r.dataset.countItem===String(afterItemId)):-1;
    for(let offset=1;offset<=rows.length;offset++){
      const row=rows[(start+offset+rows.length)%rows.length];
      const input=row.querySelector('.count-physical');
      if(input&&!input.disabled&&String(input.value||'').trim()===''){
        if(row.classList.contains('hidden')){
          const search=document.getElementById('stockCountSearch');if(search)search.value='';
          const type=document.getElementById('stockCountTypeFilter');if(type)type.value='';
          window.stockCountVarianceOnly=false;
          const btn=document.getElementById('stockCountVarianceBtn');if(btn){btn.textContent='Show Variance Only';btn.classList.remove('bg-red-50','text-red-700','border-red-200')}
          filterStockCountRows();
        }
        row.scrollIntoView({behavior:'smooth',block:'center'});
        setTimeout(()=>{input.focus();input.select()},180);
        return;
      }
    }
    showToast('All visible items have a Physical Qty.');
  };
  window.stockCountPhysicalKeydown=function(event,itemId){
    if(event.key!=='Enter')return;
    event.preventDefault();
    saveStockCountRow(itemId,true);
  };

  window.saveStockCountRow=async function(itemId,moveNext=false){
    const row=document.querySelector(`[data-count-item="${itemId}"]`);if(!row)return;
    const physical=row.querySelector('.count-physical').value.trim();
    const qb=row.querySelector('.count-qb').value.trim();
    if(physical!==''&&(!Number.isInteger(Number(physical))||Number(physical)<0))return showToast('Physical Qty must be a whole number: 0, 1, 2, 3...','err');
    if(qb!==''&&(!Number.isInteger(Number(qb))||Number(qb)<0))return showToast('QB Qty must be a whole number: 0, 1, 2, 3...','err');
    const note=row.querySelector('.count-note').value.trim()||null;
    const r=await db.rpc('save_stock_count_item',{p_item_id:itemId,p_physical_qty:physical===''?null:Number(physical),p_qb_qty:qb===''?null:Number(qb),p_note:note});
    if(r.error)return showToast(r.error.message,'err');
    const system=n(row.dataset.system),p=physical===''?null:n(physical),qv=qb===''?null:n(qb);
    const variance=p!=null&&p!==system;
    row.dataset.variance=variance?'1':'0';
    row.classList.toggle('bg-red-50/40',variance);
    const varCell=row.querySelector('.count-var');
    if(varCell){varCell.textContent=p==null?'-':q(p-system);varCell.classList.toggle('text-red-600',variance)}
    row.querySelector('.count-qbvar').textContent=qv==null?'-':q(qv-system);
    updateStockCountProgress();filterStockCountRows();
    showToast('Count row saved.');
    if(moveNext&&p!=null)setTimeout(()=>focusNextStockCountUncounted(itemId),80);
  };

  window.setStockCountPhysicalZero=async function(itemId){
    const row=document.querySelector('[data-count-item="'+itemId+'"]');
    if(!row)return;
    const input=row.querySelector('.count-physical');
    if(!input||input.disabled)return;
    input.value='0';
    await saveStockCountRow(itemId,true);
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
      <div><label class="text-xs font-semibold">Product / Code</label><div class="relative"><input id="scAddProductSearch" autocomplete="off" oninput="showStockCountAddSuggestions(this,'${countId}')" onfocus="showStockCountAddSuggestions(this,'${countId}')" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Type product code or item name..."><div id="scAddProductSuggestions" class="absolute z-[150] left-0 right-0 top-full mt-1 max-h-80 overflow-y-auto bg-white border rounded-xl shadow-xl"></div></div></div>
      <div class="text-[10px] text-gray-400">After adding it, enter the Physical Qty and save it like the other count rows.</div>
    </div>`);
    setTimeout(()=>document.getElementById('scAddProductSearch')?.focus(),50);
  };

  window.showStockCountAddSuggestions=function(input,countId){
    const box=document.getElementById('scAddProductSuggestions');if(!box)return;
    const rows=stockProductMatches(input?.value||'');
    if(!rows.length){box.innerHTML='<div class="px-4 py-3 text-sm text-gray-400">No matching product</div>';return}
    box.innerHTML=rows.map(p=>`<button type="button" onclick="addStockCountProduct('${countId}','${p.product_id}')" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-0 flex gap-3 items-center"><div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(p.code||'')}${taxBadge(p)}</div><div class="text-sm font-semibold truncate">${esc(p.item_name||'')}</div><div class="text-[10px] text-gray-400">${esc(p.brand||'')} · Current total on hand ${q(p.on_hand)}</div></div></button>`).join('');
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
      db.from('stock_count_items').select('*,product_catalog(code,item_name,brand,class,image_url),stock_locations(code,name)').eq('stock_count_id',countId).order('updated_at').limit(2000)
    ]);
    if(c.error||items.error){document.getElementById('modalBody').innerHTML=`<div class="text-red-600">${esc((c.error||items.error).message)}</div>`;return}
    const count=c.data,rows=items.data||[],closed=count.status==='closed';
    const canEditCount=canAdmin()||(isStockController()&&count.status==='draft');
    const typedRows=rows.map(i=>({...i,_productType:stockCountProductType(i.product_catalog?.class)}));
    const typeCounts=new Map();
    typedRows.forEach(i=>typeCounts.set(i._productType,(typeCounts.get(i._productType)||0)+1));
    const productTypes=[...typeCounts.keys()].sort((a,b)=>a.localeCompare(b));
    const groupedRows=productTypes.map(type=>({
      type,
      rows:typedRows.filter(i=>i._productType===type).sort((a,b)=>String(a.product_catalog?.item_name||a.product_catalog?.code||'').localeCompare(String(b.product_catalog?.item_name||b.product_catalog?.code||'')))
    }));
    document.getElementById('modalBody').innerHTML=`<div class="space-y-4">
      <div class="rounded-xl border bg-gray-50 p-4 flex flex-wrap gap-4 justify-between"><div><div class="text-[9px] uppercase font-bold text-gray-400">Period</div><b>${esc(String(count.period_month).slice(0,7))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Location</div><b>${esc(count.stock_locations?.code||'All')}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Status</div><b>${esc(titleCase(count.status))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Items</div><b>${rows.length}</b></div></div>
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
        <div class="text-[10px] text-gray-500"><b>Physical Qty:</b> blank = not counted yet · <b>0</b> = counted and none physically found. Press <b>Enter</b> after a quantity to save and jump to the next uncounted item.</div>
        ${canEditCount&&count.status==='draft'?`<div class="flex flex-wrap gap-2"><button onclick="openAddStockCountItem('${count.id}')" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">+ Add Item</button><button onclick="fillStockCountBlanksZero('${count.id}')" class="px-3 py-2 border border-gray-200 bg-white rounded-xl text-xs font-semibold">Mark Remaining Blanks = 0</button></div>`:''}
      </div>
      <div class="rounded-xl border bg-[#fcfbf8] p-3">
        <div class="flex flex-col lg:flex-row lg:items-center gap-3">
          <input id="stockCountSearch" oninput="filterStockCountRows()" class="border rounded-xl px-3 py-2 text-xs flex-1" placeholder="Search Code, item name or brand...">
          <select id="stockCountTypeFilter" onchange="filterStockCountRows()" class="border rounded-xl px-3 py-2 text-xs bg-white lg:w-[190px]">
            <option value="">All Product Types (${rows.length})</option>
            ${productTypes.map(type=>`<option value="${esc(type)}">${esc(type)} (${typeCounts.get(type)||0})</option>`).join('')}
          </select>
          <div class="flex flex-wrap gap-2">
            <button onclick="focusNextStockCountUncounted()" class="px-3 py-2 border rounded-xl text-xs font-semibold bg-white">Next Uncounted</button>
            <button id="stockCountVarianceBtn" onclick="toggleStockCountVarianceOnly()" class="px-3 py-2 border rounded-xl text-xs font-semibold bg-white">Show Variance Only</button>
          </div>
        </div>
        <div class="mt-3 flex items-center gap-3"><div class="flex-1 inv-progress-track"><div id="stockCountProgressFill" class="inv-progress-fill" style="width:0%"></div></div><div id="stockCountProgressText" class="text-[10px] font-semibold text-gray-600 whitespace-nowrap">0 / ${rows.length} counted</div><div id="stockCountVarianceCount" class="text-[10px] text-red-600 whitespace-nowrap">0 variances</div></div>
      </div>
      <div class="max-h-[58vh] overflow-auto border rounded-xl">
        <div class="divide-y" style="min-width:1166px">
          <div class="sticky top-0 z-10 bg-gray-50 p-2 grid gap-2 text-[9px] uppercase font-bold text-gray-400" style="grid-template-columns:320px 90px 140px 110px 80px 80px 220px 70px">
            <div>Product</div><div>System</div><div>Physical</div><div>QB Qty</div><div>Var</div><div>QB Var</div><div>Note</div><div></div>
          </div>
          ${groupedRows.map(group=>`<div class="stock-count-group-header sticky top-[32px] z-[9] px-3 py-2 bg-[#f7f3e8] border-y border-[#eadfbe] text-[10px] font-bold text-[#8a6717] uppercase tracking-wide" data-product-type="${esc(group.type)}">${esc(group.type)} <span class="ml-1 text-[9px] font-semibold text-gray-500">(${group.rows.length} item${group.rows.length===1?'':'s'})</span></div>${group.rows.map(i=>`<div data-count-item="${i.id}" data-system="${n(i.system_qty)}" data-product-type="${esc(i._productType)}" data-search="${esc([i.product_catalog?.code,i.product_catalog?.item_name,i.product_catalog?.brand,i._productType,i.product_catalog?.class].filter(Boolean).join(' ').toLowerCase())}" data-variance="${i.physical_qty!=null&&n(i.physical_qty)!==n(i.system_qty)?'1':'0'}" class="stock-count-row p-2 grid gap-2 items-center text-xs ${i.physical_qty!=null&&n(i.physical_qty)!==n(i.system_qty)?'bg-red-50/40':''}" style="grid-template-columns:320px 90px 140px 110px 80px 80px 220px 70px"><div class="min-w-0 flex items-center gap-2.5"><div class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 border shrink-0">${i.product_catalog?.image_url?`<img src="${esc(i.product_catalog.image_url)}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden')"><div class="hidden w-full h-full items-center justify-center text-[7px] text-gray-400">No Photo</div>`:'<div class="w-full h-full flex items-center justify-center text-[7px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[9px] font-bold text-[#a77d1a] truncate">${esc(i.product_catalog?.code||'')}</div><div class="truncate">${esc(i.product_catalog?.item_name||'')}</div><div class="text-[8px] text-gray-400 truncate">${esc(i.product_catalog?.class||i._productType)}</div></div></div><b class="text-right pr-2">${q(i.system_qty)}</b><div class="flex items-center gap-1"><input class="count-physical min-w-0 w-full border rounded-lg px-2 py-1.5" type="number" min="0" step="1" value="${i.physical_qty==null?'':n(i.physical_qty)}" oninput="updateStockCountProgress();filterStockCountRows()" onkeydown="stockCountPhysicalKeydown(event,'${i.id}')" ${!canEditCount?'disabled':''}>${canEditCount?`<button type="button" onclick="setStockCountPhysicalZero('${i.id}')" class="shrink-0 w-7 h-7 rounded-lg border bg-gray-50 text-[9px] font-bold" title="Counted: zero physical stock">0</button>`:''}</div><input class="count-qb min-w-0 w-full border rounded-lg px-2 py-1.5" type="number" min="0" step="1" value="${i.qb_qty==null?'':n(i.qb_qty)}" ${!canEditCount?'disabled':''}><b class="count-var text-right pr-2 ${i.physical_qty!=null&&n(i.physical_qty)!==n(i.system_qty)?'text-red-600':''}">${i.physical_qty==null?'-':q(n(i.physical_qty)-n(i.system_qty))}</b><span class="count-qbvar text-right pr-2">${i.qb_qty==null?'-':q(n(i.qb_qty)-n(i.system_qty))}</span><input class="count-note min-w-0 w-full border rounded-lg px-2 py-1.5" value="${esc(i.note||'')}" ${!canEditCount?'disabled':''}><button onclick="saveStockCountRow('${i.id}',true)" class="px-2 py-1.5 border rounded-lg text-[9px] font-semibold ${!canEditCount?'hidden':''}">Save</button></div>`).join('')}`).join('')}
        </div>
      </div>
      <div class="flex flex-wrap gap-2 justify-end">
        ${!closed&&count.status==='draft'&&(isStockController()||canAdmin())?`<button onclick="submitStockCount('${count.id}')" class="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">Submit Count</button>`:''}
        ${!closed&&canReconcile()&&['submitted','reconciled'].includes(count.status)?`<button onclick="closeStockCountNow('${count.id}')" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Close & Apply Variances</button>`:''}
        ${closed&&canAdmin()?`<button onclick="reopenStockCountAdmin('${count.id}')" class="px-4 py-2 border border-amber-200 bg-amber-50 text-amber-700 rounded-xl text-xs font-semibold">Reopen Count</button>`:''}
        ${canAdmin()?`<button onclick="deleteStockCountAdmin('${count.id}')" class="px-4 py-2 border border-red-200 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">Delete Count</button>`:''}
      </div>
    </div>`;
    window.stockCountVarianceOnly=false;
    setTimeout(()=>{updateStockCountProgress();filterStockCountRows()},0);
  };

  window.submitStockCount=async function(id){
    const r=await db.rpc('submit_stock_count',{p_count_id:id});if(r.error)return showToast(r.error.message,'err');showToast('Stock count submitted.');invalidateInventoryTasks();await openStockCount(id);
  };
  window.closeStockCountNow=async function(id){
    if(!canReconcile())return showToast('Admin or Super Admin access required.','err');
    if(!confirm('Close this stock count and apply physical-count variances to live stock? This creates audited adjustment movements.'))return;
    const r=await db.rpc('close_stock_count',{p_count_id:id});if(r.error)return showToast(r.error.message,'err');
    showToast('Stock count closed and variances applied.');invalidateInventoryTasks();inv.locations=[];inv.balances=[];await openStockCount(id);
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
      const rows=inv.balances.filter(taxProductMatches).filter(p=>!s||[p.code,p.item_name,p.brand,p.class].filter(Boolean).join(' ').toLowerCase().includes(s));
      document.getElementById('content').innerHTML=`
        <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
          <input id="stockControllerProductSearch" value="${esc(state.productQuery||'')}" oninput="stockControllerProductSearch(this.value)" class="border rounded-xl px-4 py-2 w-full max-w-md" placeholder="Search code, item, brand...">
          <button onclick="go('stock-inventory')" class="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-sm font-semibold">Open Stock & Inventory</button>
        </div>
        <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 mb-4"><b>Stock Controller view:</b> product identity and inventory quantities only. Confidential costing and commercial pricing controls are not shown here.</div>
        <div class="text-xs text-gray-400 mb-3">${rows.length.toLocaleString()} products</div>
        <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          ${rows.slice(0,900).map(p=>`<button onclick="openProductStockHistory('${p.product_id}')" class="card rounded-2xl p-4 flex gap-4 text-left hover:shadow-md transition w-full">
            <div class="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden shrink-0">${p.image_url?`<img loading="lazy" decoding="async" src="${esc(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[9px] text-gray-400">No image</div>'}</div>
            <div class="min-w-0 flex-1">
              <div class="text-[10px] gold font-bold truncate">${esc(p.code||'')}${taxBadge(p)}</div>
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

  function taxLiveSignature(){
    const balances=(inv.taxBalances||[]).map(p=>[
      p.product_id,p.on_hand,p.available,p.reserved,p.on_order,p.incoming,p.arrived_pending_receive
    ].join(':')).join('|');
    const alerts=(inv.taxSaleAlerts||[]).map(a=>[
      a.id,a.alert_status,a.qty,a.on_hand,a.available,a.complete_sets,a.set_status,a.image_url||''
    ].join(':')).join('|');
    const codes=(inv.taxCodes||[]).map(x=>[
      x.id,x.active,x.on_hand_sets,x.available_sets,x.updated_at
    ].join(':')).join('|');
    return balances+'||'+alerts+'||'+codes;
  }

  let taxRefreshing=false;
  setInterval(async()=>{
    if(taxRefreshing||state.page!=='stock-inventory'||inv.tab!=='tax'||document.hidden||!document.getElementById('modal')?.classList.contains('hidden'))return;
    taxRefreshing=true;
    try{
      const before=taxLiveSignature();
      await Promise.all([loadTaxCore(true),loadTaxSaleAlerts(true),loadTaxDeclaredCodes(true)]);
      const after=taxLiveSignature();
      // Keep polling in the background, but do not redraw the whole Tax screen
      // unless something visible actually changed. This prevents thumbnail/list flicker.
      if(before!==after){
        const y=window.scrollY;
        await renderStockInventoryBody();
        requestAnimationFrame(()=>window.scrollTo({top:y,left:0,behavior:'auto'}));
      }
    }catch(err){
      console.warn('Tax Inventory background refresh failed:',err);
    }finally{taxRefreshing=false}
  },30000);
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
