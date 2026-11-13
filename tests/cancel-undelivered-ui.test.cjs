'use strict';
const {JSDOM}=require('jsdom');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const dom=new JSDOM('<div id="modalBody"></div>',{runScripts:'outside-only',url:'https://example.test'});
const w=dom.window,calls=[],toasts=[];let releaseSave,saveCalls=0;
Object.defineProperty(w.crypto,'randomUUID',{value:()=> '11111111-1111-4111-8111-111111111111',configurable:true});
const docs=[
 {source_key:'invoice_part:part1',source_kind:'invoice_part',source_id:'part1',
  document_no:'TK2610-009',customer_id:'customer1',customer_name:'B. Srey Teang',order_date:'2026-10-30',sales_rep_id:'rep1'},
 {source_key:'sr_uninvoiced:sr1',source_kind:'sr_uninvoiced',source_id:'sr1',
  document_no:'SR:2026-002 · Uninvoiced',customer_id:'customer1',customer_name:'B. Srey Teang',order_date:'2026-03-24',sales_rep_id:'rep1'}
];
w.state={profile:{role:'sales'},user:{id:'preparer'}};
w.esc=v=>String(v??'');w.titleCase=v=>v;w.money=v=>String(v);w.closeModal=()=>{};
w.showToast=(...args)=>toasts.push(args);
w.openModal=(title,body)=>{w.document.getElementById('modalBody').innerHTML=body};
w.renderReturnsPage=async()=>{};
w.db={rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='get_return_source_documents')return {data:docs};
 if(name==='get_return_source_items'){
  if(args.p_source_kind==='invoice_part')return {data:[{
   sales_order_item_id:'item1',source_order_id:'sr1',source_invoice_part_id:'part1',
   qty_sold:1,qty_returned:0,qty_available:1,item_name:'FUR0032',product_code:'FUR0032'
  }]};
  if(args.p_source_kind==='sr_uninvoiced'&&args.p_action==='cancel_undelivered')return {data:[{
   sales_order_item_id:'item2',source_order_id:'sr1',source_invoice_part_id:null,
   qty_sold:5,qty_returned:2,qty_available:3,item_name:'Uninvoiced chair',product_code:'CHAIR1'
  }]};
  return {error:{message:'SR can only cancel uninvoiced quantities'}};
 }
 if(name==='create_sales_return_multi')return {data:[{cn_no:'CN-INVOICE'}]};
 if(name==='create_undelivered_cancellation'){saveCalls++;return new Promise(resolve=>{releaseSave=resolve})}
 if(name==='get_sales_return_items_detail_v2')return {data:[{
   return_item_id:'returnItem1',sales_order_item_id:'item1',source_document_no:'TK2610-009',
   item_name:'FUR0032',qty:1,max_edit_qty:1,qty_sold:1,qty_returned_other:0,
   disposition:'return_to_stock',condition:'good',notes:'',unit_price:10,return_value:10
 }]};
 if(name==='get_cn_return_item_sources')return {data:[{return_item_id:'returnItem1',source_invoice_part_id:'part1'}]};
 if(name==='update_sales_return')return {data:null};
 return {data:[]};
}};
w.eval(fs.readFileSync(path.join(__dirname,'../sales-returns.js'),'utf8'));
w.renderReturnsPage=async()=>{}; // isolate form interactions from full dashboard rendering

