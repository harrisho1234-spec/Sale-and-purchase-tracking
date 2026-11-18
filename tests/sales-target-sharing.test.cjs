const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','sales-target-sharing.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function scenario(){
 const state={user:{id:'manager-1'},profile:{role:'manager'}};
 const c={state,console,Date,Intl,db:{},window:null,document:{getElementById:()=>null}};
 c.window=c;
 vm.createContext(c);vm.runInContext(source,c);
 const workspace={people:[
  {id:'staff-a',name:'Showroom + Project Staff',showroom:true,project:true,eligible:true,internal:false},
  {id:'staff-b',name:'Project without login',showroom:false,project:true,eligible:true,internal:false,source:'target_only'},
  {id:'lp1',name:'LP1',showroom:false,project:false,eligible:false,internal:true}
 ],credits:[
  {order_id:'order-a',id:'staff-a',percentage:50},
  {order_id:'order-a',id:'staff-b',percentage:50}
 ],goals:[
  {mode:'pooled',annual_target:50000,members:[{id:'staff-a'},{id:'staff-b'}]},
  {mode:'split',annual_target:50000,members:[{id:'staff-a',percentage:60},{id:'staff-b',percentage:40}]}
 ]};
 const S={year:2026,view:'year',selectedMonths:null,selectedQuarters:null,rows:[
  {order_id:'order-a',order_date:'2026-11-01',sales_rep_id:'staff-a',business_code:'RK',actual_sales:20000},
  {order_id:'order-a',order_date:'2026-11-02',sales_rep_id:'staff-a',business_code:'RK',actual_sales:-2000},
  {order_id:'order-b',order_date:'2026-11-03',sales_rep_id:'staff-a',business_code:'TK',actual_sales:6000},
  {order_id:'order-c',order_date:'2026-11-04',sales_rep_id:'lp1',business_code:'TK',actual_sales:4000},
  {order_id:'order-d',order_date:'2026-11-06',sales_rep_id:'staff-b',business_code:'OTHER',actual_sales:9000}
 ]};
 c.__sharedTargetMath.setState(S,workspace,{months:Array(12).fill(100/12)});
 return {c,workspace,S};
}
test('shared credit is split across departments without duplicate company actual',()=>{
 const {c}=scenario(),r=c.__sharedTargetMath.earnedCredit();
 assert.equal(r.companyActual,28000);
 assert.equal(r.credits.get('staff-a'),15000);
 assert.equal(r.credits.get('staff-b'),9000);
 assert.equal(r.attributed,24000);
 assert.equal(r.companyActual-r.attributed,4000,'LP1 internal spending is unattributed');
 const members=['staff-a','staff-b'];
 assert.equal(members.reduce((sum,id)=>sum+(r.credits.get(id)||0),0),24000);
});
test('one person in Showroom and Project has one credited identity',()=>{
 const {c,workspace}=scenario();
 assert.equal(workspace.people.filter(p=>p.id==='staff-a').length,1);
 const totals=c.__sharedTargetMath.earnedCredit().credits;
 assert.equal(totals.size,2);
 assert.equal(totals.get('staff-a'),15000);
});
test('recognized event periods and negative returns retain existing actual-sales arithmetic',()=>{
 const {c,S,workspace}=scenario();
 S.view='month';S.selectedMonths=new Set([11]);
 c.__sharedTargetMath.setState(S,workspace,{months:Array(12).fill(100/12)});
 assert.equal(c.__sharedTargetMath.earnedCredit().companyActual,28000);
 assert.ok(Math.abs(c.__sharedTargetMath.yearWeight(S)-1/12)<0.00001);
 S.selectedMonths=new Set([10]);
 assert.equal(c.__sharedTargetMath.earnedCredit().companyActual,0);
});
test('project sale category takes precedence, non-target categories are excluded',()=>{
 const {c}=scenario(),f=c.__sharedTargetMath.kind;
 assert.equal(f({business_code:'RK',sales_category:'project'}),'PJ');
 assert.equal(f({business_code:'TK'}),'TK');
 assert.equal(f({business_code:'OTHER'}),'OTHER');
});
test('credit can be assigned to staff without login and cannot credit internal profiles',()=>{
 const {c,workspace,S}=scenario();
 workspace.credits.push({order_id:'order-c',id:'staff-b',percentage:100});
 c.__sharedTargetMath.setState(S,workspace,{months:Array(12).fill(100/12)});
 const r=c.__sharedTargetMath.earnedCredit();
 assert.equal(r.credits.get('staff-b'),13000);
 assert.equal(r.companyActual,r.attributed);
});
test('target sharing UI loads after existing Sales Target module without replacing it',()=>{
 const old=html.indexOf('sales-targets.js?');
 const added=html.indexOf('sales-target-sharing.js?');
 assert.ok(old>=0 && added>old);
 assert.match(source,/window\.renderSalesTargetsPanel=function\(S\)/);
});
test('migration enforces private RLS, exact splits, audit, and admin approval',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261118_cross_department_shared_targets_and_credit.sql'),'utf8');
 for(const table of ['sales_target_staff_settings','sales_target_shared_goals','sales_target_credit_requests','sales_target_credit_shares','sales_target_credit_audit']){
  assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security'));
  assert.match(sql,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated'));
 }
 assert.match(sql,/abs\(v_total-100\)>0\.0001/);
 assert.match(sql,/abs\(v_sum-100\)>0\.0001/);
 assert.match(sql,/r\.requested_by=auth\.uid\(\)/);
 assert.match(sql,/public\.current_app_role\(\) not in \('admin','super_admin'\)/);
 assert.match(sql,/get_sales_report_rows_v6/);
 assert.doesNotMatch(sql,/update public\.sales_orders/i);
 assert.doesNotMatch(sql,/update public\.sales_payments/i);
});