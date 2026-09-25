// Assign Sales Rep to an existing sale/order from Sales Tracking.
// Loaded after tracking/document/payment scripts.
(function(){
  function canAssign(){return ['super_admin','admin','manager'].includes(state.profile?.role||'')}
  function roleLabel(r){return r==='sales'?'Sales':r==='manager'?'Manager':titleCase(r||'')}
  function repName(o){return o?.sales_rep_name_snapshot||'Unassigned'}

  function decorateSalesCards(){
    if(!canAssign()||!window.trackingRedesign?.salesOrders)return;
    for(const o of window.trackingRedesign.salesOrders){
      const trigger=document.querySelector(`button[onclick="toggleSalesInvoice('${o.id}')"]`);
      const card=trigger?.closest('.lr-order-card');
      if(!card||card.querySelector(`.sales-assign-box[data-order-id="${o.id}"]`))continue;
      const right=card.querySelector('.lr-order-main > div:last-child');
      if(!right)continue;
      const box=document.createElement('div');
      box.className='sales-assign-box col-span-2 mt-2 pt-2 border-t flex items-center justify-end gap-2 flex-wrap';
      box.dataset.orderId=o.id;
      box.innerHTML=`<span class="text-[10px] text-gray-400">Assigned: <b class="text-gray-700">${esc(repName(o))}</b></span><button onclick="openAssignSales('${o.id}')" class="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[10px] font-bold">Assign Sales</button>`;
      right.appendChild(box);
    }
  }

  const previousRender=window.renderSalesTrackingBody;
  if(typeof previousRender==='function'){
    window.renderSalesTrackingBody=function(){
      const out=previousRender.apply(this,arguments);
      setTimeout(decorateSalesCards,0);
      return out;
    };
  }

  const previousRenderSalesOrders=window.renderSalesOrders;
  if(typeof previousRenderSalesOrders==='function'){
    window.renderSalesOrders=async function(){
      const out=await previousRenderSalesOrders.apply(this,arguments);
      setTimeout(decorateSalesCards,0);
      return out;
    };
  }

  window.openAssignSales=async function(orderId){
    if(!canAssign())return showToast('You do not have permission to assign sales.','err');
    const order=(window.trackingRedesign?.salesOrders||[]).find(x=>x.id===orderId);
    const {data,error}=await db.from('app_users').select('user_id,email,display_name,role,active').in('role',['sales','manager']).eq('active',true).order('role').order('display_name');
    if(error)return showToast(error.message,'err');
    const reps=data||[];
    if(!reps.length){
      return openModal('Assign Sales',`<div class="p-2"><div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">There are no active Sales or Manager accounts to assign. Create a Sales user first in <b>Users & Access</b>.</div></div>`);
    }
    openModal('Assign Sales Rep',`
      <form id="assignSalesForm" class="space-y-5">
        <div class="rounded-xl bg-gray-50 border p-4 text-sm">
          <div class="text-[10px] uppercase tracking-wide text-gray-400 font-bold">Order / Invoice</div>
          <div class="font-bold mt-1">${esc(order?.sales_invoice_no||order?.sr_no||order?.invoice_no||order?.order_no||'Order')}</div>
          <div class="text-xs text-gray-500 mt-1">${esc(order?.customer_name||'')}</div>
        </div>
        <div>
          <label class="text-xs font-semibold">Assign To</label>
          <select id="assignSalesUser" class="mt-1 w-full border rounded-xl px-3 py-3 bg-white">
            ${reps.map(u=>`<option value="${u.user_id}" data-name="${esc(u.display_name||u.email)}" ${u.user_id===order?.sales_rep_id?'selected':''}>${esc(u.display_name||u.email)} — ${roleLabel(u.role)}</option>`).join('')}
          </select>
        </div>
        <label class="flex items-start gap-3 rounded-xl border p-4 cursor-pointer">
          <input id="assignCustomerToo" type="checkbox" checked class="mt-1">
          <span><b class="text-sm">Also assign this customer to the same Sales Rep</b><span class="block text-[11px] text-gray-500 mt-1">Recommended so the Sales Rep can see the customer profile together with this order.</span></span>
        </label>
        <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Assignment</button>
      </form>`);
    document.getElementById('assignSalesForm').onsubmit=async e=>{
      e.preventDefault();
      const sel=document.getElementById('assignSalesUser');
      const userId=sel.value;
      const name=sel.selectedOptions[0]?.dataset.name||sel.selectedOptions[0]?.textContent||'';
      const up=await db.from('sales_orders').update({sales_rep_id:userId,sales_rep_name_snapshot:name}).eq('id',orderId);
      if(up.error)return showToast(up.error.message,'err');
      if(document.getElementById('assignCustomerToo').checked && order?.customer_id){
        const cu=await db.from('customers').update({assigned_sales_id:userId}).eq('id',order.customer_id);
        if(cu.error)return showToast(`Order assigned, but customer assignment failed: ${cu.error.message}`,'err');
      }
      if(typeof recordManagerRepAction==='function' && typeof managerRepActive==='function' && managerRepActive()){
        await recordManagerRepAction('assign_sales_order','sales_order',orderId,{assigned_sales_user_id:userId,assigned_sales_name:name});
      }
      if(window.trackingRedesign){
        const x=window.trackingRedesign.salesOrders.find(v=>v.id===orderId);
        if(x){x.sales_rep_id=userId;x.sales_rep_name_snapshot=name;}
      }
      closeModal();showToast(`Assigned to ${name}`);await go('sales-orders');
    };
  };

  setTimeout(decorateSalesCards,300);
})();