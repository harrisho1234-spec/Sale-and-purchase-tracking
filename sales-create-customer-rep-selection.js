// New-sale safety: start with no customer selected, and let Manager/Admin/Super Admin assign the Sales Rep.
// Loaded last so it preserves all existing create-sale enhancements.
(function(){
  const baseOpenNewOrder=window.openNewOrder;
  if(typeof baseOpenNewOrder!=='function')return;

  function currentFlow(){return document.getElementById('salesFlowType')?.value||'stock_sale'}
  function rows(){return [...document.querySelectorAll('#orderItems .order-item-row')]}
  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
  function cleanDoc(v){return String(v||'').trim().toUpperCase().replace(/\s+/g,'')}
  function normalizeDoc(flow,invoiceType,raw){
    let v=cleanDoc(raw);
    if(flow==='pre_order'){
      if(!v.startsWith('SR'))v='SR-'+v.replace(/^[-:]+/,'');
      return v;
    }
    if(!v.startsWith(invoiceType))v=invoiceType+v.replace(/^[-:]+/,'');
    return v;
  }
  function managerContextActive(){return typeof managerRepActive==='function'&&managerRepActive()}
  function calc(){
    let subtotal=0;
    rows().forEach(r=>{
      const q=Number(r.querySelector('.qty')?.value||0);
      const p=Number(String(r.querySelector('.unit-price')?.value||0).replace(',','.'));
      const d=Number(r.querySelector('.line-discount')?.value||0);
      subtotal+=Math.max(q*p-d,0);
    });
    const orderDiscount=Math.max(Number(document.getElementById('orderDiscount')?.value||0),0);
    const total=Math.max(subtotal-orderDiscount,0);
    const depositMode=document.getElementById('depositMode')?.value||'amount';
    const depositValue=Math.max(Number(document.getElementById('depositValue')?.value||0),0);
    const depositAmount=depositMode==='percent'?round2(total*depositValue/100):round2(depositValue);
    return {subtotal:round2(subtotal),orderDiscount:round2(orderDiscount),total:round2(total),depositMode,depositValue:round2(depositValue),depositAmount};
  }

  function canChooseRep(){
    return ['manager','admin','super_admin'].includes(state.profile?.role||'');
  }

  async function getAssignableReps(){
    const r=await db.from('app_users')
      .select('user_id,email,display_name,role,active')
      .in('role',['sales','manager','admin','super_admin'])
      .eq('active',true)
      .order('role')
      .order('display_name');
    if(r.error)throw r.error;
    const currentId=state.user?.id||'';
    return (r.data||[]).filter(u=>['sales','manager'].includes(u.role)||u.user_id===currentId);
  }

  function selectedRep(){
    if(canChooseRep()){
      const sel=document.getElementById('createOrderSalesRep');
      const opt=sel?.selectedOptions?.[0];
      return {id:sel?.value||'',name:opt?.dataset?.name||opt?.textContent||''};
    }
    return {id:state.user.id,name:state.profile?.display_name||state.user?.email||''};
  }

  async function saveWithSelection(e){
    e.preventDefault();
    const customerId=document.getElementById('orderCustomer')?.value||'';
    if(!customerId){document.getElementById('orderCustomer')?.focus();return showToast('Please select a customer.','err')}

    const rep=selectedRep();
    if(!rep.id){document.getElementById('createOrderSalesRep')?.focus();return showToast('Please select the Sales Rep.','err')}

    const itemRows=rows();
    if(!itemRows.length)return showToast('Add at least one item.','err');

    const missingProduct=itemRows.find(r=>{
      const lineKind=r.querySelector('.line-kind')?.value||'product';
      return lineKind!=='service'&&!r.querySelector('.product-id')?.value;
    });
    if(missingProduct){
      missingProduct.querySelector('.product-search-input')?.focus();
      return showToast('Choose a matching product from the suggestion list.','err');
    }

    const missingService=itemRows.find(r=>{
      const lineKind=r.querySelector('.line-kind')?.value||'product';
      return lineKind==='service'&&!String(r.querySelector('.product-name')?.value||'').trim();
    });
    if(missingService){
      missingService.querySelector('.service-name')?.focus();
      return showToast('Enter a service or fee description.','err');
    }

    const flow=currentFlow();
    const invoiceType=document.getElementById('salesInvoiceType')?.value||'TK';
    const docNo=normalizeDoc(flow,invoiceType,document.getElementById('salesDocumentNo')?.value||'');
    if(!docNo)return showToast(flow==='pre_order'?'Enter the SR number.':'Enter the TK/RK invoice number.','err');
    if(flow==='pre_order'&&!docNo.startsWith('SR'))return showToast('Pre-order document number must begin with SR.','err');
    if(flow==='stock_sale'&&!docNo.startsWith(invoiceType))return showToast(`Invoice number must begin with ${invoiceType}.`,'err');

    const c=calc();
    // $0 orders are valid for complimentary/warranty items and 100% discounts.
    // Unit prices still cannot be negative.
    if(c.depositMode==='percent'&&c.depositValue>100)return showToast('Deposit percentage cannot be more than 100%.','err');
    if(c.depositAmount>c.total+0.001)return showToast('Deposit amount cannot be greater than the order total.','err');

    const orderDate=document.getElementById('orderDate').value;
    const order={
      customer_id:customerId,
      sales_rep_id:rep.id,
      sales_rep_name_snapshot:rep.name||null,
      order_date:orderDate,
      order_type:flow==='pre_order'?'pre_order':'in_stock',
      sales_flow_type:flow,
      status:'confirmed',currency:'USD',order_discount:c.orderDiscount,
      notes:document.getElementById('orderNotes').value.trim()||null,
      created_by:state.user.id,
      order_no:docNo,
      invoice_no:flow==='stock_sale'?docNo:null,
      sr_no:flow==='pre_order'?docNo:null,
      sales_invoice_no:flow==='stock_sale'?docNo:null,
      sales_invoice_type:flow==='stock_sale'?invoiceType:null,
      invoice_request_status:flow==='stock_sale'?'not_needed':'not_requested',
      deposit_input_type:c.depositMode,
      deposit_input_value:c.depositValue
    };

    const {data:so,error}=await db.from('sales_orders').insert(order).select().single();
    if(error){const msg=String(error.message||'');return showToast(msg.toLowerCase().includes('duplicate')?'That SR/TK/RK number already exists.':msg,'err')}

    const items=itemRows.map(r=>{
      const lineKind=r.querySelector('.line-kind')?.value||'product';
      return {
        sales_order_id:so.id,
        line_kind:lineKind,
        product_id:lineKind==='service'?null:(r.querySelector('.product-id').value||null),
        product_code_snapshot:r.querySelector('.product-code').value,
        item_name_snapshot:r.querySelector('.product-name').value,
        image_url_snapshot:lineKind==='service'?null:(r.querySelector('.product-image').value||null),
        product_class_snapshot:r.querySelector('.product-class')?.value||null,
        product_type_snapshot:r.querySelector('.product-type')?.value||null,
        qty:Number(r.querySelector('.qty').value),
        unit_price:Number(String(r.querySelector('.unit-price').value||0).replace(',','.')),
        discount_amount:Number(r.querySelector('.line-discount').value||0),
        source_type:flow==='pre_order'?'pre_order':'stock',
        fulfillment_status:lineKind==='service'?'arrived':(flow==='pre_order'?'ordered':'arrived')
      };
    });
    if(items.some(i=>(i.line_kind!=='service'&&!i.product_id)||!i.product_code_snapshot||!i.item_name_snapshot||i.qty<=0||i.unit_price<0||i.discount_amount<0)){
      await db.from('sales_orders').delete().eq('id',so.id);
      return showToast('Please check product/service description, quantity, price and discount.','err');
    }
    const ir=await db.from('sales_order_items').insert(items);
    if(ir.error){await db.from('sales_orders').delete().eq('id',so.id);return showToast(ir.error.message,'err')}

    if(c.depositAmount>0){
      const note=c.depositMode==='percent'?`Initial deposit ${c.depositValue}%`:'Initial deposit amount';
      if(state.profile?.role==='sales'){
        const pr=await db.rpc('submit_sales_payment_request',{
          p_order_id:so.id,
          p_amount:c.depositAmount,
          p_payment_date:orderDate,
          p_method:document.getElementById('paymentMethod').value.trim()||'Deposit',
          p_reference_no:null,
          p_notes:note
        });
        if(pr.error){await db.from('sales_orders').delete().eq('id',so.id);return showToast(pr.error.message,'err')}
      }else{
        const pr=await db.from('sales_payments').insert({
          sales_order_id:so.id,
          amount:c.depositAmount,
          payment_date:orderDate,
          method:document.getElementById('paymentMethod').value.trim()||'Deposit',
          notes:note,
          received_by:state.user.id
        });
        if(pr.error){await db.from('sales_orders').delete().eq('id',so.id);return showToast(pr.error.message,'err')}
      }
    }

    if(managerContextActive()&&typeof recordManagerRepAction==='function'){
      await recordManagerRepAction('create_sales_order','sales_order',so.id,{document_no:docNo,flow_type:flow,deposit_amount:c.depositAmount});
    }
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    closeModal();
    showToast((flow==='pre_order'?`Pre-order ${docNo} created`:`${invoiceType} invoice ${docNo} created`)+(state.profile?.role==='sales'&&c.depositAmount>0?' · Deposit pending approval':''));
    await go('sales-orders');
  }

  window.openNewOrder=async function(){
    const result=await baseOpenNewOrder.apply(this,arguments);
    const form=document.getElementById('orderForm');
    if(!form)return result;

    // Never preselect a customer on a new sale.
    const customer=document.getElementById('orderCustomer');
    if(customer){
      customer.required=true;
      let ph=customer.querySelector('option[value=""]');
      if(!ph){ph=document.createElement('option');ph.value='';ph.textContent='— Select Customer —';ph.disabled=true;customer.prepend(ph)}
      ph.selected=true;customer.value='';
    }

    // Manager/Admin/Super Admin can assign the order to a Sales Rep (or themselves).
    if(canChooseRep()){
      try{
        const reps=await getAssignableReps();
        const label=[...document.querySelectorAll('#orderForm label')].find(x=>x.textContent.trim()==='Sales Rep');
        const box=label?.parentElement;
        if(box){
          const defaultId=managerContextActive()?managerRepId():state.user?.id;
          box.innerHTML=`<label class="text-xs font-semibold">Assign Sales Rep</label><select id="createOrderSalesRep" required class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="" disabled>— Select Sales Rep —</option>${reps.map(u=>`<option value="${u.user_id}" data-name="${esc(u.display_name||u.email||'')}" ${u.user_id===defaultId?'selected':''}>${esc(u.display_name||u.email||'')} — ${esc(titleCase(u.role||''))}${u.user_id===state.user?.id?' (Me)':''}</option>`).join('')}</select><div class="text-[10px] text-gray-400 mt-1">This Sales Rep will own the order in Sales Tracking.</div>`;
          const sel=document.getElementById('createOrderSalesRep');
          if(sel&&!sel.value&&reps[0])sel.value=reps[0].user_id;
        }
      }catch(err){showToast(`Could not load Sales Reps: ${err.message}`,'err')}
    }

    form.onsubmit=saveWithSelection;
    return result;
  };
})();
