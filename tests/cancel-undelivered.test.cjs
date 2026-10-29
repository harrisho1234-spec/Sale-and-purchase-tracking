const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let serial=100,checks=0;
const q=(sql,args=[])=>db.query(sql,args);
const scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const eq=(a,b)=>{assert.equal(a,b);checks++};
async function denied(fn,re){await assert.rejects(fn,re);checks++}
async function user(n=1,role='sales',permission=true){await q("select set_config('test.uid',$1,false),set_config('test.role',$2,false),set_config('test.permission',$3,false)",[id(n),role,String(permission)])}
async function fixture({qty=10,price=100,paid=0,delivered=0,status='arrived',discount=0,orderDiscount=0,preorder=false}={}){
 const customer=id(serial++),order=id(serial++),item=id(serial++),product=id(serial++);
 await q('insert into customers values($1,$2)',[customer,'Fixture customer']);
 await q('insert into sales_orders(id,customer_id,order_discount,sales_flow_type,order_type,sales_invoice_no) values($1,$2,$3,$4,$4,$5)',[order,customer,orderDiscount,preorder?'pre_order':'stock',preorder?null:'INV-TEST']);
 await q('insert into sales_order_items(id,sales_order_id,product_id,qty,unit_price,discount_amount,fulfillment_status,source_type) values($1,$2,$3,$4,$5,$6,$7,$8)',[item,order,product,qty,price,discount,status,preorder?'pre_order':'stock']);
 await q('insert into sales_item_status_quantities(sales_order_item_id,status,qty) values($1,$2,$3)',[item,status,qty-delivered]);
 if(delivered){await q("insert into stock_movements(reference_item_id,reference_type,movement_type,qty) values($1,'sales_order_item','sale_delivery',$2)",[item,delivered]);await q("insert into sales_item_status_quantities(sales_order_item_id,status,qty) values($1,'delivered',$2)",[item,delivered])}
 if(paid)await q("insert into sales_payments(sales_order_id,amount,notes) values($1,$2,'Original deposit')",[order,paid]);
 return {customer,order,item,product};
}
async function create(f,qty,action='cancel_undelivered',disposition='no_stock_action'){
 await user();
 return (await q("select * from create_sales_return_multi($1::uuid[],null,current_date,$2,'Test',null,$3::jsonb)",[[f.order],action,JSON.stringify([{sales_order_item_id:f.item,qty,disposition}])])).rows[0].return_id;
}
async function approve(cn){await user(2,'manager');return scalar('select review_cn_case($1,true,null)',[cn])}
async function snapshot(table){return scalar(`select coalesce(jsonb_agg(t order by id),'[]') from ${table} t`)}
(async()=>{
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/cn-contract.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/cn-reservations.sql'),'utf8'));
 await db.exec('set check_function_bodies=on');
 // A historical sentinel exists before deployment. Applying DDL must not rewrite it.
 await user();await q('insert into app_users values($1),($2)',[id(1),id(2)]);
 const legacy=await fixture();const legacyId=await create(legacy,1,'exchange','exchange');
 await q("update sales_returns set cn_no='CN-2026-024' where id=$1",[legacyId]);
 const before=await snapshot('sales_returns');
 await db.exec(fs.readFileSync(path.join(__dirname,'../database/cancel-undelivered-items.sql'),'utf8'));
 assert.deepEqual(await snapshot('sales_returns'),before);checks++;

 const f=await fixture({paid:300});const payments=await snapshot('sales_payments'),stock=await snapshot('stock_movements');
 const cn=await create(f,4);
 eq(Number(await scalar('select reserved_qty from inventory_reservation_lines() where sales_order_item_id=$1',[f.item])),10);
 eq(Number(await scalar('select balance_due from sales_order_summary where id=$1',[f.order])),700);
 await denied(()=>q('select review_cn_case($1,true,null)',[cn]),/permission/i);
 await user(1,'manager');await denied(()=>q('select review_cn_case($1,true,null)',[cn]),/own CN/);
 await user(2,'manager',false);await denied(()=>q('select review_cn_case($1,true,null)',[cn]),/permission/i);
 await approve(cn);
 eq(Number(await scalar('select balance_due from sales_order_summary where id=$1',[f.order])),300);
 eq(Number(await scalar("select qty from sales_item_status_quantities where sales_order_item_id=$1 and status='cancelled'",[f.item])),4);
 eq(Number(await scalar('select qty from sales_order_items where id=$1',[f.item])),10);
 eq(Number(await scalar('select reserved_qty from inventory_reservation_lines() where sales_order_item_id=$1',[f.item])),6);
 eq(await scalar('select financial_decision from cn_case_workflows where sales_return_id=$1',[cn]),'credit_ar');
 eq(await scalar('select closed_at is not null from cn_case_workflows where sales_return_id=$1',[cn]),true);
 assert.deepEqual(await snapshot('sales_payments'),payments);checks++;
 assert.deepEqual(await snapshot('stock_movements'),stock);checks++;
 const creditCount=await scalar('select count(*) from sales_credit_applications where sales_return_id=$1',[cn]);
 await q("select set_sales_return_financial_treatment($1,'credit_ar')",[cn]);
 eq(await scalar('select count(*) from sales_credit_applications where sales_return_id=$1',[cn]),creditCount);
 await denied(()=>approve(cn),/already reviewed/);
 await denied(()=>q("select set_sales_return_financial_treatment($1,'none')",[cn]),/immutable/);
 await denied(()=>q("delete from sales_item_status_quantities where sales_order_item_id=$1 and status='cancelled'",[f.item]),/cannot be reopened/);
 await denied(()=>q("insert into stock_movements(reference_item_id,reference_type,movement_type,qty) values($1,'sales_order_item','sale_delivery',7)",[f.item]),/uncancelled/);
 const ri=await scalar('select id from sales_return_items where sales_return_id=$1',[cn]);
 await denied(()=>q("insert into stock_movements(reference_item_id,reference_type,movement_type,qty) values($1,'sales_return_item','return',4)",[ri]),/never create stock/);
 await denied(()=>q("insert into cn_stock_receipt_requests(id,sales_return_id,sales_return_item_id,status) values(gen_random_uuid(),$1,$2,'pending')",[cn,ri]),/do not have warehouse/);
 await denied(()=>q("insert into cn_exchange_hold_requests(id,sales_return_item_id,status) values(gen_random_uuid(),$1,'pending')",[ri]),/do not have warehouse/);
 const queue=await scalar('select get_cn_stock_receipt_queue()');eq(queue.some(x=>x.return_id===cn),false);eq(queue.some(x=>x.return_id===legacyId),true);
 eq(await scalar('select cn_case_stock_complete($1)',[legacyId]),false);
 await denied(()=>q("update sales_returns set action='cancel_undelivered' where id=$1",[legacyId]),/new CN/);

 const paid=await fixture({paid:900});const pc=await create(paid,4);await approve(pc);
 eq(Number(await scalar('select balance_due from sales_order_summary where id=$1',[paid.order])),0);
 const result=await scalar("select set_sales_return_financial_treatment($1,'credit_ar')",[pc]);eq(Number(result.available_credit),300);eq(Number(result.applied_amount),100);
 const full=await fixture({paid:1000});const fc=await create(full,2);await approve(fc);
 eq(Number((await scalar("select set_sales_return_financial_treatment($1,'credit_ar')",[fc])).available_credit),200);
 const pre=await fixture({preorder:true,paid:200});const preCn=await create(pre,3);await approve(preCn);
 eq(Number(await scalar('select balance_due from sales_order_summary where id=$1',[pre.order])),500);
 const po=id(serial++),poi=id(serial++);
 await q("insert into supplier_pos values($1,'received')",[po]);
 await q('insert into supplier_po_items values($1,$2,$3)',[poi,po,pre.product]);
 await q('insert into fulfillment_links values($1,$2,$3,10)',[id(serial++),pre.item,poi]);
 await q("insert into stock_movements(reference_item_id,reference_type,movement_type,qty) values($1,'supplier_po_item','po_receipt',10)",[poi]);
 eq(Number(await scalar('select reserved_qty from inventory_reservation_lines() where sales_order_item_id=$1',[pre.item])),7);
 const discounted=await fixture({discount:100,orderDiscount:90});const dc=await create(discounted,2);await approve(dc);
 eq(Number(await scalar('select credit_amount from sales_returns where id=$1',[dc])),162);
 // Allocation uses the approved per-source snapshot even if pricing changes later.
 await q('update sales_order_items set unit_price=200 where id=$1',[discounted.item]);
 await q('select rebuild_sales_return_credit_allocations($1)',[dc]);
 eq(Number(await scalar('select sum(amount) from sales_credit_applications where sales_return_id=$1',[dc])),162);

 const partial=await fixture({delivered:4});await denied(()=>create(partial,7),/undelivered/);
 const partCn=await create(partial,6);await denied(()=>create(partial,1),/undelivered|remaining/);await approve(partCn);
 eq(Number(await scalar('select cn_cancellable_qty($1)',[partial.item])),0);
 const hist=await fixture();await q('insert into customer_fulfillment_reconciliations values($1,8,null)',[hist.item]);
 await denied(()=>create(hist,3),/undelivered/);
 const delivered=await fixture({status:'delivered'});await denied(()=>create(delivered,1),/undelivered/);
 const pending=await fixture();const pendingCn=await create(pending,3);
 await q("insert into stock_action_requests(action_type,status,payload) values('sales_delivery','pending',$1)",[JSON.stringify({sales_order_item_id:pending.item})]);
 await denied(()=>approve(pendingCn),/pending stock release/);
 eq(await scalar('select approval_status from cn_case_workflows where sales_return_id=$1',[pendingCn]),'pending');
 eq(Number(await scalar("select coalesce(sum(qty),0) from sales_item_status_quantities where sales_order_item_id=$1 and status='cancelled'",[pending.item])),0);
 const stale=await fixture();const staleCn=await create(stale,6);
 await q("insert into stock_movements(reference_item_id,reference_type,movement_type,qty) values($1,'sales_order_item','sale_delivery',5)",[stale.item]);
 await denied(()=>approve(staleCn),/undelivered/);
 const rejected=await fixture();const rejectCn=await create(rejected,10);await user(2,'manager');await q('select review_cn_case($1,false,\'No\')',[rejectCn]);
 const next=await create(rejected,10);await approve(next);
 await denied(async()=>create(await fixture(),1,'cancel_undelivered','return_to_stock'),/cannot receive stock/);
 const free=await fixture({price:0});const freeCn=await create(free,1);await approve(freeCn);
 eq(Number(await scalar('select credit_amount from sales_returns where id=$1',[freeCn])),0);
 eq(await scalar('select closed_at is not null from cn_case_workflows where sales_return_id=$1',[freeCn]),true);
 // Cent rounding is cumulative across successive partial cancellations.
 const cents=await fixture({qty:3,price:0.333333333333});
 for(let k=0;k<3;k++)await approve(await create(cents,1));
 eq(Number(await scalar('select sum(credit_amount) from sales_returns where sales_order_id=$1',[cents.order])),1);
 // Multi-invoice allocation cannot move one source's excess onto another source.
 const multi=await fixture({paid:900}),other=await fixture({price:200});
 await q('update sales_orders set customer_id=$1 where id=$2',[multi.customer,other.order]);
 await user();
 const mc=(await q("select * from create_sales_return_multi($1::uuid[],null,current_date,'cancel_undelivered',null,null,$2::jsonb)",[[multi.order,other.order],JSON.stringify([
   {sales_order_item_id:multi.item,qty:4,disposition:'no_stock_action'},
   {sales_order_item_id:other.item,qty:2,disposition:'no_stock_action'}])])).rows[0].return_id;
 await approve(mc);
 eq(Number(await scalar('select amount from sales_credit_applications where sales_return_id=$1 and sales_order_id=$2',[mc,other.order])),400);
 eq(Number((await scalar("select set_sales_return_financial_treatment($1,'credit_ar')",[mc])).available_credit),300);
 // Invalid line rolls the entire request back, including its valid first line.
 const beforeCount=await scalar('select count(*) from sales_returns');await user();
 await denied(()=>q("select * from create_sales_return_multi($1::uuid[],null,current_date,'cancel_undelivered',null,null,$2::jsonb)",[[multi.order,other.order],JSON.stringify([
   {sales_order_item_id:multi.item,qty:1,disposition:'no_stock_action'},
   {sales_order_item_id:other.item,qty:99,disposition:'no_stock_action'}])]),/quantity/);
 eq(await scalar('select count(*) from sales_returns'),beforeCount);
 // Access boundaries on new privileged helpers and tables.
 const retryFixture=await fixture();await user();const requestId=id(serial++);
 const requestArgs=[requestId,[retryFixture.order],JSON.stringify([{sales_order_item_id:retryFixture.item,qty:2,disposition:'no_stock_action'}])];
 const retrySql="select * from create_undelivered_cancellation($1,$2::uuid[],null,current_date,null,null,$3::jsonb)";
 const firstRequest=(await q(retrySql,requestArgs)).rows[0];
 assert.deepEqual((await q(retrySql,requestArgs)).rows[0],firstRequest);checks++;
 await denied(()=>q(retrySql,[requestId,[retryFixture.order],JSON.stringify([{sales_order_item_id:retryFixture.item,qty:3,disposition:'no_stock_action'}])]),/different request/);
 await approve(firstRequest.return_id);await user();
 assert.deepEqual((await q(retrySql,requestArgs)).rows[0],firstRequest);checks++;
 const editable=await fixture({delivered:5});const editCn=await create(editable,2);
 await q("select update_sales_return($1,current_date,'cancel_undelivered',null,null,$2::jsonb)",[editCn,JSON.stringify([{sales_order_item_id:editable.item,qty:3,disposition:'no_stock_action'}])]);
 eq(Number(await scalar('select qty from sales_return_items where sales_return_id=$1',[editCn])),3);
 await denied(()=>q("select update_sales_return($1,current_date,'cancel_undelivered',null,null,$2::jsonb)",[editCn,JSON.stringify([{sales_order_item_id:editable.item,qty:6,disposition:'no_stock_action'}])]),/undelivered/);
 eq(Number(await scalar('select qty from sales_return_items where sales_return_id=$1',[editCn])),3);
 await denied(()=>create(editable,0.5),/undelivered/);
 // A repeated physical Exchange still waits for actual intake and a separate credit decision.
 const exchange=await fixture({delivered:2});const exchangeCn=await create(exchange,2,'exchange','exchange');
 await approve(exchangeCn);
 eq(await scalar('select status from sales_returns where id=$1',[exchangeCn]),'confirmed');
 eq(await scalar('select financial_effect from sales_returns where id=$1',[exchangeCn]),'none');
 eq(Number(await scalar('select count(*) from cn_undelivered_postings where sales_return_id=$1',[exchangeCn])),0);
 eq(await scalar("select has_function_privilege('authenticated','public.post_undelivered_cn(uuid)','EXECUTE')"),false);
 eq(await scalar("select has_function_privilege('anon','public.rebuild_sales_return_credit_allocations(uuid)','EXECUTE')"),false);
 eq(await scalar("select has_function_privilege('authenticated','public.rebalance_customer_credits(uuid)','EXECUTE')"),false);
 eq(await scalar("select has_table_privilege('authenticated','public.cn_undelivered_postings','INSERT')"),false);
 await user();await q("select set_config('test.uid','',false)");
 await denied(()=>q('select * from get_cancellable_order_items($1)',[multi.order]),/Access denied/);
 // Historical sentinel is unchanged after all new workflow activity.
 assert.deepEqual((await snapshot('sales_returns')).find(x=>x.id===legacyId),before.find(x=>x.id===legacyId));checks++;
 console.log(`PASS: ${checks} database assertions (isolated PostgreSQL).`);
})().catch(e=>{console.error(e.message,e.where||'',e.position||'');process.exitCode=1}).finally(()=>db.close());
