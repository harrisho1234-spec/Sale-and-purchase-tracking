// Multi-shipment tracking for Supplier POs. Requires database/multi-shipment-agents-per-po.sql.
(function () {
  'use strict';

  const STATUS = [
    ['planned','Planned'], ['booked','Booked'], ['in_transit','In Transit'],
    ['arrived','Arrived'], ['customs_cleared','Customs Cleared'],
    ['delivered','Delivered'], ['cancelled','Cancelled']
  ];
  const METHODS = [
    ['sea','Sea Freight'], ['air','Air Freight'], ['land','Land Transport'],
    ['courier','Courier'], ['other','Other']
  ];
  const h = value => esc(value == null ? '' : String(value));
  const labelPO = po => po?.po_number || po?.po_pending_reference || 'PO Pending';
  const amount = value => '$' + Number(value || 0).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
  const date = value => value ? String(value).slice(0,10) : '';
  const permission = key => typeof window.hasAppPermission === 'function'
    ? window.hasAppPermission(key)
    : isAdmin();
  const mayEdit = () => permission('procurement.po_edit') || isAdmin();
  const mayManageAgents = () => permission('procurement.vendor_manage') || isAdmin();
  const opt = (values,selected) => values.map(([v,l]) =>
    '<option value="' + h(v) + '"' + (v===selected?' selected':'') + '>' + h(l) + '</option>').join('');
  const field = (label,id,value='',type='text',extra='') =>
    '<div><label class="text-xs font-semibold text-gray-600" for="'+id+'">'+h(label)+'</label>' +
    '<input id="'+id+'" type="'+type+'" value="'+h(value)+'" '+extra+
    ' class="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm bg-white"></div>';
  const statusClass = status => status==='delivered'||status==='customs_cleared'?'bg-green-50 text-green-700 border-green-200'
    :status==='arrived'?'bg-blue-50 text-blue-700 border-blue-200'
    :status==='cancelled'?'bg-gray-100 text-gray-500 border-gray-200'
    :'bg-amber-50 text-amber-700 border-amber-200';

  async function query(table,columns='*',order='created_at') {
    const r = await db.from(table).select(columns).order(order,{ascending:false});
    if(r.error)throw r.error;
    return r.data||[];
  }

  window.renderProcurementShipments = async function(search='') {
    const [ships,agents,pos,allocations] = await Promise.all([
      query('supplier_po_shipments'),
      query('shipping_agents','id,name,active'),
      query('supplier_pos','id,po_number,po_pending_reference,vendor_name,order_date,status'),
      query('supplier_po_shipment_items','shipment_id,supplier_po_item_id,qty')
    ]);
    const poMap=new Map(pos.map(p=>[p.id,p]));
    const agMap=new Map(agents.map(a=>[a.id,a]));
    const terms=String(search||'').trim().toLowerCase();
    const rows=ships.filter(s=>{
      const p=poMap.get(s.supplier_po_id);
      return !terms || [labelPO(p),p?.vendor_name,s.shipping_agent_name_snapshot,
        s.shipment_reference,s.tracking_number,s.container_number,s.bill_of_lading,s.status]
        .some(v=>String(v||'').toLowerCase().includes(terms));
    });
    const active=rows.filter(s=>s.status!=='cancelled');
    const cost=active.reduce((sum,s)=>sum+Number(s.freight_cost_usd||0),0);
    return '<div class="mb-4 flex flex-wrap items-center justify-between gap-3">'+
      '<div><h3 class="font-bold">Shipments by Supplier PO</h3>'+
      '<p class="text-xs text-gray-500 mt-1">Multiple shipping agents, partial quantities, ETD/ETA and actual freight per shipment. Shipment arrival does not automatically receive stock.</p></div>'+
      (mayEdit()?'<button onclick="openNewPOShipment()" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">+ Add Shipment</button>':'')+
      '</div>'+
      '<div class="grid sm:grid-cols-3 gap-3 mb-4">'+
      '<div class="pw-stat"><div class="pw-stat-label">Shipments</div><div class="pw-stat-value">'+rows.length+'</div></div>'+
      '<div class="pw-stat"><div class="pw-stat-label">Active Shipments</div><div class="pw-stat-value">'+active.length+'</div></div>'+
      '<div class="pw-stat"><div class="pw-stat-label">Freight Cost · USD</div><div class="pw-stat-value">'+amount(cost)+'</div></div>'+
      '</div>'+
      '<div class="p-3 rounded-xl border border-blue-100 bg-blue-50 text-xs text-blue-800 mb-4">These freight amounts are tracked separately from existing PO item shipping-cost estimates to avoid double counting. Record supplier/shipping payments in Supplier Payments as before.</div>'+
      '<div class="grid gap-3">'+(rows.map(s=>{
        const p=poMap.get(s.supplier_po_id);
        const qty=allocations.filter(a=>a.shipment_id===s.id).reduce((sum,a)=>sum+Number(a.qty||0),0);
        return '<div class="pw-card">'+
          '<div class="flex items-start justify-between flex-wrap gap-3"><div>'+
          '<div class="flex flex-wrap gap-2 items-center"><b class="text-sm">'+h(labelPO(p))+'</b>'+
          '<span class="border rounded-full px-2 py-0.5 text-[10px] font-semibold '+statusClass(s.status)+'">'+h(STATUS.find(x=>x[0]===s.status)?.[1]||s.status)+'</span>'+
          '</div><div class="text-xs text-gray-500 mt-1">'+h(p?.vendor_name||'')+' · Agent: <b>'+h(s.shipping_agent_name_snapshot || agMap.get(s.shipping_agent_id)?.name)+'</b></div>'+
          '<div class="text-xs text-gray-500 mt-1">'+h(s.shipment_reference||'Shipment')+' · '+h(METHODS.find(x=>x[0]===s.shipment_method)?.[1]||s.shipment_method)+'</div></div>'+
          '<div class="flex items-center gap-2">'+
          (mayEdit()?'<button onclick="openNewPOShipment(\''+h(s.supplier_po_id)+'\',\''+h(s.id)+'\')" class="px-3 py-2 border rounded-lg text-xs font-semibold">Edit</button>':'')+
          '<button onclick="openManageSupplierPO(\''+h(s.supplier_po_id)+'\')" class="px-3 py-2 rounded-lg border bg-white text-xs">View PO</button></div></div>'+
          '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">'+
          '<div><div class="text-gray-400">ETD</div><b>'+h(date(s.etd)||'TBD')+'</b></div>'+
          '<div><div class="text-gray-400">ETA</div><b>'+h(date(s.eta)||'TBD')+'</b></div>'+
          '<div><div class="text-gray-400">Allocated Qty</div><b>'+qty.toLocaleString()+'</b></div>'+
          '<div><div class="text-gray-400">Freight (USD)</div><b>'+amount(s.freight_cost_usd)+'</b></div>'+
          '</div><div class="text-[11px] text-gray-500 mt-3 break-words">Tracking: '+h(s.tracking_number||'-')+
          ' · Container: '+h(s.container_number||'-')+
          ' · B/L: '+h(s.bill_of_lading||'-')+'</div></div>';
      }).join('')||'<div class="p-8 rounded-xl bg-white border text-center text-sm text-gray-400">No shipments found. Add the first shipment for a Supplier PO.</div>')+'</div>';
  };

  window.renderProcurementAgents = async function(search='') {
    const agents=await query('shipping_agents');
    const terms=String(search||'').toLowerCase();
    const filtered=agents.filter(a=>!terms||[a.name,a.contact_person,a.phone,a.email,a.origin_country].some(v=>String(v||'').toLowerCase().includes(terms)));
    return '<div class="mb-4 flex justify-between items-center gap-3"><div><h3 class="font-bold">Shipping Agent Directory</h3><p class="text-xs text-gray-500 mt-1">Create once and reuse the same agent across different POs and shipments.</p></div>'+
      (mayManageAgents()?'<button onclick="openShippingAgent()" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">+ Shipping Agent</button>':'')+
      '</div><div class="card rounded-2xl divide-y">'+
      (filtered.map(a=>'<div class="p-4 flex justify-between gap-4 items-center flex-wrap">'+
       '<div><b>'+h(a.name)+'</b><span class="ml-2 text-[10px] '+(a.active?'text-green-700':'text-gray-400')+'">'+(a.active?'Active':'Inactive')+'</span>'+
       '<div class="text-xs text-gray-500 mt-1">'+h(a.contact_person||'No contact')+' · '+h(a.phone||'-')+' · '+h(a.email||'-')+'</div>'+
       '<div class="text-[11px] text-gray-400">'+h(a.origin_country||'')+'</div></div>'+
       (mayManageAgents()?'<button onclick="openShippingAgent(\''+h(a.id)+'\')" class="rounded-lg border px-3 py-2 text-xs font-semibold">Edit</button>':'')+
       '</div>').join('')||'<div class="p-8 text-center text-xs text-gray-400">No shipping agents found.</div>')+'</div>';
  };

  window.openShippingAgent=async function(id='') {
    if(!mayManageAgents())return showToast('Shipping agent management is not permitted','err');
    try {
      let a={active:true};
      if(id) {
        const r=await db.from('shipping_agents').select('*').eq('id',id).single();
        if(r.error)throw r.error;
        a=r.data;
      }
      openModal(id?'Edit Shipping Agent':'Add Shipping Agent',
        '<form id="shippingAgentForm" class="space-y-4">'+
        '<div class="grid sm:grid-cols-2 gap-3">'+
        field('Agent Company Name *','saName',a.name||'','text','required maxlength="200"')+
        field('Contact Person','saContact',a.contact_person)+
        field('Phone','saPhone',a.phone)+
        field('Email','saEmail',a.email,'email')+
        field('Telegram','saTelegram',a.telegram)+
        field('Origin Country / Main Route','saCountry',a.origin_country)+
        '</div><div><label class="text-xs font-semibold">Notes / Terms</label><textarea id="saNotes" rows="3" class="mt-1 w-full rounded-xl border p-3 text-sm">'+h(a.notes||'')+'</textarea></div>'+
        '<label class="text-xs flex items-center gap-2"><input type="checkbox" id="saActive" '+(a.active?'checked':'')+'> Active agent</label>'+
        '<button class="w-full rounded-xl bg-[#211d18] text-white py-3 text-sm font-semibold">Save Shipping Agent</button></form>');
      document.getElementById('shippingAgentForm').onsubmit=async e=>{
        e.preventDefault();
        const name=document.getElementById('saName').value.trim();
        if(!name)return showToast('Enter an agent name','err');
        const payload={
          name,contact_person:document.getElementById('saContact').value.trim()||null,
          phone:document.getElementById('saPhone').value.trim()||null,
          email:document.getElementById('saEmail').value.trim()||null,
          telegram:document.getElementById('saTelegram').value.trim()||null,
          origin_country:document.getElementById('saCountry').value.trim()||null,
          notes:document.getElementById('saNotes').value.trim()||null,
          active:document.getElementById('saActive').checked,
          updated_at:new Date().toISOString()
        };
        const submit=e.target.querySelector('button[type="submit"],button:not([type])');
        if(submit)submit.disabled=true;
        try {
          const r=id?await db.from('shipping_agents').update(payload).eq('id',id):
            await db.from('shipping_agents').insert(payload);
          if(r.error)throw r.error;
          closeModal();showToast('Shipping agent saved');
          setProcurementTab('agents');
        }catch(err){showToast(err.message,'err');if(submit)submit.disabled=false}
      };
    }catch(err){showToast(err.message,'err')}
  };

  window.openNewPOShipment=async function(poId='',shipmentId='') {
    if(!mayEdit())return showToast('Supplier PO edit permission is required','err');
    try {
      const [pos,agents,ships,allocations]=await Promise.all([
        query('supplier_pos','id,po_number,po_pending_reference,vendor_name,status'),
        query('shipping_agents','id,name,active','name'),
        query('supplier_po_shipments'),
        query('supplier_po_shipment_items','shipment_id,supplier_po_item_id,qty')
      ]);
      const editing=shipmentId?ships.find(s=>s.id===shipmentId):null;
      if(shipmentId&&!editing)throw new Error('Shipment not found');
      poId=editing?.supplier_po_id||poId||pos[0]?.id||'';
      const p=pos.find(x=>x.id===poId);
      if(!p)throw new Error('Create a Supplier PO before adding shipments');
      const ir=await db.from('supplier_po_items')
        .select('id,product_code_snapshot,item_name_snapshot,qty,historical_stock_reconciled')
        .eq('supplier_po_id',poId).order('created_at',{ascending:true});
      if(ir.error)throw ir.error;
      const items=ir.data||[];
      const current=new Map(allocations.filter(a=>a.shipment_id===shipmentId)
        .map(a=>[a.supplier_po_item_id,Number(a.qty)]));
      const shipMap=new Map(ships.map(s=>[s.id,s]));
      const other=new Map();
      for(const a of allocations) {
        if(a.shipment_id===shipmentId || shipMap.get(a.shipment_id)?.status==='cancelled')continue;
        other.set(a.supplier_po_item_id,(other.get(a.supplier_po_item_id)||0)+Number(a.qty));
      }
      const availableAgents=agents.filter(a=>a.active||a.id===editing?.shipping_agent_id);
      const poSelect=editing
        ?'<div class="text-sm font-semibold border rounded-xl p-3 bg-gray-50">'+h(labelPO(p))+' · '+h(p.vendor_name||'')+'</div>'
        :'<select id="shPo" onchange="openNewPOShipment(this.value)" class="w-full mt-1 border rounded-xl px-3 py-2.5 bg-white text-sm">'+
         opt(pos.map(x=>[x.id,labelPO(x)+' · '+(x.vendor_name||'')]),poId)+'</select>';
      const controls=items.map(item=>{
        const ordered=Number(item.qty||0),used=other.get(item.id)||0,remain=Math.max(0,ordered-used);
        const currentQty=current.get(item.id)||0;
        return '<div class="flex flex-wrap items-center gap-3 border-b last:border-0 py-2 text-xs">'+
          '<div class="flex-1 min-w-[180px]"><b>'+h(item.product_code_snapshot||'No Code')+'</b> · '+h(item.item_name_snapshot||'')+
          '<div class="text-gray-400 mt-1">PO: '+ordered+' · Other shipments: '+used+' · Available: '+remain+'</div></div>'+
          '<input class="shipment-item-qty w-28 border rounded-lg px-3 py-2 text-sm" type="number" min="0" max="'+remain+'" step="0.001" '+
          'value="'+currentQty+'" data-item-id="'+h(item.id)+'" '+(item.historical_stock_reconciled?'disabled':'')+' title="Shipment quantity"></div>';
      }).join('');
      const ship=editing||{};
      openModal(editing?'Edit PO Shipment':'New Supplier PO Shipment',
        '<form id="poShipmentForm" class="space-y-4">'+
        '<div class="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">Shipment tracking does not add stock or change PO receipts. Receive Stock remains a separate approved operation.</div>'+
        '<div><label class="text-xs font-semibold">Supplier PO *</label>'+poSelect+'</div>'+
        '<div class="grid md:grid-cols-2 gap-3">'+
        '<div><label class="text-xs font-semibold">Shipping Agent *</label><select id="shAgent" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white text-sm"><option value="">Select shipping agent</option>'+
        opt(availableAgents.map(a=>[a.id,a.name]),ship.shipping_agent_id||'')+'</select>'+
        '<div class="text-[10px] text-gray-500 mt-1">Add an agent first under Shipping Agents if missing.</div></div>'+
        '<div><label class="text-xs font-semibold">Status</label><select id="shStatus" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white text-sm">'+opt(STATUS,ship.status||'planned')+'</select></div>'+
        '<div><label class="text-xs font-semibold">Transport Method</label><select id="shMethod" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white text-sm">'+opt(METHODS,ship.shipment_method||'sea')+'</select></div>'+
        field('Shipment Reference','shReference',ship.shipment_reference)+
        field('Tracking Number','shTracking',ship.tracking_number)+
        field('Container Number','shContainer',ship.container_number)+
        field('Bill of Lading / AWB','shBL',ship.bill_of_lading)+
        field('Origin','shOrigin',ship.origin)+
        field('Destination','shDestination',ship.destination)+
        field('ETD — Estimated Departure','shETD',date(ship.etd),'date')+
        field('ETA — Estimated Arrival','shETA',date(ship.eta),'date')+
        field('Actual Departure','shDepart',date(ship.actual_departure),'date')+
        field('Actual Arrival','shArrival',date(ship.actual_arrival),'date')+
        field('Freight Cost (USD)','shFreight',ship.freight_cost_usd??0,'number','min="0" step="0.01"')+
        '</div><div><label class="text-xs font-semibold">PO Item Quantities on This Shipment</label><div class="mt-2 rounded-xl border p-3 max-h-[250px] overflow-auto">'+(controls||'<p class="text-red-500 text-xs">No PO items found. Add items to the Supplier PO first.</p>')+'</div></div>'+
        '<div><label class="text-xs font-semibold">Notes</label><textarea id="shNotes" class="mt-1 w-full border rounded-xl p-3 text-sm" rows="3">'+h(ship.notes||'')+'</textarea></div>'+
        '<div class="flex flex-wrap gap-2">'+
        '<button type="submit" class="flex-1 bg-[#211d18] text-white rounded-xl px-5 py-3 text-sm font-semibold">Save Shipment</button>'+
        (editing&&editing.status!=='cancelled'?'<button type="button" onclick="cancelPOShipment(\''+h(shipmentId)+'\')" class="px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">Cancel Shipment</button>':'')+
        '</div></form>');
      document.getElementById('poShipmentForm').onsubmit=async e=>{
        e.preventDefault();
        const rowValues=[...document.querySelectorAll('.shipment-item-qty')];
        const lineItems=rowValues.map(x=>({
          supplier_po_item_id:x.dataset.itemId,qty:Number(x.value||0)
        })).filter(x=>x.qty>0);
        const st=document.getElementById('shStatus').value;
        if(st!=='cancelled'&&!lineItems.length)return showToast('Enter at least one shipment item quantity','err');
        const payload={
          id:shipmentId||null,supplier_po_id:poId,
          shipping_agent_id:document.getElementById('shAgent').value,
          shipment_method:document.getElementById('shMethod').value,
          status:st,
          shipment_reference:document.getElementById('shReference').value.trim(),
          tracking_number:document.getElementById('shTracking').value.trim(),
          container_number:document.getElementById('shContainer').value.trim(),
          bill_of_lading:document.getElementById('shBL').value.trim(),
          origin:document.getElementById('shOrigin').value.trim(),
          destination:document.getElementById('shDestination').value.trim(),
          etd:document.getElementById('shETD').value,
          eta:document.getElementById('shETA').value,
          actual_departure:document.getElementById('shDepart').value,
          actual_arrival:document.getElementById('shArrival').value,
          freight_cost_usd:Number(document.getElementById('shFreight').value||0),
          notes:document.getElementById('shNotes').value.trim()
        };
        if(!payload.shipping_agent_id)return showToast('Select a shipping agent','err');
        if(payload.etd&&payload.eta&&payload.eta<payload.etd)
          return showToast('ETA must be on or after ETD','err');
        const btn=e.target.querySelector('button[type="submit"]');
        if(btn)btn.disabled=true;
        try {
          const r=await db.rpc('save_supplier_po_shipment',{p_shipment:payload,p_items:lineItems});
          if(r.error)throw r.error;
          closeModal();showToast('Shipment saved successfully');
          setProcurementTab('shipments');
        }catch(err){showToast(err.message,'err');if(btn)btn.disabled=false}
      };
    }catch(err){showToast(err.message,'err')}
  };

  window.cancelPOShipment=async function(id) {
    if(!mayEdit())return showToast('No permission','err');
    if(!window.confirm('Cancel this shipment? Its quantity allocations will become available for other shipments. This does not affect stock.'))return;
    try {
      const [shipRes,itemsRes]=await Promise.all([
        db.from('supplier_po_shipments').select('*').eq('id',id).single(),
        db.from('supplier_po_shipment_items').select('supplier_po_item_id,qty').eq('shipment_id',id)
      ]);
      if(shipRes.error)throw shipRes.error;
      if(itemsRes.error)throw itemsRes.error;
      const ship={...shipRes.data,status:'cancelled'};
      const r=await db.rpc('save_supplier_po_shipment',{
        p_shipment:ship,p_items:itemsRes.data||[]
      });
      if(r.error)throw r.error;
      closeModal();showToast('Shipment cancelled; PO and stock unchanged');
      setProcurementTab('shipments');
    }catch(err){showToast(err.message,'err')}
  };
})();