(async()=>{
 await w.openNewSalesReturn();
 const form=w.document.getElementById('salesReturnForm');
 const action=w.document.getElementById('returnAction');
 assert.ok([...action.options].some(x=>x.value==='cancel_undelivered'));
 assert.ok(![...action.options].some(x=>x.value==='exchange'),'Exchange remains paused');
 assert.ok(!w.document.getElementById('returnOrderSuggestions').textContent.includes('SR:2026-002'),'Uninvoiced SR hidden during normal Return');
 await w.chooseReturnOrder('invoice_part:part1');
 assert.equal(calls.at(-1).name,'get_return_source_items');
 assert.equal(calls.at(-1).args.p_source_kind,'invoice_part');
 assert.equal(calls.at(-1).args.p_source_id,'part1');
 assert.equal(w.document.querySelector('.sales-return-item').dataset.sourceInvoicePartId,'part1');
 assert.equal(w.document.querySelector('.sales-return-item').dataset.orderId,'sr1');
 w.document.querySelector('.return-item-check').checked=true;
 await form.onsubmit({target:form,preventDefault(){}});
 let saved=calls.filter(x=>x.name==='create_sales_return_multi').at(-1);
 assert.ok(saved,'Invoice-linked CN created');
 assert.equal(saved.args.p_items[0].source_invoice_part_id,'part1','Real TK/RK part ID persists');
 assert.equal(saved.args.p_sales_order_ids[0],'sr1','Keep canonical SR accounting link, not invoice part ID');
 
 await w.openNewSalesReturn();
 const cancelAction=w.document.getElementById('returnAction');
 cancelAction.value='cancel_undelivered';await cancelAction.onchange({target:cancelAction});
 assert.ok(w.document.getElementById('returnOrderSuggestions').textContent.includes('SR:2026-002'),'Uninvoiced SR only appears for cancellation');
 await w.chooseReturnOrder('sr_uninvoiced:sr1');
 assert.equal(calls.at(-1).args.p_source_kind,'sr_uninvoiced');
 assert.equal(w.document.querySelector('.sales-return-item').dataset.max,'3');
 assert.equal(w.document.querySelector('.return-item-disposition').value,'no_stock_action');
 assert.equal(w.document.querySelector('.return-item-disposition').disabled,true);
 const cancelForm=w.document.getElementById('salesReturnForm');
 w.document.querySelector('.return-item-check').checked=true;
 w.document.querySelector('.return-item-qty').value='4';
 await cancelForm.onsubmit({target:cancelForm,preventDefault(){}});
 assert.equal(saveCalls,0);
 assert.match(toasts.at(-1)[0],/between 1 and 3/);
 w.document.querySelector('.return-item-qty').value='2';
 const firstSave=cancelForm.onsubmit({target:cancelForm,preventDefault(){}});
 await cancelForm.onsubmit({target:cancelForm,preventDefault(){}});
 assert.equal(saveCalls,1,'Duplicate submission prevented');
 const first=calls.at(-1);
 assert.equal(first.name,'create_undelivered_cancellation');
 assert.equal(first.args.p_items[0].source_invoice_part_id,null);
 assert.ok(first.args.p_request_id,'Idempotency token present');
 releaseSave({error:{message:'Network failed'}});await firstSave;
 const retry=cancelForm.onsubmit({target:cancelForm,preventDefault(){}});
 assert.equal(calls.at(-1).args.p_request_id,first.args.p_request_id);
 releaseSave({data:[{cn_no:'CN-CANCEL'}]});await retry;

 w._visibleSalesReturns=[{return_id:'cn1',cn_no:'CN-EXAMPLE',status:'confirmed',action:'return_to_stock',original_document_no:'TK2610-009'}];
 await w.openEditSalesReturn('cn1');
 const editForm=w.document.getElementById('editSalesReturnForm');
 assert.equal(w.document.querySelector('.edit-return-item').dataset.sourceInvoicePartId,'part1');
 await editForm.onsubmit({target:editForm,preventDefault(){}});
 const edited=calls.filter(x=>x.name==='update_sales_return').at(-1);
 assert.equal(edited.args.p_items[0].source_invoice_part_id,'part1','Pending CN edit keeps exact TK/RK invoice ID');
 console.log('PASS: issued TK/RK selection, separate unissued SR cancellation, quantity limits, no duplicate CN, retry ID, and invoice-scoped CN edits.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>dom.window.close());
