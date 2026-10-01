// Stock Location Management: companies, multi-group memberships and physical locations.
// Loaded after stock-inventory.js so it can extend the final navigation safely.
(function(){
  function role(){return state.profile?.role||''}
  function canManage(){return ['admin','super_admin'].includes(role())}
  const lm={companies:[],groups:[],locations:[],memberships:[]};
  window.stockLocationManagementState=lm;

  function bySort(a,b){return Number(a.sort_order||100)-Number(b.sort_order||100)||String(a.name||a.code||'').localeCompare(String(b.name||b.code||''))}
  function groupIdsForLocation(locationId){return lm.memberships.filter(x=>String(x.location_id)===String(locationId)).map(x=>String(x.group_id))}
  function companyById(id){return lm.companies.find(x=>String(x.id)===String(id))||null}
  function groupById(id){return lm.groups.find(x=>String(x.id)===String(id))||null}
  function locationById(id){return lm.locations.find(x=>String(x.id)===String(id))||null}
  function locationGroupNames(id){return groupIdsForLocation(id).map(groupById).filter(Boolean).sort(bySort)}

  async function loadData(){
    if(!canManage())throw new Error('Admin or Super Admin access required.');
    const [cr,gr,lr,mr]=await Promise.all([
      db.from('stock_location_companies').select('*').order('sort_order').order('name'),
      db.from('stock_location_groups').select('*').order('sort_order').order('name'),
      db.from('stock_locations').select('*').order('sort_order').order('code'),
      db.from('stock_location_group_memberships').select('*')
    ]);
    if(cr.error)throw cr.error;if(gr.error)throw gr.error;if(lr.error)throw lr.error;if(mr.error)throw mr.error;
    lm.companies=cr.data||[];lm.groups=gr.data||[];lm.locations=lr.data||[];lm.memberships=mr.data||[];
  }

  function companySection(c){
    const rows=lm.locations.filter(x=>String(x.company_id||'')===String(c?.id||'')).sort(bySort);
    return `<div class="card rounded-2xl overflow-hidden">
      <div class="px-4 py-3 border-b bg-[#fcfbf8] flex items-center justify-between gap-3">
        <div><div class="font-bold">${esc(c?.name||'No Company')}</div><div class="text-[10px] text-gray-400">${rows.length} physical location${rows.length===1?'':'s'}</div></div>
        ${c?`<button onclick="openStockLocationCompanyEditor('${c.id}')" class="px-3 py-1.5 border rounded-lg text-[10px] font-semibold">Edit Company</button>`:''}
      </div>
      <div class="divide-y">
        ${rows.length?rows.map(l=>{
          const groups=locationGroupNames(l.id);
          return `<div class="p-4 grid lg:grid-cols-[120px_1.3fr_1.5fr_100px_100px] gap-3 items-center">
            <div><div class="text-[10px] uppercase font-bold text-gray-400">Code</div><b class="text-sm">${esc(l.code)}</b></div>
            <div><div class="text-[10px] uppercase font-bold text-gray-400">Location</div><div class="font-semibold text-sm">${esc(l.name||l.code)}</div><div class="text-[9px] text-gray-400">${esc(l.location_type||'storage')}</div></div>
            <div><div class="text-[10px] uppercase font-bold text-gray-400">Groups</div><div class="flex flex-wrap gap-1 mt-1">${groups.length?groups.map(g=>`<span class="px-2 py-1 rounded-lg border bg-blue-50 border-blue-100 text-blue-700 text-[9px] font-semibold">${esc(g.name)}</span>`).join(''):'<span class="text-[10px] text-gray-400">No group</span>'}</div></div>
            <div><span class="px-2 py-1 rounded-lg border text-[9px] font-bold ${l.active?'bg-green-50 text-green-700 border-green-200':'bg-gray-50 text-gray-500'}">${l.active?'ACTIVE':'INACTIVE'}</span></div>
            <div class="text-right"><button onclick="openStockLocationEditor('${l.id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Edit</button></div>
          </div>`;
        }).join(''):'<div class="p-6 text-center text-xs text-gray-400">No locations assigned.</div>'}
      </div>
    </div>`;
  }

  window.renderStockLocationManagement=async function(){
    if(!canManage())throw new Error('Admin or Super Admin access required.');
    await loadData();
    const activeLocations=lm.locations.filter(x=>x.active).length;
    const multiGroup=lm.locations.filter(x=>groupIdsForLocation(x.id).length>1).length;
    const unassigned=lm.locations.filter(x=>!x.company_id&&String(x.code||'').toUpperCase()!=='UNASSIGNED');
    const companies=[...lm.companies].sort(bySort);
    const noCompany={id:null,name:'Unassigned Company'};
    document.getElementById('content').innerHTML=`<div class="max-w-[1500px] mx-auto">
      <div class="rounded-2xl border border-blue-100 bg-blue-50 p-4 mb-5 text-xs text-blue-900">
        <b>One physical location = one stock balance.</b> Company and Location Group are classifications only. A location can belong to several groups without duplicating or moving any stock.
      </div>

      <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <div class="card rounded-2xl p-4"><div class="text-[10px] uppercase font-bold text-gray-400">Companies</div><div class="text-2xl font-black mt-1">${lm.companies.length}</div></div>
        <div class="card rounded-2xl p-4"><div class="text-[10px] uppercase font-bold text-gray-400">Location Groups</div><div class="text-2xl font-black mt-1">${lm.groups.length}</div></div>
        <div class="card rounded-2xl p-4"><div class="text-[10px] uppercase font-bold text-gray-400">Active Locations</div><div class="text-2xl font-black mt-1">${activeLocations}</div></div>
        <div class="card rounded-2xl p-4"><div class="text-[10px] uppercase font-bold text-gray-400">Multi-Group Locations</div><div class="text-2xl font-black mt-1 text-blue-700">${multiGroup}</div></div>
      </div>

      <div class="grid xl:grid-cols-2 gap-4 mb-5">
        <div class="card rounded-2xl overflow-hidden">
          <div class="p-4 border-b flex items-center justify-between gap-3"><div><h3 class="font-bold">Companies</h3><p class="text-[10px] text-gray-400">Primary ownership / business unit for each physical stock location.</p></div><button onclick="openStockLocationCompanyEditor()" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">+ Company</button></div>
          <div class="divide-y">${lm.companies.map(c=>`<div class="p-3 flex items-center justify-between gap-3"><div><b class="text-sm">${esc(c.name)}</b><div class="text-[10px] text-gray-400">${esc(c.code)} · ${lm.locations.filter(l=>String(l.company_id)===String(c.id)).length} locations</div></div><div class="flex items-center gap-2"><span class="text-[9px] font-bold ${c.active?'text-green-600':'text-gray-400'}">${c.active?'ACTIVE':'INACTIVE'}</span><button onclick="openStockLocationCompanyEditor('${c.id}')" class="px-2.5 py-1.5 border rounded-lg text-[10px] font-semibold">Edit</button></div></div>`).join('')}</div>
        </div>
        <div class="card rounded-2xl overflow-hidden">
          <div class="p-4 border-b flex items-center justify-between gap-3"><div><h3 class="font-bold">Location Groups</h3><p class="text-[10px] text-gray-400">Flexible reporting/filter groups. One location may belong to multiple groups.</p></div><button onclick="openStockLocationGroupEditor()" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">+ Group</button></div>
          <div class="divide-y">${lm.groups.map(g=>`<div class="p-3 flex items-center justify-between gap-3"><div><b class="text-sm">${esc(g.name)}</b><div class="text-[10px] text-gray-400">${esc(g.code)} · ${lm.memberships.filter(m=>String(m.group_id)===String(g.id)).length} locations</div></div><div class="flex items-center gap-2"><span class="text-[9px] font-bold ${g.active?'text-green-600':'text-gray-400'}">${g.active?'ACTIVE':'INACTIVE'}</span><button onclick="openStockLocationGroupEditor('${g.id}')" class="px-2.5 py-1.5 border rounded-lg text-[10px] font-semibold">Edit</button></div></div>`).join('')}</div>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div><h3 class="font-bold text-lg">Physical Stock Locations</h3><p class="text-xs text-gray-400">Manage company ownership and multi-group membership without changing live stock.</p></div>
        <button onclick="openStockLocationEditor()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold">+ Stock Location</button>
      </div>
      <div class="grid gap-4">
        ${companies.map(companySection).join('')}
        ${unassigned.length?companySection(noCompany):''}
      </div>
    </div>`;
  };

  window.openStockLocationCompanyEditor=function(id=null){
    if(!canManage())return showToast('Admin or Super Admin access required.','err');
    const row=id?lm.companies.find(x=>String(x.id)===String(id)):null;
    openModal(row?'Edit Company':'Add Company',`<form id="stockCompanyForm" class="space-y-4">
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Company Code *</label><input id="slcCode" required value="${esc(row?.code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: LPHOME"></div>
        <div><label class="text-xs font-semibold">Company Name *</label><input id="slcName" required value="${esc(row?.name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: LP Home"></div>
        <div><label class="text-xs font-semibold">Sort Order</label><input id="slcSort" type="number" value="${Number(row?.sort_order??100)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <label class="flex items-center gap-2 text-sm mt-6"><input id="slcActive" type="checkbox" ${row?.active!==false?'checked':''}> Active</label>
      </div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Company</button>
    </form>`);
    document.getElementById('stockCompanyForm').onsubmit=async e=>{
      e.preventDefault();
      const payload={code:document.getElementById('slcCode').value.trim().toUpperCase(),name:document.getElementById('slcName').value.trim(),sort_order:Number(document.getElementById('slcSort').value||100),active:document.getElementById('slcActive').checked,updated_at:new Date().toISOString()};
      const r=row?await db.from('stock_location_companies').update(payload).eq('id',row.id):await db.from('stock_location_companies').insert(payload);
      if(r.error)return showToast(r.error.message,'err');
      closeModal();showToast('Company saved.');await renderStockLocationManagement();
    };
  };

  window.openStockLocationGroupEditor=function(id=null){
    if(!canManage())return showToast('Admin or Super Admin access required.','err');
    const row=id?lm.groups.find(x=>String(x.id)===String(id)):null;
    openModal(row?'Edit Location Group':'Add Location Group',`<form id="stockGroupForm" class="space-y-4">
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Group Code *</label><input id="slgCode" required value="${esc(row?.code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: WAREHOUSE"></div>
        <div><label class="text-xs font-semibold">Group Name *</label><input id="slgName" required value="${esc(row?.name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: Warehouse"></div>
        <div><label class="text-xs font-semibold">Sort Order</label><input id="slgSort" type="number" value="${Number(row?.sort_order??100)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <label class="flex items-center gap-2 text-sm mt-6"><input id="slgActive" type="checkbox" ${row?.active!==false?'checked':''}> Active</label>
      </div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Group</button>
    </form>`);
    document.getElementById('stockGroupForm').onsubmit=async e=>{
      e.preventDefault();
      const payload={code:document.getElementById('slgCode').value.trim().toUpperCase(),name:document.getElementById('slgName').value.trim(),sort_order:Number(document.getElementById('slgSort').value||100),active:document.getElementById('slgActive').checked,updated_at:new Date().toISOString()};
      const r=row?await db.from('stock_location_groups').update(payload).eq('id',row.id):await db.from('stock_location_groups').insert(payload);
      if(r.error)return showToast(r.error.message,'err');
      closeModal();showToast('Location Group saved.');await renderStockLocationManagement();
    };
  };

  window.openStockLocationEditor=function(id=null){
    if(!canManage())return showToast('Admin or Super Admin access required.','err');
    const row=id?locationById(id):null;
    const selected=new Set(row?groupIdsForLocation(row.id):[]);
    openModal(row?'Edit Stock Location':'Add Stock Location',`<form id="stockLocationForm" class="space-y-4">
      <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">This edits the location classification only. Existing stock stays attached to the same physical location ID.</div>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Location Code *</label><input id="slCode" required value="${esc(row?.code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: LX8"></div>
        <div><label class="text-xs font-semibold">Location Name *</label><input id="slName" required value="${esc(row?.name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: LX8"></div>
        <div><label class="text-xs font-semibold">Company</label><select id="slCompany" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">No Company</option>${lm.companies.filter(x=>x.active||String(x.id)===String(row?.company_id)).sort(bySort).map(c=>`<option value="${c.id}" ${String(c.id)===String(row?.company_id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div><label class="text-xs font-semibold">Location Type</label><select id="slType" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="storage" ${(row?.location_type||'storage')==='storage'?'selected':''}>Storage</option><option value="showroom" ${row?.location_type==='showroom'?'selected':''}>Showroom</option><option value="warehouse" ${row?.location_type==='warehouse'?'selected':''}>Warehouse</option><option value="other" ${row?.location_type==='other'?'selected':''}>Other</option></select></div>
        <div><label class="text-xs font-semibold">Sort Order</label><input id="slSort" type="number" value="${Number(row?.sort_order??100)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <label class="flex items-center gap-2 text-sm mt-6"><input id="slActive" type="checkbox" ${row?.active!==false?'checked':''}> Active location</label>
      </div>
      <div><label class="text-xs font-semibold">Location Groups</label><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">${lm.groups.filter(x=>x.active||selected.has(String(x.id))).sort(bySort).map(g=>`<label class="flex items-center gap-2 rounded-xl border p-3 text-xs bg-white"><input class="sl-group-check" type="checkbox" value="${g.id}" ${selected.has(String(g.id))?'checked':''}><span><b>${esc(g.name)}</b><span class="block text-[9px] text-gray-400">${esc(g.code)}</span></span></label>`).join('')}</div></div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Stock Location</button>
    </form>`);
    document.getElementById('stockLocationForm').onsubmit=async e=>{
      e.preventDefault();
      const payload={code:document.getElementById('slCode').value.trim().toUpperCase(),name:document.getElementById('slName').value.trim(),company_id:document.getElementById('slCompany').value||null,location_type:document.getElementById('slType').value||'storage',sort_order:Number(document.getElementById('slSort').value||100),active:document.getElementById('slActive').checked,updated_at:new Date().toISOString()};
      const selectedGroups=[...document.querySelectorAll('.sl-group-check:checked')].map(x=>x.value);
      let locationId=row?.id||null;
      let r;
      if(row){
        r=await db.from('stock_locations').update(payload).eq('id',row.id).select('id').single();
      }else{
        r=await db.from('stock_locations').insert(payload).select('id').single();
      }
      if(r.error)return showToast(r.error.message,'err');
      locationId=r.data?.id||locationId;
      const del=await db.from('stock_location_group_memberships').delete().eq('location_id',locationId);
      if(del.error)return showToast(del.error.message,'err');
      if(selectedGroups.length){
        const ins=await db.from('stock_location_group_memberships').insert(selectedGroups.map(group_id=>({location_id:locationId,group_id,created_by:state.user?.id||null})));
        if(ins.error)return showToast(ins.error.message,'err');
      }
      if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
      closeModal();showToast('Stock location saved.');await renderStockLocationManagement();
    };
  };

  const previousNavItems=window.navItems;
  if(typeof previousNavItems==='function'){
    window.navItems=function(){
      const items=previousNavItems.apply(this,arguments)||[];
      if(!canManage()||items.some(x=>x[0]==='stock-locations'))return items;
      const out=[];let placed=false;
      for(const x of items){
        out.push(x);
        if(x[0]==='sales-access'){out.push(['stock-locations','Stock Locations','⌖']);placed=true;}
      }
      if(!placed)out.push(['stock-locations','Stock Locations','⌖']);
      return out;
    };
  }

  const previousGo=window.go;
  if(typeof previousGo==='function'){
    window.go=async function(page){
      if(page!=='stock-locations')return previousGo.apply(this,arguments);
      if(!canManage())return showToast('Admin or Super Admin access required.','err');
      state.page='stock-locations';renderNav();
      document.getElementById('pageTitle').textContent='Stock Locations';
      document.getElementById('pageSubtitle').textContent='Companies, physical stock locations and flexible location groups';
      document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
      try{await renderStockLocationManagement()}catch(err){document.getElementById('content').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
    };
  }

  try{if(state?.profile)renderNav()}catch(_){}
})();