// English-only Help Center and repeatable, optional, role-aware staff training.
// All instructions are read-only. Help never grants access to restricted pages.
(function(){
'use strict';
const VER=1, progressTable='app_help_training_progress', guideTable='app_help_guide_content';
const all=['sales','stock_controller','accountant','manager','admin','super_admin'];
const sales=['sales','manager','admin','super_admin'];
const stock=['stock_controller','manager','admin','super_admin'];
const management=['manager','admin','super_admin'];
const admins=['admin','super_admin'];
const GUIDE_DATA=[
 {id:'getting-started',section:'Getting Started',title:'Find your way around the system',summary:'Dashboard, navigation, account access and quick help.',roles:all,page:'dashboard',
  steps:['Sign in using your assigned work account.','Use the left sidebar (Menu on mobile) to open an area of the system.','Only pages you have permission to use will appear. Ask management if an expected button is unavailable.','Use the search and date filters on each screen instead of re-entering records.','Select Help & Guides under More—or the ? button in the header—to reopen these instructions at any time.'],
  caution:'Completing a training tour does not change permissions or approve transactions.'},
 {id:'sales-customer',section:'Sales & Customers',title:'Create and manage a customer',summary:'Look up existing customers before creating new customer records.',roles:sales,page:'customers',
  steps:['Open Customers or Customer Database, depending on your access.','Search by phone number, name or existing customer record before creating another entry.','Enter complete contact details; a telephone number helps identify the customer and avoids duplication.','Assign the Sales person according to your role permissions.','Use the customer history to review orders, invoices, returns and follow-ups before creating new documents.'],
  caution:'Customer access can be restricted to the assigned salesperson. Linking or converting customer records may require Manager/Admin approval.'},
 {id:'sales-quotation',section:'Sales & Customers',title:'Create a quotation',summary:'Prepare a quotation with product codes, quantities and customer details.',roles:sales,page:'quotation-imports',
  steps:['Open the Quotation section (or the connected L’Imperial Showroom quotation workflow).','Search products by code or name and check the product images, available stock and prices.','Set each quantity and discount, then add the customer name and Salesperson.','Review the quotation and save it before sending to the customer.','For changes to a saved quotation, use the revision process so history is preserved.','If importing a quotation into Sales Orders, match the customer in the database and complete required TK/RK fields.'],
  caution:'A quotation is not an official Sales Order or invoice until the required conversion and approvals are completed.'},
 {id:'sales-sr',section:'Sales & Customers',title:'Create an SR / Pre-order',summary:'Create a Sales Request and link procurement and deposits.',roles:sales,page:'sales-orders',
  steps:['Open Sales Orders and choose New Sales Order.','Select the correct customer and choose the Pre-order / SR flow.','Add existing catalog products, codes and quantities. Enter customer requirements and order date.','Save the SR; it retains its own SR document number.','Record any deposit through the authorized Deposit/Payment workflow.','Link the appropriate Supplier PO items where purchasing is required, and follow each product status until Ready/Arrived.'],
  caution:'An SR is not the same as an issued TK/RK invoice. Do not create a duplicate invoice to record an existing SR.'},
 {id:'sr-tkrk',section:'Sales & Customers',title:'Convert SR → TK/RK (partial or combined)',summary:'One SR to several invoices—or several SRs from one customer to one invoice.',roles:sales,page:'sales-orders',
  steps:['Open the original SR in Sales Tracking, then choose Prepare TK/RK.','Select the TK/RK type and invoice number. Choose only items and quantities ready to invoice.','For one SR → multiple invoices, submit only the selected quantities and prepare a later invoice for remaining quantities.','For multiple SRs → one invoice, choose Add Another SR. Only SRs from the exact same Customer Database record and currency can be included.','For complimentary LEDs, use Add Extra Items → Free Gift, search an existing product code and enter a whole-number quantity; it is invoiced at $0.','Submit for independent Manager/Admin approval. The preparer cannot approve their own request.','After approval, the invoice appears as SR → TK/RK. Original SRs, payments, deposits and DO histories remain separate.'],
  caution:'Do not mix customers or over-invoice remaining quantities. Free gifts require a normal DO and approved stock release. Consolidated SR deposits are not automatically reassigned.'},
 {id:'request-do',section:'Stock & Delivery',title:'Request and release a Delivery Order (DO)',summary:'Request a DO for ordered items; warehouse prepares and releases stock.',roles:sales.concat(['stock_controller']).filter((x,i,a)=>a.indexOf(x)===i),page:'sales-orders',
  steps:['Open the customer Sales Order/SR and locate Customer Fulfillment or Request DO.','Choose only items and quantities to deliver, and enter the required delivery date.','Submit the DO request. Stock staff should see the corresponding pending request.','Stock Controller verifies the product, physical stock location and requested quantity.','Authorized approvers review the request; warehouse prepares/releases the approved DO.','Only the approved release/OUT reduces available stock. Confirm delivery separately when received by the customer.'],
  caution:'Stock OUT must reference an authorized customer Sales Order/DO. Partial deliveries remain traceable to the original item and SR.'},
 {id:'stock-operations',section:'Stock & Delivery',title:'Stock transfers, counts and adjustments',summary:'Use actual locations and required approvals for movements.',roles:stock,page:'stock-inventory',
  steps:['Open Stock & Inventory and search the product by its Code.','For a transfer, choose an origin location that actually has available quantity.','Select the destination and enter a quantity within the origin location’s available balance.','For stock count, record physical quantities and use Save as Draft until ready to submit.','If a submitted count is incorrect, request an edit with the correct product, month or date rather than silently changing history.','For customer shipments, use the DO workflow instead of manual stock OUT.'],
  caution:'Transfers do not create sales. Quantity changes must follow the configured approval process and be recorded in Stock Movement history.'},
 {id:'stock-po',section:'Stock & Delivery',title:'Receive products from a Supplier PO',summary:'Match received quantities against original Purchase Order lines.',roles:stock,page:'procurement',
  steps:['Open Procurement or Supplier POs, depending on access.','Locate the original Supplier PO and confirm expected product Codes and quantities.','Record arrivals and the receiving storage location accurately.','Check for partial arrivals and avoid posting more than the quantities physically received.','Confirm stock movements and update item status so Sales can prepare eligible TK/RK invoices.'],
  caution:'Do not manually create extra stock for goods already received through a PO. Use the PO and movement history to investigate discrepancies.'},
 {id:'return-cn',section:'Payments & Returns',title:'Customer returns and Credit Notes (CN)',summary:'Sales creates a CN; Stock receives and verifies the physical returned goods.',roles:sales.concat(['stock_controller']).filter((x,i,a)=>a.indexOf(x)===i),page:'returns',
  steps:['Sales locates the original invoice and creates a Credit Note with the correct product, quantity and return reason.','Choose Return to Stock only for items intended to re-enter saleable inventory. Other dispositions may require separate handling.','After Sales submits the CN, Stock & Inventory → CN Returns Pending shows it immediately as Awaiting CN Approval. Stock can see it but cannot receive it yet.','Manager/Admin opens Returns / CN and approves or rejects the CN. Rejected CNs must be corrected and resubmitted before stock intake.',
  'After CN approval, Stock Controller opens My Requests → CN / Return Stock Receipts, confirms the physical return and requests a receipt.','Check the CN Handling. Return to Stock and Exchange both support inspected Good items returning to inventory through approved Stock IN. For Exchange, open Stock → CN / Return Stock Receipts → Exchanges; select Good → Request Stock IN or Damaged → Request Hold. No Stock Action cannot create stock.','Admin/Super Admin approves either Good exchange Stock IN or damaged/defective Hold. Good adds saleable stock exactly once; damaged hold records a separate physical location without increasing available inventory. Deliver any replacement using its own Sales Order/DO. CN financial credit remains separate.','After stock completion, Manager/Admin explicitly applies Customer Credit or selects Close Without Credit. Case Closed is automatic only when approval, stock handling and the financial decision are complete.'],
  caution:'Creating or marking a CN Received does NOT increase stock. Damaged items must not be added to available saleable stock. Avoid using a general manual RETURN for the same CN.'},
 {id:'payments',section:'Payments & Returns',title:'Record a deposit or customer payment',summary:'Apply money received to the correct customer and SR/invoice.',roles:sales.concat(['accountant']).filter((x,i,a)=>a.indexOf(x)===i),page:'payments',
  steps:['Open the customer Sales Order and choose Deposit/Payment, or open Payments if your role allows it.','Check the customer, SR or invoice reference and remaining balance.','Enter the actual amount, payment date, method and reference.','Submit the request if approval is required for your role.','Check the resulting payment history and outstanding balance for duplicates.'],
  caution:'A credit note is not cash collected. Do not post the same customer deposit once per linked TK/RK invoice.'},
 {id:'approve-invoices',section:'Management',title:'Review SR → TK/RK approval requests',summary:'Verify invoice number, products, partial quantities, customer and free gifts.',roles:management,page:'approvals',
  steps:['Open the Approvals section and locate pending SR → TK/RK conversion requests.','Confirm the invoice number and whether it includes one or more source SRs.','For combined invoices, verify that every SR belongs to the same customer and uses the same currency.','Review remaining quantities, approved prices, original discounts and proposed free gifts.','Approve or reject with a meaningful note. The original preparer cannot approve their own request.','After issuing, review each original SR’s linked TK/RK and any remaining uninvoiced quantities.'],
  caution:'Invoice approval does not deduct physical stock. Free gifts become stock-tracked SR items and still require a Delivery Order.'},
 {id:'approve-do-returns',section:'Management',title:'Approve DO and stock receipt requests',summary:'Review physical stock movements, DO release and customer return receipts.',roles:admins,page:'approvals',
  steps:['Open pending management approvals or Stock action approvals.','Review the requested DO quantity and the selected inventory location against available stock.','For a Credit Note return, check the original CN, product, actual received good quantity and receiving location.','Approve or reject the request; rejection returns it to the correction workflow.','Check the Movement History for the approved OUT or RETURN and confirm that no duplicate movement occurred.'],
  caution:'Do not approve damaged returned goods into saleable inventory; inspect and handle them separately.'},
 {id:'management-activity',section:'Management',title:'Review daily Sales Activity',summary:'See recorded work by date, salesperson and action type.',roles:management,page:'sales-activity',
  steps:['Open Management → Sales Activity.','Select Today, 7 Days, 30 Days or your own date range.','Filter by salesperson and type such as customer follow-up, SR, payment or DO.','Open the relevant Sales Order or customer record for details when available.','Use the history for coaching and follow-up, not as proof that work outside the app did not happen.'],
  caution:'Manager permission is limited to Sales-role staff. Activities without a recorded actor or performed outside the app cannot be inferred.'},
 {id:'user-access',section:'Management',title:'Manage roles and user permissions',summary:'Set staff access to specific areas and approval actions.',roles:admins,page:'users',
  steps:['Open Users & Access (Super Admin only, unless a separately authorized user-administration capability is enabled).','Search the employee and open User permissions.','Under Area & activity access, choose exactly the actions the employee needs.','For SR conversion, Prepare SR → TK/RK is distinct from Approve & issue SR → TK/RK.','Save the change, ask the employee to refresh, then test with their own account.'],
  caution:'No one should use Help to bypass role permissions. Super Admin accounts and protected permissions remain reserved for Super Admin.'},
 {id:'reports',section:'Management',title:'Read Sales and collection reports',summary:'Understand sales targets, collections, returns and outstanding balances.',roles:management,page:'reports',
  steps:['Open Reports and choose the month, quarter or year.','Use Company and Sales Rep filters where permitted.','Review actual sales, cash collection and active receivables separately.','Check linked SR → TK/RK numbers; one SR may have several invoices, and several SRs may share one invoice.','Avoid summing duplicated invoice labels as new Sales Orders—original SR amounts and payments remain the source of truth.'],
  caution:'Estimated pre-order balances, collected cash and approved customer credit are different figures.'},
 {id:'troubleshooting',section:'Help & Support',title:'Troubleshooting common problems',summary:'Missing buttons, pending approvals, stale data and quantity mismatches.',roles:all,page:'help',
  steps:['Button is missing: confirm you are signed in as the right employee and check User & Access permissions with management.','Recently published change not visible: refresh the page (Ctrl + Shift + R on desktop) and reopen the record.','DO request not appearing: verify the request was submitted (not only saved), and check delivery date and approval status.','Cannot convert SR: confirm it is eligible, items are Ready/Arrived and requested quantities are not already invoiced.','Wrong stock quantity: review location-specific movement history, pending approvals and PO receiving before requesting a correction.','Still stuck: send the document number, an error screenshot and steps taken to your Manager or system administrator.'],
  caution:'Do not delete real transactions or manually increase stock as a troubleshooting shortcut.'},
 {id:'whats-new',section:'Help & Support',title:'What’s New in the app',summary:'Recent Sales, inventory, management and workflow improvements.',roles:all,page:'help',
  steps:['SR → TK/RK links now use the recognizable SR → invoice arrow style and support searches by either document number.','Partial invoicing supports one SR → multiple TK/RK and multiple SRs from the same customer → one invoice.','Free gift products such as LEDs can be included on TK/RK at $0 and require normal DO stock release.','Sales Activity provides permission-controlled daily recorded activity with date and salesperson filters.','CN-linked customer return receipts require stock inspection and approval before quantities return to saleable inventory.','Help & Guides and this guided tour are available anytime—training never blocks your work.'],
  caution:'Feature availability depends on your account permissions and on each document’s eligibility.'}
];
const roleTitles={sales:'Sales',stock_controller:'Stock Controller',accountant:'Accountant',manager:'Manager',admin:'Admin',super_admin:'Super Admin'};
const heading={dashboard:'getting-started',customers:'sales-customer','customer-database':'sales-customer',
 'sales-orders':'sales-sr',tracking:'sr-tkrk', 'quotation-imports':'sales-quotation',
 'stock-inventory':'stock-operations','supplier-pos':'stock-po',procurement:'stock-po',
 'returns':'return-cn',payments:'payments',approvals:'approve-invoices',
 'sales-activity':'management-activity',reports:'reports',users:'user-access',
 'sales-access':'user-access',help:'getting-started'};
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const model={tab:'all',query:'',open:null,edits:new Map(),progress:null,progressLoaded:false,progressError:false,
 role:'',tour:null,firstOfferShown:false,searchSeq:0};
const userRole=()=>String(state?.profile?.role||'');
const userId=()=>String(state?.user?.id||'');
const permissionPage=id=>{
 if(!id||id==='help')return true;
 return typeof window.canAccessAppPage==='function'?window.canAccessAppPage(id):true;
};
function rolePage(g){
  // DO and CN actions live in different areas for Sales and warehouse roles.
  if(userRole()==='stock_controller'&&['request-do','return-cn'].includes(g.id))
    return 'stock-inventory';
  return g.page;
}
function visible(g){
 // Reading role-relevant instructions is safe even if an operational page
 // is unavailable. The 'Open Related Area' action checks permissions.
 return g.roles.includes(userRole());
}
function guides(){
 return GUIDE_DATA.filter(visible).map(g=>({...g,...(model.edits.get(g.id)||{}),page:rolePage(g)}));
}
function guide(id){return guides().find(x=>x.id===id)||null}
const editAllowed=()=>userRole()==='super_admin' ||
 (['admin','manager'].includes(userRole())&&typeof window.hasAppPermission==='function'&&window.hasAppPermission('help.manage'));

async function loadEdits(){
 if(!userId())return;
 const r=await db.from(guideTable).select('guide_id,title,summary,steps,cautions,media_url,updated_at');
 if(r.error){console.warn('Help guides read:',r.error.message);return}
 model.edits=new Map((r.data||[]).map(g=>[g.guide_id,{
   title:g.title,summary:g.summary,cautions:g.cautions,media_url:g.media_url||'',
   steps:Array.isArray(g.steps)?g.steps.filter(x=>typeof x==='string').slice(0,18):[]
 }]));
}
function storageKey(){return 'limperial_help_training_v1_'+userId()}
function readLocal(){
 try{return JSON.parse(localStorage.getItem(storageKey())||'null')}catch(_){return null}
}
function putLocal(v){try{localStorage.setItem(storageKey(),JSON.stringify(v))}catch(_){}}
async function loadProgress(){
 if(model.progressLoaded)return model.progress;
 if(!userId())return null;
 const r=await db.from(progressTable).select('*').eq('user_id',userId()).maybeSingle();
 if(r.error){
   console.warn('Help progress database:',r.error.message);
   model.progressError=true;
   model.progress=readLocal();
 }else{
   model.progress=r.data||readLocal();
 }
 model.progressLoaded=true;
 return model.progress;
}
async function saveProgress(changes){
 if(!userId())return;
 const prev=model.progress||{};
 const row={
   user_id:userId(),tour_version:VER,role_key:userRole(),
   next_step:Number(changes.next_step??prev.next_step??0),
   started_at:changes.started_at!==undefined?changes.started_at:(prev.started_at||null),
   completed_at:changes.completed_at!==undefined?changes.completed_at:(prev.completed_at||null),
   dismissed_at:changes.dismissed_at!==undefined?changes.dismissed_at:(prev.dismissed_at||null),
   updated_at:new Date().toISOString()
 };
 model.progress=row;putLocal(row);
 const r=await db.from(progressTable).upsert(row,{onConflict:'user_id'});
 if(r.error)console.warn('Help training progress sync:',r.error.message);
}
function tourGuides(){
 const role=userRole();
 const ids=role==='sales'?['getting-started','sales-customer','sales-quotation','sales-sr','sr-tkrk','request-do','return-cn']:
 role==='stock_controller'?['getting-started','stock-operations','stock-po','request-do','return-cn']:
 role==='accountant'?['getting-started','payments','troubleshooting']:
 role==='manager'?['getting-started','sales-customer','sr-tkrk','approve-invoices','management-activity','reports','troubleshooting']:
 role==='admin'||role==='super_admin'?['getting-started','sales-sr','sr-tkrk','approve-invoices','approve-do-returns','management-activity','user-access','reports']:
 ['getting-started','troubleshooting'];
 return ids.map(id=>guide(id)).filter(Boolean);
}
function buttons(){
 return '<button type="button" onclick="startHelpTour(false)" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-bold">Start Guided Tour</button>'+
 '<button type="button" onclick="startHelpTour(true)" class="px-4 py-2.5 rounded-xl border text-xs font-bold">Resume Tour</button>'+
 '<button type="button" onclick="restartHelpTour()" class="px-4 py-2.5 rounded-xl border text-xs font-bold">Restart from Beginning</button>';
}
function helpMedia(g){
 const link=String(g.media_url||'').trim();
 if(!/^https:\/\/[^\s]+$/i.test(link))return '';
 let image=false;
 try{const u=new URL(link);image=/\.(png|jpe?g|webp)$/i.test(u.pathname)}catch(_){return ''}
 return '<div class="mt-5 rounded-xl border p-3 bg-[#fbfaf7]">'+
   '<div class="text-xs font-semibold mb-3">Training screenshot or video</div>'+
   (image?'<a target="_blank" rel="noopener noreferrer" href="'+html(link)+'"><img alt="Screenshot of this workflow" loading="lazy" class="w-full max-h-[400px] object-contain rounded-lg border bg-white" src="'+html(link)+'"></a>':'')+
   '<a href="'+html(link)+'" target="_blank" rel="noopener noreferrer" class="inline-block mt-2 text-sm underline text-blue-700">Open training material ↗</a></div>';
}
function helpSections(){
 const filtered=guides().filter(g=>
   (model.tab==='all'||model.tab===g.section)&&
   (!model.query||[g.title,g.summary,g.section,...g.steps].join(' ').toLowerCase().includes(model.query.toLowerCase())));
 const bySection=new Map();
 for(const g of filtered){if(!bySection.has(g.section))bySection.set(g.section,[]);bySection.get(g.section).push(g)}
 if(!filtered.length)return '<div class="text-center border border-dashed rounded-xl py-12 text-sm text-gray-500">No guides match your search. Try another keyword.</div>';
 return [...bySection.entries()].map(([section,items])=>'<section class="mb-6"><h3 class="text-xs uppercase tracking-wider font-bold text-gray-500 mb-3">'+html(section)+'</h3>'+
 '<div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">'+items.map(g=>
  '<button type="button" onclick="openHelpGuide(\''+g.id+'\')" class="border rounded-2xl p-4 bg-white text-left hover:shadow-md hover:border-[#d7bd7c] transition-shadow">'+
  '<div class="font-semibold text-sm text-[#211d18]">'+html(g.title)+'</div>'+
  '<div class="mt-2 text-xs text-gray-500 leading-relaxed">'+html(g.summary)+'</div>'+
  '<div class="mt-4 flex justify-between text-[11px] text-[#a17b20] font-semibold"><span>'+g.steps.length+' steps</span><span>Read guide →</span></div></button>'
 ).join('')+'</div></section>').join('');
}
function renderHome(){
 const root=document.getElementById('content');if(!root||state.page!=='help')return;
 const cats=['all',...new Set(guides().map(g=>g.section))];
 const p=model.progress;
 const resume=p&&!p.completed_at&&p.started_at;
 root.innerHTML='<div class="max-w-6xl mx-auto space-y-5">'+
 '<div class="bg-white border rounded-2xl p-5 md:p-7"><div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">'+
 '<div><div class="text-[10px] text-[#b18a30] uppercase tracking-wider font-bold">L’Imperial Staff Knowledge Base</div>'+
 '<h2 class="mt-1 text-2xl font-serif font-bold text-[#211d18]">Help & Guides</h2>'+
 '<p class="text-sm text-gray-500 mt-2">Clear instructions for the tasks your account can perform. English only.</p></div>'+
 '<div class="rounded-xl bg-[#fcfaf5] border p-3 min-w-[200px]"><div class="text-[10px] uppercase font-bold text-gray-400">Your role</div>'+
 '<div class="font-semibold mt-1">'+html(roleTitles[userRole()]||userRole())+'</div>'+
 '<div class="text-[11px] text-gray-500 mt-1">'+(p?.completed_at?'Training completed':resume?'Training in progress':p?.dismissed_at?'Tour available any time':'Start your guided tour')+'</div></div></div>'+
 '<div class="mt-5 flex flex-wrap gap-2">'+buttons()+'</div>'+
 '<p class="text-[11px] text-gray-500 mt-3">You can repeat this tour whenever you want. Training is optional and does not change access rights.</p></div>'+
 '<div class="bg-white border rounded-2xl p-4 md:p-5">'+
 '<label for="helpSearch" class="block text-xs font-bold text-gray-600 mb-2">Find instructions, FAQs or troubleshooting</label>'+
 '<input id="helpSearch" value="'+html(model.query)+'" oninput="filterHelpGuides(this.value)" type="search" autocomplete="off" placeholder="Search: SR, TK/RK, DO, return, free LEDs, stock..." class="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#d7bd7c]">'+
 '<div class="flex flex-wrap gap-2 mt-3">'+cats.map(cat=>
 '<button type="button" onclick="setHelpCategory(\''+html(cat)+'\')" class="rounded-full border px-3 py-1.5 text-xs font-medium '+(cat===model.tab?'bg-[#211d18] text-white border-[#211d18]':'bg-white text-gray-600')+'">'+html(cat==='all'?'All Guides':cat)+'</button>').join('')+'</div></div>'+
 '<div id="helpGuideCollection">'+helpSections()+'</div>'+
 '<div class="rounded-xl border bg-[#faf9f6] p-4"><h3 class="font-bold text-sm">Need assistance?</h3>'+
 '<p class="text-xs text-gray-600 mt-2">Record the document number, the error message and what you clicked. Ask your Manager or Super Admin. Do not share passwords or sensitive customer data.</p></div></div>';
}
window.filterHelpGuides=function(value){model.query=String(value||'');const target=document.getElementById('helpGuideCollection');if(target)target.innerHTML=helpSections()};
window.setHelpCategory=function(cat){model.tab=String(cat||'all');renderHome()};
window.openHelpGuide=function(id){
 const g=guide(id);
 if(!g)return showToast('This guide is not available for your role.','err');
 model.open=g.id;
 const root=document.getElementById('content');
 if(!root)return;
 root.innerHTML='<div class="max-w-4xl mx-auto">'+
 '<button type="button" onclick="backToHelp()" class="mb-4 px-3 py-2 rounded-lg border bg-white text-sm">← All Help & Guides</button>'+
 '<article class="bg-white border rounded-2xl p-5 md:p-8">'+
 '<p class="text-[11px] font-bold uppercase tracking-wider text-[#a17b20]">'+html(g.section)+'</p>'+
 '<div class="mt-2 flex flex-wrap items-center justify-between gap-3"><h2 class="text-2xl font-serif font-bold">'+html(g.title)+'</h2>'+
 (editAllowed()?'<button type="button" onclick="editHelpGuide(\''+g.id+'\')" class="text-xs px-3 py-2 border rounded-lg">Edit Guide</button>':'')+'</div>'+
 '<p class="text-sm text-gray-500 mt-2">'+html(g.summary)+'</p>'+
 '<ol class="mt-6 space-y-3">'+g.steps.map((step,i)=>
 '<li class="flex gap-3 p-3 bg-[#fcfaf8] border rounded-xl"><span class="rounded-full bg-[#211d18] text-white flex items-center justify-center w-7 h-7 text-xs shrink-0 font-bold">'+(i+1)+'</span><p class="text-sm text-gray-800 leading-relaxed">'+html(step)+'</p></li>').join('')+'</ol>'+
 (g.cautions?'<div class="border-l-4 border-amber-400 bg-amber-50 p-4 rounded-lg mt-5 text-sm"><b>Important:</b> '+html(g.cautions)+'</div>':'')+
 helpMedia(g)+
 '<div class="flex gap-2 flex-wrap mt-6">'+(g.page&&g.page!=='help'&&permissionPage(g.page)?'<button type="button" onclick="navigateHelpPage(\''+g.page+'\')" class="rounded-xl bg-[#211d18] px-4 py-2.5 text-white text-xs font-semibold">Open Related Area →</button>':'')+
 '<button type="button" onclick="backToHelp()" class="rounded-xl border px-4 py-2.5 text-xs font-semibold">More Guides</button></div>'+
 '</article></div>';
};
window.backToHelp=function(){model.open=null;renderHome()};
window.navigateHelpPage=function(page){
 if(!permissionPage(page))return showToast('You do not have access to that area.','err');
 return go(page);
};
window.openContextHelp=async function(){
 const current=String(state?.page||'');
 const id=heading[current]||'getting-started';
 await go('help');
 window.openHelpGuide(guide(id)?id:'getting-started');
};

window.editHelpGuide=function(id){
 if(!editAllowed())return showToast('Only authorized management can edit guides.','err');
 const g=guide(id);if(!g)return;
 openModal('Edit Help Guide · '+html(g.title),
 '<form id="helpGuideEditor" class="space-y-4">'+
 '<div class="text-[11px] bg-amber-50 rounded-xl p-3">Changes to this guide appear for eligible staff after refreshing Help. Do not include passwords or private customer data.</div>'+
 '<label class="block text-xs font-bold">Title<input id="helpEditTitle" maxlength="140" required class="mt-1 w-full rounded-xl border p-3" value="'+html(g.title)+'"></label>'+
 '<label class="block text-xs font-bold">Summary<textarea id="helpEditSummary" maxlength="450" rows="2" class="mt-1 w-full rounded-xl border p-3">'+html(g.summary)+'</textarea></label>'+
 '<label class="block text-xs font-bold">Steps (one step per line, maximum 18)<textarea id="helpEditSteps" rows="12" required class="mt-1 w-full rounded-xl border p-3 text-sm">'+html(g.steps.join('\n'))+'</textarea></label>'+
 '<label class="block text-xs font-bold">Important note<textarea id="helpEditCautions" rows="3" maxlength="2000" class="mt-1 w-full rounded-xl border p-3">'+html(g.cautions||'')+'</textarea></label>'+ 
 '<label class="block text-xs font-bold">Screenshot or training video URL (optional, HTTPS only)<input type="url" id="helpEditMedia" maxlength="1800" placeholder="https://..." class="mt-1 w-full rounded-xl border p-3" value="'+html(g.media_url||'')+'"></label>'+ 
 '<button type="submit" class="bg-[#211d18] text-white w-full py-3 rounded-xl font-semibold">Save Staff Guide</button></form>');
 const form=document.getElementById('helpGuideEditor');
 if(form)form.onsubmit=async e=>{
   e.preventDefault();
   const title=document.getElementById('helpEditTitle').value.trim();
   const summary=document.getElementById('helpEditSummary').value.trim();
   const steps=document.getElementById('helpEditSteps').value.split('\n').map(s=>s.trim()).filter(Boolean);
   const cautions=document.getElementById('helpEditCautions').value.trim();
   const media_url=document.getElementById('helpEditMedia').value.trim();
   if(media_url&&!/^https:\/\/[^\s]+$/i.test(media_url))return showToast('Training media link must start with https://','err');
   if(title.length<3||title.length>140||steps.length<1||steps.length>18||steps.some(x=>x.length>2000))
    return showToast('Enter a title and 1–18 steps (max 2,000 characters each).','err');
   const btn=form.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent='Saving…';
   const r=await db.from(guideTable).upsert({guide_id:id,title,summary,steps,cautions,media_url:media_url||null,updated_by:userId(),updated_at:new Date().toISOString()},{onConflict:'guide_id'});
   if(r.error){btn.disabled=false;btn.textContent='Save Staff Guide';return showToast(r.error.message,'err')}
   model.edits.set(id,{title,summary,steps,cautions,media_url});
   closeModal();window.openHelpGuide(id);showToast('Guide updated for staff.');
 };
};

function ensureTourRoot(){
 let r=document.getElementById('helpTourOverlay');
 if(!r){r=document.createElement('div');r.id='helpTourOverlay';document.body.appendChild(r)}
 return r;
}
function renderTour(){
 const t=model.tour;if(!t)return;
 const g=t.steps[t.index];if(!g){window.finishHelpTour();return}
 const root=ensureTourRoot();
 root.className='fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-3 sm:p-6';
 root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Staff Guided Tour');
 root.innerHTML='<div class="absolute inset-0 bg-black/50" aria-hidden="true"></div>'+
 '<div class="relative w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-5 sm:p-7">'+
 '<div class="flex items-center justify-between gap-2"><span class="text-[10px] font-bold uppercase tracking-wider text-[#a17b20]">Staff Training · '+html(roleTitles[userRole()]||userRole())+'</span>'+
 '<button type="button" onclick="skipHelpTour()" aria-label="Close guided tour" class="text-gray-500 text-xl p-1">×</button></div>'+
 '<div class="h-1.5 bg-gray-100 rounded-full mt-4 overflow-hidden"><div class="h-full bg-[#b38b2e] rounded-full" style="width:'+Math.round((t.index+1)/t.steps.length*100)+'%"></div></div>'+
 '<div class="mt-3 text-[11px] text-gray-500">Step '+(t.index+1)+' of '+t.steps.length+'</div>'+
 '<h2 class="font-serif font-bold text-xl mt-2">'+html(g.title)+'</h2>'+
 '<p class="text-sm text-gray-600 mt-2">'+html(g.summary)+'</p>'+
 '<div class="mt-4 space-y-2">'+g.steps.slice(0,5).map((step,i)=>'<div class="flex gap-2 text-sm"><span class="text-[#a17b20] font-bold">'+(i+1)+'.</span><span>'+html(step)+'</span></div>').join('')+'</div>'+
 (g.cautions?'<p class="rounded-xl bg-amber-50 p-3 text-[11px] text-amber-900 mt-4">'+html(g.cautions)+'</p>':'')+
 '<div class="flex flex-wrap items-center justify-between gap-2 mt-6">'+
 '<button type="button" onclick="skipHelpTour()" class="rounded-xl border px-3 py-2.5 text-xs font-semibold">Skip / Save Progress</button>'+
 '<div class="flex gap-2">'+(g.page&&g.page!=='help'&&permissionPage(g.page)?'<button type="button" onclick="visitHelpTourArea()" class="rounded-xl border px-3 py-2.5 text-xs font-semibold">Open Area ↗</button>':'')+
 (t.index>0?'<button type="button" onclick="previousHelpTourStep()" class="rounded-xl border px-3 py-2.5 text-xs font-semibold">Back</button>':'')+
 '<button type="button" onclick="nextHelpTourStep()" class="rounded-xl bg-[#211d18] text-white px-4 py-2.5 text-xs font-bold">'+(t.index===t.steps.length-1?'Finish Training':'Next Step →')+'</button></div></div>'+
 '<p class="text-[10px] mt-4 text-gray-500">This tour is optional. Restart or resume it anytime from Help & Guides.</p></div>';
 const focus=root.querySelector('button[onclick="nextHelpTourStep()"]');if(focus)focus.focus();
}
window.visitHelpTourArea=async function(){
 const g=model.tour?.steps[model.tour.index];
 if(!g||!permissionPage(g.page))return showToast('You do not have access to that area.','err');
 try{await go(g.page);renderTour()}catch(e){showToast(e.message,'err')}
};
window.startHelpTour=async function(resume){
 await loadProgress();
 const steps=tourGuides();
 if(!steps.length)return showToast('No training steps available for your account.','err');
 const past=model.progress;
 let index=resume&&past&&!past.completed_at&&past.role_key===userRole()?Number(past.next_step||0):0;
 index=Math.max(0,Math.min(index,steps.length-1));
 model.tour={steps,index};
 await saveProgress({next_step:index,started_at:past?.started_at||new Date().toISOString(),completed_at:null,dismissed_at:null});
 renderTour();
};
window.restartHelpTour=async function(){
 model.tour=null;
 await saveProgress({next_step:0,started_at:new Date().toISOString(),completed_at:null,dismissed_at:null});
 return window.startHelpTour(false);
};
window.nextHelpTourStep=async function(){
 if(!model.tour)return;
 if(model.tour.index>=model.tour.steps.length-1)return window.finishHelpTour();
 model.tour.index++;
 await saveProgress({next_step:model.tour.index});
 renderTour();
};
window.previousHelpTourStep=async function(){
 if(!model.tour)return;model.tour.index=Math.max(0,model.tour.index-1);
 await saveProgress({next_step:model.tour.index});renderTour();
};
window.skipHelpTour=async function(){
 const index=model.tour?.index||0;
 model.tour=null;document.getElementById('helpTourOverlay')?.remove();
 await saveProgress({next_step:index,dismissed_at:new Date().toISOString()});
 if(state.page==='help')renderHome();
};
window.finishHelpTour=async function(){
 model.tour=null;document.getElementById('helpTourOverlay')?.remove();
 await saveProgress({next_step:0,completed_at:new Date().toISOString(),dismissed_at:null});
 if(state.page==='help')renderHome();
 showToast('Training complete. You can replay it anytime under Help & Guides.');
};
window.dismissHelpTourWelcome=async function(){
 closeModal();
 await saveProgress({dismissed_at:new Date().toISOString(),next_step:0});
};
async function maybeWelcome(){
 if(!userId()||model.firstOfferShown)return;
 model.firstOfferShown=true;
 await Promise.all([loadProgress(),loadEdits()]);
 if(model.progress||!state.profile)return;
 // Non-blocking first-login invitation; not a forced tutorial.
 if(document.getElementById('modal')&&!document.getElementById('modal').classList.contains('hidden'))return;
 openModal('Welcome to L’Imperial', '<div class="space-y-4">'+
 '<div class="rounded-xl bg-[#faf6ed] border border-[#e7d6a7] p-4">'+
 '<div class="font-semibold">Would you like a quick introduction?</div>'+
 '<p class="text-sm mt-2 text-gray-600">The '+html(roleTitles[userRole()]||'staff')+' tour explains the main tasks you can access. You may start now, skip, or reopen it anytime in More → Help & Guides.</p></div>'+
 '<div class="flex flex-wrap gap-2">'+
 '<button onclick="closeModal();startHelpTour(false)" class="bg-[#211d18] text-white rounded-xl px-4 py-3 text-sm font-bold">Start Training</button>'+
 '<button onclick="dismissHelpTourWelcome()" class="border rounded-xl px-4 py-3 text-sm font-semibold">Not Now</button></div>'+
 '<p class="text-[11px] text-gray-500">Optional, English only. This does not change your account permissions.</p></div>');
}
window.renderHelpGuides=async function(){
 if(!state.user)return;
 await Promise.all([loadProgress(),loadEdits()]);
 if(state.page==='help')renderHome();
};
const priorNav=window.navItems;
if(typeof priorNav==='function')window.navItems=function(){
 const items=priorNav.apply(this,arguments)||[];
 if(state.profile&&!items.some(x=>x[0]==='help'))items.push(['help','Help & Guides','?']);
 return items;
};
const priorGo=window.go;
if(typeof priorGo==='function')window.go=async function(page){
 if(page!=='help')return priorGo.apply(this,arguments);
 state.page='help';renderNav();
 document.getElementById('pageTitle').textContent='Help & Guides';
 document.getElementById('pageSubtitle').textContent='English staff instructions · Training available anytime';
 document.getElementById('content').innerHTML='<div class="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading Help & Guides…</div>';
 await window.renderHelpGuides();
};
const oldShowApp=window.showApp;
if(typeof oldShowApp==='function')window.showApp=function(){
 const r=oldShowApp.apply(this,arguments);
 model.progress=null;model.progressLoaded=false;model.firstOfferShown=false;model.edits=new Map();
 setTimeout(()=>{if(state.user&&state.profile)maybeWelcome().catch(err=>console.warn('Help welcome:',err))},1300);
 return r;
};
})();
