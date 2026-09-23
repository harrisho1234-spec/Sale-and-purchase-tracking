// L'Imperial Sales + Order Tracking redesign
// Load AFTER app.js, product-admin.js, roles-access.js, roles-init.js, manager-rep-view.js.

(function () {
  const ui = {
    salesTab: 'invoices',
    salesStatus: 'active',
    salesSearch: '',
    salesDate: 'all',
    salesClass: 'all',
    salesRep: 'all',
    salesCustomer: 'all',
    salesSort: 'newest',
    salesExpanded: new Set(),
    salesOrders: [],
    salesItems: [],
    trackingTab: 'timeline',
    trackingSearch: '',
    trackingOrders: [],
    trackingExpanded: new Set()
  };
  window.trackingRedesign = ui;

  function injectStyles() {
    if (document.getElementById('limperial-tracking-redesign-css')) return;
    const style = document.createElement('style');
    style.id = 'limperial-tracking-redesign-css';
    style.textContent = `
      .lr-shell{max-width:1500px;margin:0 auto}
      .lr-panel{background:#fff;border:1px solid #ece8e0;border-radius:18px;box-shadow:0 4px 16px rgba(31,25,18,.035)}
      .lr-kpi{background:#fff;border:1px solid #eee9e1;border-radius:16px;padding:18px;min-height:112px;position:relative;overflow:hidden}
      .lr-kpi:after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--kpi-line,#d8d3ca)}
      .lr-kpi-label{font-size:10px;letter-spacing:.09em;text-transform:uppercase;font-weight:800;color:#71717a}
      .lr-kpi-value{font-size:27px;font-weight:800;line-height:1.15;margin-top:8px;color:#171717}
      .lr-kpi-sub{font-size:10px;color:#8b8b95;margin-top:7px}
      .lr-tabs{display:flex;gap:26px;border-bottom:1px solid #e5e7eb;overflow:auto}
      .lr-tab{white-space:nowrap;padding:13px 1px 11px;font-size:13px;font-weight:600;color:#9ca3af;border-bottom:2px solid transparent}
      .lr-tab.active{color:#151515;border-bottom-color:#151515}
      .lr-switch{display:inline-flex;background:#f7f5f1;border:1px solid #eee9e0;border-radius:10px;padding:3px}
      .lr-switch button{padding:8px 22px;border-radius:8px;font-size:12px;font-weight:700;color:#7c7c88}
      .lr-switch button.active{background:#fff;color:#b3871e;box-shadow:0 1px 4px rgba(0,0,0,.06)}
      .lr-input,.lr-select{width:100%;background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:10px 12px;font-size:12px;outline:none}
      .lr-input:focus,.lr-select:focus{border-color:#c8a64d;box-shadow:0 0 0 3px rgba(200,166,77,.11)}
      .lr-chip-row{display:flex;gap:5px;overflow:auto;padding-bottom:2px}
      .lr-chip{white-space:nowrap;padding:8px 14px;border-radius:9px;font-size:11px;color:#596173;border:1px solid transparent}
      .lr-chip.active{background:#fffaf0;color:#b3871e;border-color:#f1dfad;font-weight:700}
      .lr-summary{display:flex;gap:28px;flex-wrap:wrap;padding-top:13px;border-top:1px solid #eee9e0}
      .lr-summary-item{min-width:110px}
      .lr-summary-label{font-size:9px;font-weight:800;letter-spacing:.06em;color:#a1a1aa;text-transform:uppercase}
      .lr-summary-value{font-size:15px;font-weight:800;margin-top:3px}
      .lr-order-card{background:#fff;border:1px solid #ece8e0;border-radius:16px;box-shadow:0 3px 12px rgba(31,25,18,.025);overflow:hidden}
      .lr-order-main{padding:18px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center}
      .lr-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 7px;border-radius:6px;font-size:9px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;border:1px solid}
      .lr-badge-red{color:#ef4444;background:#fff5f5;border-color:#fecaca}
      .lr-badge-green{color:#15803d;background:#f0fdf4;border-color:#bbf7d0}
      .lr-badge-blue{color:#2563eb;background:#eff6ff;border-color:#bfdbfe}
      .lr-badge-amber{color:#b45309;background:#fffbeb;border-color:#fde68a}
      .lr-badge-gray{color:#52525b;background:#fafafa;border-color:#e4e4e7}
      .lr-money-label{font-size:9px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em;font-weight:800}
      .lr-money{font-size:15px;font-weight:800}
      .lr-detail{border-top:1px solid #f0ede8;padding:14px 18px;background:#fff}
      .lr-item-row{display:grid;grid-template-columns:58px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #f3f1ed}
      .lr-item-row:last-child{border-bottom:0}
      .lr-thumb{width:58px;height:58px;border-radius:9px;background:#f4f4f5;overflow:hidden;display:flex;align-items:center;justify-content:center}
      .lr-board{display:grid;grid-template-columns:repeat(4,minmax(240px,1fr));gap:14px;overflow-x:auto;padding-bottom:5px}
      .lr-col{min-width:245px;background:#f8fafc;border:1px solid #e8edf2;border-radius:15px;overflow:hidden}
      .lr-col-head{padding:14px;border-bottom:1px solid #e8edf2;display:flex;justify-content:space-between;align-items:center;background:#fff}
      .lr-col-body{padding:10px;display:grid;gap:10px}
      .lr-track-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:13px;box-shadow:0 2px 7px rgba(0,0,0,.025)}
      .lr-track-card:hover{border-color:#bfdbfe;box-shadow:0 4px 14px rgba(37,99,235,.08)}
      .lr-eta-line{position:relative;margin-left:20px;padding-left:30px;padding-bottom:22px;border-left:2px solid #e5e7eb}
      .lr-eta-line:before{content:"";position:absolute;width:12px;height:12px;background:#0ea5e9;border:3px solid #e0f2fe;border-radius:50%;left:-7px;top:8px}
      .lr-track-order{background:#fff;border:1px solid #e8e8eb;border-radius:14px;overflow:hidden}
      .lr-track-order.open{border-color:#93c5fd;box-shadow:0 4px 14px rgba(59,130,246,.06)}
      .lr-track-order-head{padding:16px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;cursor:pointer}
      .lr-track-item{display:grid;grid-template-columns:70px minmax(0,1fr);gap:14px;background:#fff;border:1px solid #eceef1;border-radius:13px;padding:14px}
      .lr-empty{padding:32px;text-align:center;color:#9ca3af;font-size:12px}
      @media(max-width:900px){
        .lr-order-main{grid-template-columns:1fr}
        .lr-order-main>div:last-child{text-align:left!important}
        .lr-board{grid-template-columns:repeat(4,270px)}
      }
      @media(max-width:640px){
        .lr-kpi-value{font-size:22px}
        .lr-switch{width:100%}.lr-switch button{flex:1}
        .lr-track-item{grid-template-columns:58px minmax(0,1fr)}
      }
    `;
    document.head.appendChild(style);
  }

  function roleCanSeeAllSales() {
    return ['super_admin','admin','manager'].includes(state.profile?.role);
  }

  function repContextActive() {
    return typeof managerRepActive === 'function' && managerRepActive();
  }

  function repContextId() {
    return repContextActive() && typeof managerRepId === 'function' ? managerRepId() : null;
  }

  function repContextBanner() {
    return repContextActive() && typeof managerRepBanner === 'function' ? managerRepBanner() : '';
  }

  function cleanStatus(v='') {
    return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
  }

  function formatDate(v) {
    if (!v) return 'TBD';
    const d = new Date(v + (String(v).length <= 10 ? 'T00:00:00' : ''));
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  }

  function dateKey(v) {
    if (!v) return 'TBD';
    return String(v).slice(0,10);
  }

  function imageHtml(url, cls='w-full h-full object-cover') {
    const u = normalizeGoogleImageUrl ? normalizeGoogleImageUrl(url||'') : (url||'');
    if(!u) return `<div class="w-full h-full bg-gray-100 flex items-center justify-center text-[9px] text-gray-400">No image</div>`;
    return `<img src="${esc(u)}" class="${cls}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none" class="w-full h-full bg-gray-100 items-center justify-center text-[9px] text-gray-400">No image</div>`;
  }

  function salesStatusBadge(o) {
    const pay = cleanStatus(o.payment_status);
    const type = cleanStatus(o.order_type);
    const status = cleanStatus(o.status);
    if (status === 'cancelled') return `<span class="lr-badge lr-badge-gray">Cancelled</span>`;
    if (pay === 'paid') return `<span class="lr-badge lr-badge-green">Settled</span>`;
    if (type === 'pre_order' || type === 'mixed') return `<span class="lr-badge lr-badge-blue">Pre-Order</span>`;
    if (Number(o.balance_due||0) > 0) return `<span class="lr-badge lr-badge-red">Balance Due</span>`;
    return `<span class="lr-badge lr-badge-amber">${esc(titleCase(status||'Active'))}</span>`;
  }

  function stageMeta(stage) {
    const map = {
      placed:{label:'Order Placed',dot:'#9ca3af',badge:'lr-badge-gray'},
      production:{label:'In Production',dot:'#f59e0b',badge:'lr-badge-amber'},
      shipping:{label:'Shipping',dot:'#3b82f6',badge:'lr-badge-blue'},
      completed:{label:'Arrived / Completed',dot:'#10b981',badge:'lr-badge-green'}
    };
    return map[stage] || map.placed;
  }

  function itemStage(item, order) {
    const t = Array.isArray(item.item_tracking) ? item.item_tracking[0] : item.item_tracking;
    const s = cleanStatus(t?.status || item.fulfillment_status || order?.status);
    if (['delivered','ready','arrived','completed','paid'].includes(s)) return 'completed';
    if (['shipping','shipped','in_transit','transit'].includes(s)) return 'shipping';
    if (['production','in_production','processing','manufacturing'].includes(s)) return 'production';
    return 'placed';
  }

  function orderStage(order) {
    const items = order.items || [];
    if (!items.length) {
      const s = cleanStatus(order.status);
      if (['completed','paid'].includes(s)) return 'completed';
      if (['processing'].includes(s)) return 'production';
      return 'placed';
    }
    const stages = items.map(i => itemStage(i,order));
    if (stages.every(s=>s==='completed')) return 'completed';
    if (stages.includes('shipping')) return 'shipping';
    if (stages.includes('production')) return 'production';
    if (stages.includes('completed')) return 'completed';
    return 'placed';
  }

  function itemEta(item) {
    const t = Array.isArray(item.item_tracking) ? item.item_tracking[0] : item.item_tracking;
    return t?.estimated_arrival || null;
  }

  function orderEta(order) {
    const dates = (order.items||[]).map(itemEta).filter(Boolean).sort();
    return dates[0] || null;
  }

  function repName(o) {
    return o.sales_rep_name_snapshot || o.rep_name || '';
  }

  function returnInfo(i){
    return i?.return_info||null;
  }

  function returnBadge(i){
    const r=returnInfo(i);
    if(!r||Number(r.qty_returned||0)<=0)return '';
    const returned=Number(r.qty_returned||0);
    const sold=Number(r.qty_sold||i.qty||0);
    const full=sold>0&&returned>=sold;
    const label=full?`Returned ${returned} of ${sold}`:`Partial Return ${returned} of ${sold}`;
    const cls=full?'border-red-200 bg-red-50 text-red-700':'border-amber-200 bg-amber-50 text-amber-800';
    const cn=r.cn_numbers?` · ${esc(r.cn_numbers)}`:'';
    return `<span class="inline-flex px-2 py-1 rounded-lg border text-[9px] font-bold ${cls}">↩ ${label}${cn}</span>`;
  }

  async function loadSalesTrackingData() {
    let summaryQ = db.from('sales_order_summary').select('*').order('created_at',{ascending:false});
    let ordersQ = db.from('sales_orders').select(`
      id,order_no,invoice_no,customer_id,sales_rep_id,sales_rep_name_snapshot,order_date,order_type,status,currency,order_discount,notes,created_at,updated_at,
      customers(id,name,customer_code),
      sales_order_items(
        id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,unit_price,discount_amount,line_total,source_type,fulfillment_status,notes,
        product_catalog(code,item_name,brand,class,image_url)
      )
    `).order('created_at',{ascending:false});

    if(repContextActive()){
      summaryQ = summaryQ.eq('sales_rep_id',repContextId());
      ordersQ = ordersQ.eq('sales_rep_id',repContextId());
    }

    const [sr,or,rr] = await Promise.all([
      summaryQ,
      ordersQ,
      db.rpc('get_sales_tracking_return_summary')
    ]);
    if(sr.error) throw sr.error;
    if(or.error) throw or.error;
    if(rr.error) throw rr.error;

    const returnMap=new Map((rr.data||[]).map(x=>[x.sales_order_item_id,x]));
    const detailMap = new Map((or.data||[]).map(o=>[o.id,o]));
    const merged = (sr.data||[]).map(s => {
      const d = detailMap.get(s.id) || {};
      const items = (d.sales_order_items || []).map(i=>({
        ...i,
        return_info:returnMap.get(i.id)||null
      }));
      return {
        ...s,
        ...d,
        customer_name: s.customer_name || d.customers?.name || '',
        customer_code: d.customers?.customer_code || '',
        items
      };
    });

    ui.salesOrders = merged;
    ui.salesItems = merged.flatMap(o => (o.items||[]).map(i=>({...i,order:o})));
    return merged;
  }

  function salesFilterOptions() {
    const classes = new Set(), reps = new Set(), customers = new Map();
    ui.salesOrders.forEach(o=>{
      if(repName(o)) reps.add(repName(o));
      if(o.customer_id) customers.set(o.customer_id,o.customer_name||o.customers?.name||'Customer');
      (o.items||[]).forEach(i=>{
        const c = i.product_catalog?.class;
        if(c) classes.add(c);
      });
    });
    return {
      classes:[...classes].sort(),
      reps:[...reps].sort(),
      customers:[...customers.entries()].sort((a,b)=>a[1].localeCompare(b[1]))
    };
  }

  function withinDateFilter(dateStr, filter) {
    if(filter==='all' || !dateStr) return true;
    const d = new Date(dateStr+'T00:00:00');
    const now = new Date();
    const startMonth = new Date(now.getFullYear(),now.getMonth(),1);
    const startLast = new Date(now.getFullYear(),now.getMonth()-1,1);
    const endLast = new Date(now.getFullYear(),now.getMonth(),0,23,59,59);
    if(filter==='this_month') return d>=startMonth;
    if(filter==='last_month') return d>=startLast && d<=endLast;
    if(filter==='30') return d>=new Date(now.getTime()-30*86400000);
    if(filter==='90') return d>=new Date(now.getTime()-90*86400000);
    if(filter==='year') return d.getFullYear()===now.getFullYear();
    return true;
  }

  function orderMatchesStatus(o) {
    const status = ui.salesStatus;
    const items = o.items||[];
    if(status==='active') return cleanStatus(o.status)!=='cancelled';
    if(status==='uncleared') return Number(o.balance_due||0)>0 && cleanStatus(o.status)!=='cancelled';
    if(status==='preorder') return ['pre_order','mixed'].includes(cleanStatus(o.order_type)) && cleanStatus(o.status)!=='cancelled';
    if(status==='not_taken') return items.some(i=>cleanStatus(i.fulfillment_status)==='ready');
    if(status==='taken_unpaid') return Number(o.balance_due||0)>0 && items.some(i=>cleanStatus(i.fulfillment_status)==='delivered');
    if(status==='settled') return cleanStatus(o.payment_status)==='paid';
    return true;
  }

  function filteredSalesOrders() {
    const q = ui.salesSearch.toLowerCase().trim();
    let list = ui.salesOrders.filter(o=>{
      if(!withinDateFilter(o.order_date,ui.salesDate)) return false;
      if(ui.salesRep!=='all' && repName(o)!==ui.salesRep) return false;
      if(ui.salesCustomer!=='all' && o.customer_id!==ui.salesCustomer) return false;
      if(ui.salesClass!=='all' && !(o.items||[]).some(i=>i.product_catalog?.class===ui.salesClass)) return false;
      if(!orderMatchesStatus(o)) return false;
      if(q){
        const hay = [
          o.order_no,o.invoice_no,o.customer_name,o.customer_code,repName(o),o.status,o.order_type,
          ...(o.items||[]).flatMap(i=>[
            i.product_code_snapshot,i.item_name_snapshot,i.product_catalog?.brand,i.product_catalog?.class
          ])
        ].filter(Boolean).join(' ').toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a,b)=>{
      if(ui.salesSort==='oldest') return String(a.order_date||'').localeCompare(String(b.order_date||''));
      if(ui.salesSort==='balance') return Number(b.balance_due||0)-Number(a.balance_due||0);
      if(ui.salesSort==='total') return Number(b.order_total||0)-Number(a.order_total||0);
      return String(b.order_date||'').localeCompare(String(a.order_date||''));
    });
    return list;
  }

  function salesKpis(orders) {
    const active = orders.filter(o=>cleanStatus(o.status)!=='cancelled');
    const total = active.reduce((a,o)=>a+Number(o.order_total||0),0);
    const paid = active.reduce((a,o)=>a+Number(o.amount_paid||0),0);
    const balance = active.reduce((a,o)=>a+Number(o.balance_due||0),0);
    const uncleared = active.filter(o=>Number(o.balance_due||0)>0);
    const readyItems = active.flatMap(o=>(o.items||[]).filter(i=>cleanStatus(i.fulfillment_status)==='ready'));
    const readyQty = readyItems.reduce((a,i)=>a+Number(i.qty||0),0);
    const readyValue = readyItems.reduce((a,i)=>a+Number(i.line_total||0),0);
    const pre = active.filter(o=>['pre_order','mixed'].includes(cleanStatus(o.order_type)));
    const prePaid = pre.reduce((a,o)=>a+Number(o.amount_paid||0),0);
    const preBal = pre.reduce((a,o)=>a+Number(o.balance_due||0),0);
    const preQty = pre.reduce((a,o)=>a+(o.items||[]).reduce((x,i)=>x+Number(i.qty||0),0),0);
    return {total,paid,balance,uncleared:uncleared.length,readyQty,readyValue,prePaid,preBal,preQty};
  }

  function invoiceItemSummary(o) {
    const items=o.items||[];
    if(!items.length) return 'No item detail';
    const names=items.slice(0,4).map(i=>i.product_code_snapshot||i.item_name_snapshot).filter(Boolean);
    return `${items.length} Item${items.length===1?'':'s'}: ${names.join(', ')}${items.length>4?'…':''}`;
  }

  function invoiceCard(o) {
    const open = ui.salesExpanded.has(o.id);
    const items = o.items||[];
    return `
      <div class="lr-order-card">
        <div class="lr-order-main">
          <div class="min-w-0 flex gap-3">
            <button onclick="toggleSalesInvoice('${o.id}')" class="shrink-0 w-9 h-9 rounded-lg border bg-[#fffdf9] flex items-center justify-center text-[#b3871e]">▤</button>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <button onclick="toggleSalesInvoice('${o.id}')" class="font-extrabold text-[14px] hover:text-[#b3871e]">${esc(o.invoice_no||o.order_no||'Order')}</button>
                ${salesStatusBadge(o)}
                ${items.some(i=>Number(returnInfo(i)?.qty_returned||0)>0)?`<span class="lr-badge lr-badge-amber">↩ Return Recorded</span>`:''}
                ${repName(o)?`<span class="lr-badge lr-badge-gray">▣ ${esc(repName(o))}</span>`:''}
              </div>
              <div class="font-serif text-[16px] font-bold mt-1 truncate">${esc(o.customer_name||'Customer')}</div>
              <div class="text-[10px] text-gray-400 mt-1 truncate">◇ ${esc(invoiceItemSummary(o))}</div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-7 text-right min-w-[245px]">
            <div>
              <div class="lr-money-label">${['pre_order','mixed'].includes(cleanStatus(o.order_type))?'Deposit Paid':'Amount Paid'}</div>
              <div class="lr-money text-green-600">${money(o.amount_paid,o.currency)}</div>
            </div>
            <div>
              <div class="lr-money-label">${cleanStatus(o.payment_status)==='paid'?'Balance':'Active Balance'}</div>
              <div class="lr-money ${Number(o.balance_due||0)>0?'text-red-500':'text-green-600'}">${money(o.balance_due,o.currency)}</div>
              <button onclick="toggleSalesInvoice('${o.id}')" class="text-[10px] font-semibold text-[#b3871e] mt-1">${open?'Hide details ↑':'View details →'}</button>
            </div>
          </div>
        </div>
        ${open?`
          <div class="lr-detail">
            <div class="grid sm:grid-cols-4 gap-3 mb-3 text-xs">
              <div><span class="text-gray-400">Order:</span><br><b>${esc(o.order_no||'-')}</b></div>
              <div><span class="text-gray-400">Date:</span><br><b>${esc(formatDate(o.order_date))}</b></div>
              <div><span class="text-gray-400">Type:</span><br><b>${esc(titleCase(o.order_type||'-'))}</b></div>
              <div><span class="text-gray-400">Total:</span><br><b>${money(o.order_total,o.currency)}</b></div>
            </div>
            ${(items.length?items.map(i=>`
              <div class="lr-item-row">
                <div class="lr-thumb">${imageHtml(i.image_url_snapshot||i.product_catalog?.image_url)}</div>
                <div class="min-w-0">
                  <div class="flex flex-wrap gap-2 items-center"><b>${esc(i.product_code_snapshot||'No Code')}</b><span class="lr-badge lr-badge-gray">${esc(titleCase(i.fulfillment_status||'ordered'))}</span></div>
                  <div class="text-sm mt-0.5 truncate">${esc(i.item_name_snapshot||i.product_catalog?.item_name||'Item')}</div>
                  <div class="text-[10px] text-gray-400">${esc(i.product_catalog?.brand||'')} ${i.product_catalog?.class?'· '+esc(i.product_catalog.class):''}</div>
                  ${returnInfo(i)?`<div class="mt-1.5 flex flex-wrap items-center gap-2">${returnBadge(i)}<span class="text-[10px] text-gray-500">Remaining with customer: <b>${Number(returnInfo(i).remaining_with_customer||0)}</b></span></div>`:''}
                </div>
                <div class="text-right text-xs"><b>${Number(i.qty||0)} × ${money(i.unit_price,o.currency)}</b><div class="text-gray-400 mt-1">${money(i.line_total,o.currency)}</div></div>
              </div>`).join(''):`<div class="lr-empty">No line-item detail available.</div>`)}
            ${isSuper()?`
              <div class="mt-4 pt-4 border-t flex flex-wrap gap-2 justify-end">
                <button onclick="openSuperAdminInvoiceEdit(\'${o.id}\')" class="px-3 py-2 border border-[#d8c28a] bg-[#fffaf0] text-[#8a6a1f] rounded-lg text-[10px] font-bold">✎ EDIT INVOICE</button>
                <button onclick="openSuperAdminInvoiceDelete(\'${o.id}\')" class="px-3 py-2 border border-red-200 bg-red-50 text-red-700 rounded-lg text-[10px] font-bold">DELETE INVOICE</button>
              </div>`:'' }
          </div>`:'' }
      </div>`;
  }

  function salesItemCard(i) {
    const o=i.order;
    return `<div class="lr-track-item">
      <div class="lr-thumb" style="width:70px;height:70px">${imageHtml(i.image_url_snapshot||i.product_catalog?.image_url)}</div>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <b>${esc(o.invoice_no||o.order_no||'Order')}</b>
          <span class="font-bold">${Number(i.qty||0)}x</span>
          <span class="lr-badge lr-badge-gray">${esc(i.product_code_snapshot||'No Code')}</span>
          <span class="lr-badge ${cleanStatus(i.fulfillment_status)==='delivered'?'lr-badge-green':cleanStatus(i.fulfillment_status)==='ready'?'lr-badge-blue':'lr-badge-amber'}">${esc(titleCase(i.fulfillment_status||'ordered'))}</span>
          ${returnBadge(i)}
        </div>
        <div class="text-sm font-semibold mt-1">${esc(i.item_name_snapshot||i.product_catalog?.item_name||'Item')}</div>
        ${returnInfo(i)?`<div class="text-[10px] text-gray-500 mt-1">Sold ${Number(returnInfo(i).qty_sold||i.qty||0)} · Returned ${Number(returnInfo(i).qty_returned||0)} · Remaining with customer ${Number(returnInfo(i).remaining_with_customer||0)}</div>`:''}
        <div class="text-[11px] text-gray-400 mt-1">${esc(o.customer_name||'Customer')}${repName(o)?' · '+esc(repName(o)):''}</div>
      </div>
    </div>`;
  }

function invoiceById(id) {
  return ui.salesOrders.find(o=>o.id===id) || null;
}

function invoiceAdminStatusOptions(selected) {
  const values=['draft','confirmed','partially_paid','paid','processing','ready','completed','cancelled'];
  return values.map(v=>`<option value="${v}" ${cleanStatus(selected)===v?'selected':''}>${esc(titleCase(v))}</option>`).join('');
}

function invoiceAdminFulfillmentOptions(selected) {
  const values=['pending','reserved','ordered','production','shipping','arrived','ready','delivered','installed','cancelled'];
  return values.map(v=>`<option value="${v}" ${cleanStatus(selected)===v?'selected':''}>${esc(titleCase(v))}</option>`).join('');
}

function invoiceAdminItemEditor(item, currency) {
  const r=returnInfo(item);
  const returnLocked=Number(r?.qty_returned||0)>0;
  return `<div class="invoice-admin-item border rounded-xl p-3 bg-[#fffdf9]" data-id="${esc(item.id)}" data-return-locked="${returnLocked?'1':'0'}">
    <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-2 mb-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <b class="text-sm">${esc(item.product_code_snapshot||'No Code')}</b>
          ${returnLocked?`<span class="lr-badge lr-badge-amber">Return/CN Locked</span>`:''}
        </div>
        <div class="text-xs text-gray-600 mt-1">${esc(item.item_name_snapshot||item.product_catalog?.item_name||'Item')}</div>
        <div class="text-[10px] text-gray-400 mt-1">Product/SKU is fixed here to protect PO, delivery and return links.</div>
      </div>
      <div class="text-xs font-bold">${money(item.line_total,currency)}</div>
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
      <label class="text-[10px] font-bold text-gray-500">Qty
        <input class="invoice-admin-qty lr-input mt-1" type="number" min="0.01" step="0.01" value="${Number(item.qty||0)}" ${returnLocked?'disabled':''}>
      </label>
      <label class="text-[10px] font-bold text-gray-500">Unit Price
        <input class="invoice-admin-price lr-input mt-1" type="number" min="0" step="0.01" value="${Number(item.unit_price||0)}" ${returnLocked?'disabled':''}>
      </label>
      <label class="text-[10px] font-bold text-gray-500">Discount
        <input class="invoice-admin-discount lr-input mt-1" type="number" min="0" step="0.01" value="${Number(item.discount_amount||0)}" ${returnLocked?'disabled':''}>
      </label>
      <label class="text-[10px] font-bold text-gray-500">Source
        <select class="invoice-admin-source lr-select mt-1">
          <option value="stock" ${cleanStatus(item.source_type)==='stock'?'selected':''}>Stock</option>
          <option value="pre_order" ${cleanStatus(item.source_type)==='pre_order'?'selected':''}>Pre-Order</option>
        </select>
      </label>
      <label class="text-[10px] font-bold text-gray-500">Fulfillment
        <select class="invoice-admin-fulfillment lr-select mt-1">${invoiceAdminFulfillmentOptions(item.fulfillment_status)}</select>
      </label>
    </div>
    <textarea class="invoice-admin-item-notes lr-input mt-2" rows="2" placeholder="Item notes">${esc(item.notes||'')}</textarea>
    ${returnLocked?`<div class="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2">Quantity, unit price and discount are locked because this item already has a Return/Credit Note.</div>`:''}
  </div>`;
}

async function openSuperAdminInvoiceEdit(id) {
  if(!isSuper()) return showToast('Super Admin only','err');
  if(typeof window.openEditSalesOrder==='function') return window.openEditSalesOrder(id);
  const o=invoiceById(id);
  if(!o) return showToast('Invoice not found','err');

  let customers=[];
  try{
    const {data,error}=await db.from('customers').select('id,name,customer_code,active').order('name');
    if(error) throw error;
    customers=data||[];
  }catch(err){
    return showToast(err.message||'Could not load customers','err');
  }

  const currentCustomerExists=customers.some(c=>c.id===o.customer_id);
  if(!currentCustomerExists && o.customer_id){
    customers.unshift({id:o.customer_id,name:o.customer_name||'Current Customer',customer_code:o.customer_code||'',active:false});
  }

  openModal(`Edit Invoice · ${o.invoice_no||o.order_no||'Order'}`,`
    <form id="superAdminInvoiceEditForm" class="space-y-5">
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <b>Super Admin correction.</b> Every save is recorded in the invoice audit log with the original and revised values.
      </div>

      <div class="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        <label class="text-xs font-semibold text-gray-600">Order No.
          <input id="invoiceAdminOrderNo" class="lr-input mt-1" required value="${esc(o.order_no||'')}">
        </label>
        <label class="text-xs font-semibold text-gray-600">Invoice No.
          <input id="invoiceAdminInvoiceNo" class="lr-input mt-1" value="${esc(o.invoice_no||'')}" placeholder="Optional">
        </label>
        <label class="text-xs font-semibold text-gray-600">Order Date
          <input id="invoiceAdminDate" type="date" class="lr-input mt-1" required value="${esc(String(o.order_date||'').slice(0,10))}">
        </label>
        <label class="text-xs font-semibold text-gray-600">Customer
          <select id="invoiceAdminCustomer" class="lr-select mt-1" required>
            ${customers.map(c=>`<option value="${esc(c.id)}" ${c.id===o.customer_id?'selected':''}>${esc(c.name||'Customer')}${c.customer_code?' · '+esc(c.customer_code):''}${c.active===false?' (Inactive)':''}</option>`).join('')}
          </select>
        </label>
        <label class="text-xs font-semibold text-gray-600">Order Type
          <select id="invoiceAdminType" class="lr-select mt-1">
            <option value="in_stock" ${cleanStatus(o.order_type)==='in_stock'?'selected':''}>In Stock</option>
            <option value="pre_order" ${cleanStatus(o.order_type)==='pre_order'?'selected':''}>Pre-Order</option>
            <option value="mixed" ${cleanStatus(o.order_type)==='mixed'?'selected':''}>Mixed</option>
          </select>
        </label>
        <label class="text-xs font-semibold text-gray-600">Status
          <select id="invoiceAdminStatus" class="lr-select mt-1">${invoiceAdminStatusOptions(o.status)}</select>
        </label>
        <label class="text-xs font-semibold text-gray-600">Order Discount
          <input id="invoiceAdminOrderDiscount" type="number" min="0" step="0.01" class="lr-input mt-1" value="${Number(o.order_discount||0)}">
        </label>
        <label class="text-xs font-semibold text-gray-600">Sales Rep
          <input class="lr-input mt-1 bg-gray-50" disabled value="${esc(repName(o)||'—')}">
        </label>
      </div>

      <label class="block text-xs font-semibold text-gray-600">Invoice / Order Notes
        <textarea id="invoiceAdminNotes" class="lr-input mt-1" rows="2">${esc(o.notes||'')}</textarea>
      </label>

      <div>
        <div class="flex items-end justify-between gap-3 mb-2">
          <div>
            <div class="font-bold text-sm">Invoice Items</div>
            <div class="text-[10px] text-gray-400">You can correct quantity, selling price, discount, source and fulfillment status.</div>
          </div>
          <span class="lr-badge lr-badge-gray">${(o.items||[]).length} item${(o.items||[]).length===1?'':'s'}</span>
        </div>
        <div class="space-y-3">
          ${(o.items||[]).map(i=>invoiceAdminItemEditor(i,o.currency)).join('')||'<div class="lr-empty">No invoice items.</div>'}
        </div>
      </div>

      <label class="block text-xs font-semibold text-gray-600">Reason for correction
        <textarea id="invoiceAdminReason" class="lr-input mt-1" rows="2" required placeholder="Example: Wrong invoice number / duplicate entry / incorrect quantity"></textarea>
      </label>

      <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t pt-4">
        <button type="button" onclick="closeModal()" class="px-4 py-2.5 border rounded-xl text-sm font-semibold">Cancel</button>
        <button id="invoiceAdminSaveBtn" class="px-5 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold">Save Invoice Changes</button>
      </div>
    </form>
  `);

  document.getElementById('superAdminInvoiceEditForm').onsubmit=e=>saveSuperAdminInvoiceEdit(e,id);
}

async function saveSuperAdminInvoiceEdit(e,id) {
  e.preventDefault();
  if(!isSuper()) return showToast('Super Admin only','err');

  const btn=document.getElementById('invoiceAdminSaveBtn');
  const itemRows=[...document.querySelectorAll('.invoice-admin-item')];
  const items=itemRows.map(row=>({
    id:row.dataset.id,
    qty:Number(row.querySelector('.invoice-admin-qty')?.value||0),
    unit_price:Number(row.querySelector('.invoice-admin-price')?.value||0),
    discount_amount:Number(row.querySelector('.invoice-admin-discount')?.value||0),
    source_type:row.querySelector('.invoice-admin-source')?.value||'stock',
    fulfillment_status:row.querySelector('.invoice-admin-fulfillment')?.value||'pending',
    notes:row.querySelector('.invoice-admin-item-notes')?.value||''
  }));

  const order={
    order_no:document.getElementById('invoiceAdminOrderNo').value.trim(),
    invoice_no:document.getElementById('invoiceAdminInvoiceNo').value.trim(),
    customer_id:document.getElementById('invoiceAdminCustomer').value,
    order_date:document.getElementById('invoiceAdminDate').value,
    order_type:document.getElementById('invoiceAdminType').value,
    status:document.getElementById('invoiceAdminStatus').value,
    order_discount:Number(document.getElementById('invoiceAdminOrderDiscount').value||0),
    notes:document.getElementById('invoiceAdminNotes').value
  };
  const reason=document.getElementById('invoiceAdminReason').value.trim();

  if(!order.order_no || !order.order_date || !order.customer_id || !reason){
    return showToast('Complete the required fields and correction reason.','err');
  }

  btn.disabled=true;
  btn.textContent='Saving...';
  try{
    const {data,error}=await db.rpc('super_admin_update_sales_invoice',{
      p_order_id:id,
      p_order:order,
      p_items:items,
      p_reason:reason
    });
    if(error) throw error;
    closeModal();
    showToast('Invoice updated successfully');
    await loadSalesTrackingData();
    ui.salesExpanded.add(id);
    renderSalesTrackingBody();
  }catch(err){
    showToast(err.message||'Could not update invoice','err');
    btn.disabled=false;
    btn.textContent='Save Invoice Changes';
  }
}

async function openSuperAdminInvoiceDelete(id) {
  if(!isSuper()) return showToast('Super Admin only','err');
  const o=invoiceById(id);
  if(!o) return showToast('Invoice not found','err');

  let paymentCount=0;
  let returns=[];
  try{
    const [p,r]=await Promise.all([
      db.from('sales_payments').select('id',{count:'exact',head:true}).eq('sales_order_id',id),
      db.from('sales_returns').select('id,cn_no,status').eq('sales_order_id',id).order('created_at')
    ]);
    if(p.error) throw p.error;
    if(r.error) throw r.error;
    paymentCount=p.count||0;
    returns=r.data||[];
  }catch(err){
    return showToast(err.message||'Could not inspect invoice links','err');
  }

  const blocked=returns.length>0;
  openModal(`Delete Invoice · ${o.invoice_no||o.order_no||'Order'}`,`
    <div class="space-y-4">
      <div class="rounded-xl border ${blocked?'border-red-200 bg-red-50':'border-amber-200 bg-amber-50'} p-4">
        <div class="font-bold ${blocked?'text-red-800':'text-amber-900'}">${blocked?'Deletion blocked':'Permanent invoice deletion'}</div>
        <div class="text-xs mt-1 ${blocked?'text-red-700':'text-amber-800'}">
          ${blocked
            ? `This invoice has linked Return/Credit Note record(s): <b>${returns.map(r=>esc(r.cn_no||r.id)).join(', ')}</b>. Resolve or cancel those records first.`
            : `This removes the invoice/order plus its linked item rows, payment rows and tracking links. A full audit snapshot is kept for Super Admin review.`
          }
        </div>
      </div>

      <div class="grid sm:grid-cols-2 gap-3 text-xs">
        <div class="border rounded-xl p-3"><div class="text-gray-400">Invoice / Order</div><b>${esc(o.invoice_no||o.order_no||'-')}</b></div>
        <div class="border rounded-xl p-3"><div class="text-gray-400">Customer</div><b>${esc(o.customer_name||'Customer')}</b></div>
        <div class="border rounded-xl p-3"><div class="text-gray-400">Items that will be deleted</div><b>${(o.items||[]).length}</b></div>
        <div class="border rounded-xl p-3"><div class="text-gray-400">Payment records that will be deleted</div><b>${paymentCount}</b></div>
      </div>

      ${blocked
        ? `<div class="flex justify-end"><button type="button" onclick="closeModal()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold">Close</button></div>`
        : `<form id="superAdminInvoiceDeleteForm" class="space-y-3">
            <label class="block text-xs font-semibold text-gray-600">Reason for deletion
              <textarea id="invoiceAdminDeleteReason" class="lr-input mt-1" rows="2" required placeholder="Why is this invoice being removed?"></textarea>
            </label>
            <label class="block text-xs font-semibold text-gray-600">Type DELETE to confirm
              <input id="invoiceAdminDeletePhrase" class="lr-input mt-1" autocomplete="off" required placeholder="DELETE">
            </label>
            <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t pt-4">
              <button type="button" onclick="closeModal()" class="px-4 py-2.5 border rounded-xl text-sm font-semibold">Cancel</button>
              <button id="invoiceAdminDeleteBtn" class="px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold">Delete Invoice Permanently</button>
            </div>
          </form>`
      }
    </div>
  `);

  if(!blocked){
    document.getElementById('superAdminInvoiceDeleteForm').onsubmit=e=>confirmSuperAdminInvoiceDelete(e,id);
  }
}

async function confirmSuperAdminInvoiceDelete(e,id) {
  e.preventDefault();
  if(!isSuper()) return showToast('Super Admin only','err');
  const reason=document.getElementById('invoiceAdminDeleteReason').value.trim();
  const phrase=document.getElementById('invoiceAdminDeletePhrase').value.trim();
  if(!reason) return showToast('Deletion reason is required.','err');
  if(phrase!=='DELETE') return showToast('Type DELETE exactly to confirm.','err');

  const btn=document.getElementById('invoiceAdminDeleteBtn');
  btn.disabled=true;
  btn.textContent='Deleting...';
  try{
    const {data,error}=await db.rpc('super_admin_delete_sales_invoice',{
      p_order_id:id,
      p_reason:reason
    });
    if(error) throw error;
    closeModal();
    ui.salesExpanded.delete(id);
    showToast('Invoice deleted');
    await loadSalesTrackingData();
    renderSalesTrackingBody();
  }catch(err){
    showToast(err.message||'Could not delete invoice','err');
    btn.disabled=false;
    btn.textContent='Delete Invoice Permanently';
  }
}
  window.openSuperAdminInvoiceEdit = openSuperAdminInvoiceEdit;
  window.saveSuperAdminInvoiceEdit = saveSuperAdminInvoiceEdit;
  window.openSuperAdminInvoiceDelete = openSuperAdminInvoiceDelete;
  window.confirmSuperAdminInvoiceDelete = confirmSuperAdminInvoiceDelete;


  window.setSalesTab = function(tab){ ui.salesTab=tab; renderSalesTrackingBody(); };
  window.setSalesStatus = function(v){ ui.salesStatus=v; renderSalesTrackingBody(); };
  window.setSalesFilter = function(key,v){ ui[key]=v; renderSalesTrackingBody(); };
  window.setSalesSearch = function(v){ ui.salesSearch=v; renderSalesTrackingBody(); };
  window.toggleSalesInvoice = function(id){
    ui.salesExpanded.has(id)?ui.salesExpanded.delete(id):ui.salesExpanded.add(id);
    renderSalesTrackingBody();
  };

  window.renderSalesTrackingBody = function() {
    const root=document.getElementById('salesTrackingRoot');
    if(!root) return;
    const options=salesFilterOptions();
    const filtered=filteredSalesOrders();
    const k=salesKpis(filtered);
    const visibleItems=filtered.flatMap(o=>(o.items||[]).map(i=>({...i,order:o})));

    root.innerHTML=`
      ${repContextBanner()}
      <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <div class="lr-kpi" style="--kpi-line:#ef4444">
          <div class="lr-kpi-label text-red-500">Balance Due (AR)</div>
          <div class="lr-kpi-value text-red-600">${money(k.balance)}</div>
          <div class="lr-kpi-sub">Total visible sales: <b class="text-gray-600">${money(k.total)}</b></div>
        </div>
        <div class="lr-kpi">
          <div class="lr-kpi-label">Uncleared</div>
          <div class="lr-kpi-value">${k.uncleared}</div>
          <div class="lr-kpi-sub">Invoices with outstanding balance</div>
        </div>
        <div class="lr-kpi" style="--kpi-line:#f59e0b">
          <div class="lr-kpi-label text-orange-500">Not Taken Items</div>
          <div class="lr-kpi-value">${k.readyQty.toLocaleString()}</div>
          <div class="lr-kpi-sub">Ready value: <b class="text-gray-600">${money(k.readyValue)}</b></div>
        </div>
        <div class="lr-kpi" style="--kpi-line:#3b82f6">
          <div class="lr-kpi-label text-blue-500">Pre-Order Deposits</div>
          <div class="lr-kpi-value">${money(k.prePaid)}</div>
          <div class="lr-kpi-sub">${k.preQty.toLocaleString()} qty · <b>${money(k.preBal)}</b> pending</div>
        </div>
      </div>

      <div class="lr-panel p-3 md:p-4 mb-4">
        <div class="lr-switch mb-4">
          <button class="${ui.salesTab==='invoices'?'active':''}" onclick="setSalesTab('invoices')">Invoices</button>
          <button class="${ui.salesTab==='items'?'active':''}" onclick="setSalesTab('items')">Items (Products)</button>
        </div>

        <div class="relative mb-3">
          <input class="lr-input pl-10" value="${esc(ui.salesSearch)}" oninput="setSalesSearch(this.value)" placeholder="Search Invoice, Customer, Item Name, SKU...">
          <span class="absolute left-3 top-2.5 text-gray-400">⌕</span>
        </div>

        <div class="grid sm:grid-cols-2 xl:grid-cols-5 gap-2 mb-3">
          <select class="lr-select" onchange="setSalesFilter('salesDate',this.value)">
            <option value="all" ${ui.salesDate==='all'?'selected':''}>All Dates</option>
            <option value="this_month" ${ui.salesDate==='this_month'?'selected':''}>This Month</option>
            <option value="last_month" ${ui.salesDate==='last_month'?'selected':''}>Last Month</option>
            <option value="30" ${ui.salesDate==='30'?'selected':''}>Last 30 Days</option>
            <option value="90" ${ui.salesDate==='90'?'selected':''}>Last 90 Days</option>
            <option value="year" ${ui.salesDate==='year'?'selected':''}>This Year</option>
          </select>
          <select class="lr-select" onchange="setSalesFilter('salesClass',this.value)">
            <option value="all">All Classes</option>
            ${options.classes.map(v=>`<option value="${esc(v)}" ${ui.salesClass===v?'selected':''}>${esc(v)}</option>`).join('')}
          </select>
          <select class="lr-select" onchange="setSalesFilter('salesRep',this.value)">
            <option value="all">All Sales Reps</option>
            ${options.reps.map(v=>`<option value="${esc(v)}" ${ui.salesRep===v?'selected':''}>${esc(v)}</option>`).join('')}
          </select>
          <select class="lr-select" onchange="setSalesFilter('salesCustomer',this.value)">
            <option value="all">All Customers</option>
            ${options.customers.map(([id,n])=>`<option value="${id}" ${ui.salesCustomer===id?'selected':''}>${esc(n)}</option>`).join('')}
          </select>
          <select class="lr-select" onchange="setSalesFilter('salesSort',this.value)">
            <option value="newest" ${ui.salesSort==='newest'?'selected':''}>Newest First</option>
            <option value="oldest" ${ui.salesSort==='oldest'?'selected':''}>Oldest First</option>
            <option value="balance" ${ui.salesSort==='balance'?'selected':''}>Highest Balance</option>
            <option value="total" ${ui.salesSort==='total'?'selected':''}>Highest Total</option>
          </select>
        </div>

        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div class="lr-chip-row">
            ${[
              ['active','All Active'],['uncleared','Uncleared'],['preorder','Pre-Orders'],
              ['not_taken','Not Taken'],['taken_unpaid','Taken & Unpaid'],['settled','Settled']
            ].map(([v,l])=>`<button class="lr-chip ${ui.salesStatus===v?'active':''}" onclick="setSalesStatus('${v}')">${l}</button>`).join('')}
          </div>
          <div class="flex gap-2 flex-wrap justify-end">
            <button onclick="openNewOrder()" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-[10px] font-bold shadow-sm">+ NEW ORDER</button>
            <button onclick="exportSalesTrackingCsv()" class="px-3 py-2 border border-green-200 bg-green-50 text-green-700 rounded-lg text-[10px] font-bold">CSV</button>
            <button onclick="window.print()" class="px-3 py-2 border border-red-200 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold">PRINT / PDF</button>
          </div>
        </div>

        <div class="lr-summary mt-3">
          <div class="lr-summary-item"><div class="lr-summary-label">Filtered Invoices</div><div class="lr-summary-value">${filtered.length}</div></div>
          <div class="lr-summary-item"><div class="lr-summary-label">Total Value</div><div class="lr-summary-value">${money(k.total)}</div></div>
          <div class="lr-summary-item"><div class="lr-summary-label">Deposit Paid</div><div class="lr-summary-value text-green-600">${money(k.paid)}</div></div>
          <div class="lr-summary-item"><div class="lr-summary-label">Active Balance Due</div><div class="lr-summary-value text-red-500">${money(k.balance)}</div></div>
        </div>
      </div>

      <div class="grid gap-3">
        ${ui.salesTab==='invoices'
          ? (filtered.map(invoiceCard).join('') || `<div class="lr-panel lr-empty">No invoices match the selected filters.</div>`)
          : (visibleItems.map(salesItemCard).join('') || `<div class="lr-panel lr-empty">No items match the selected filters.</div>`)
        }
      </div>`;
  };

  window.exportSalesTrackingCsv = function() {
    const rows=filteredSalesOrders();
    const csv=[
      ['Invoice/Order','Customer','Sales Rep','Date','Type','Status','Total','Paid','Balance'],
      ...rows.map(o=>[
        o.invoice_no||o.order_no||'',o.customer_name||'',repName(o),o.order_date||'',o.order_type||'',o.status||'',
        Number(o.order_total||0),Number(o.amount_paid||0),Number(o.balance_due||0)
      ])
    ].map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='limperial-sales-tracking.csv';a.click();URL.revokeObjectURL(a.href);
  };

  async function renderSalesTracking() {
    injectStyles();
    document.getElementById('content').innerHTML=`<div class="lr-shell"><div id="salesTrackingRoot"><div class="py-20 text-center text-gray-400">Loading sales tracking...</div></div></div>`;
    await loadSalesTrackingData();
    renderSalesTrackingBody();
  }

  async function loadOrderTrackingData() {
    let q=db.from('sales_orders').select(`
      id,order_no,invoice_no,customer_id,sales_rep_id,sales_rep_name_snapshot,order_date,order_type,status,currency,notes,created_at,updated_at,
      customers(id,name,customer_code),
      sales_order_items(
        id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,source_type,fulfillment_status,notes,created_at,
        product_catalog(code,item_name,brand,class,image_url),
        item_tracking(status,estimated_arrival,actual_arrival,delivered_at,customer_visible_note,updated_at)
      )
    `).order('created_at',{ascending:false});
    if(repContextActive()) q=q.eq('sales_rep_id',repContextId());
    const {data,error}=await q;
    if(error) throw error;
    ui.trackingOrders=(data||[]).map(o=>({...o,customer_name:o.customers?.name||'',items:o.sales_order_items||[]}));
  }

  function trackingMatches(order) {
    const q=ui.trackingSearch.toLowerCase().trim();
    if(!q) return true;
    const hay=[
      order.order_no,order.invoice_no,order.customer_name,repName(order),order.order_type,order.status,
      ...(order.items||[]).flatMap(i=>[
        i.product_code_snapshot,i.item_name_snapshot,i.product_catalog?.brand,i.product_catalog?.class
      ])
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  function trackingCard(order, compact=false) {
    const stage=orderStage(order),m=stageMeta(stage),eta=orderEta(order);
    const qty=(order.items||[]).reduce((a,i)=>a+Number(i.qty||0),0);
    const contents=(order.items||[]).slice(0,3).map(i=>i.item_name_snapshot||i.product_code_snapshot).filter(Boolean).join(', ');
    return `<button onclick="openTrackingOrder('${order.id}')" class="lr-track-card text-left w-full">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex flex-wrap gap-2 items-center">
            <b class="text-[14px]">${esc(order.order_no||order.invoice_no||'Order')}</b>
            <span class="lr-badge ${m.badge}">${esc(m.label)}</span>
          </div>
          <div class="text-[11px] text-gray-500 mt-1 truncate">${esc(order.customer_name||'Customer')}</div>
          ${!compact?`<div class="text-[10px] text-gray-400 mt-2 truncate">${esc(contents||'No item detail')}</div>`:''}
        </div>
        <span class="lr-badge lr-badge-gray">${esc(titleCase(order.order_type||'Order'))}</span>
      </div>
      <div class="flex items-center justify-between gap-3 mt-4 pt-3 border-t text-[10px]">
        <span class="text-gray-400 font-bold">QTY: ${qty}</span>
        <span class="lr-badge ${eta?'lr-badge-blue':'lr-badge-gray'}">▣ ${esc(eta?formatDate(eta):'TBD')}</span>
      </div>
    </button>`;
  }

  function trackingOrderCard(order) {
    const open=ui.trackingExpanded.has(order.id);
    const stage=orderStage(order),m=stageMeta(stage),eta=orderEta(order);
    const qty=(order.items||[]).reduce((a,i)=>a+Number(i.qty||0),0);
    const contents=(order.items||[]).slice(0,5).map(i=>i.item_name_snapshot||i.product_code_snapshot).filter(Boolean).join(', ');
    return `<div class="lr-track-order ${open?'open':''}">
      <div class="lr-track-order-head" onclick="toggleTrackingOrder('${order.id}')">
        <div class="min-w-0 flex gap-3">
          <button class="w-8 h-8 rounded-lg border bg-gray-50 shrink-0">${open?'⌃':'⌄'}</button>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <b class="text-[15px]">${esc(order.order_no||order.invoice_no||'Order')}</b>
              <span class="lr-badge ${m.badge}">${esc(m.label)}</span>
              <span class="lr-badge lr-badge-gray">${esc(titleCase(order.order_type||'Order'))}</span>
              <span class="lr-badge lr-badge-gray">Total Qty: ${qty}</span>
            </div>
            <div class="text-[11px] mt-2"><span class="text-gray-400">Client:</span> <b>${esc(order.customer_name||'Customer')}</b></div>
            <div class="text-[10px] text-gray-400 mt-1 truncate">Contents: ${esc(contents||'No item detail')}</div>
            <div class="mt-3"><span class="lr-badge ${eta?'lr-badge-blue':'lr-badge-gray'}">▣ ETA: ${esc(eta?formatDate(eta):'TBD')}</span></div>
          </div>
        </div>
        <div class="text-right text-[10px] text-gray-400">${repName(order)?esc(repName(order)):''}</div>
      </div>
      ${open?`<div class="lr-detail grid gap-3">${(order.items||[]).map(trackingItemRow).join('')||'<div class="lr-empty">No item details.</div>'}</div>`:''}
    </div>`;
  }

  function trackingItemRow(item) {
    const o=item._order||{};
    const t=Array.isArray(item.item_tracking)?item.item_tracking[0]:item.item_tracking;
    const stage=itemStage(item,o),m=stageMeta(stage);
    const eta=t?.estimated_arrival;
    return `<div class="lr-track-item">
      <div class="lr-thumb" style="width:70px;height:70px">${imageHtml(item.image_url_snapshot||item.product_catalog?.image_url)}</div>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          ${o.order_no?`<b>${esc(o.order_no)}</b>`:''}
          <b>${Number(item.qty||0)}x</b>
          <span class="lr-badge lr-badge-gray">${esc(item.product_code_snapshot||'No Code')}</span>
          <span class="lr-badge ${m.badge}">${esc(m.label)}</span>
          ${eta?`<span class="lr-badge lr-badge-blue">ETA ${esc(formatDate(eta))}</span>`:''}
        </div>
        <div class="text-sm font-semibold mt-1">${esc(item.item_name_snapshot||item.product_catalog?.item_name||'Item')}</div>
        <div class="text-[11px] text-gray-400 mt-1">${esc(o.customer_name||'')}${item.product_catalog?.brand?' · '+esc(item.product_catalog.brand):''}</div>
      </div>
    </div>`;
  }

  window.setTrackingTab=function(tab){ui.trackingTab=tab;renderOrderTrackingBody();};
  window.setTrackingSearch=function(v){ui.trackingSearch=v;renderOrderTrackingBody();};
  window.toggleTrackingOrder=function(id){
    ui.trackingExpanded.has(id)?ui.trackingExpanded.delete(id):ui.trackingExpanded.add(id);
    renderOrderTrackingBody();
  };
  window.openTrackingOrder=function(id){
    ui.trackingTab='orders';
    ui.trackingExpanded.add(id);
    renderOrderTrackingBody();
    setTimeout(()=>document.getElementById('track-order-'+id)?.scrollIntoView({behavior:'smooth',block:'center'}),50);
  };

  window.renderOrderTrackingBody=function(){
    const root=document.getElementById('orderTrackingRoot');if(!root)return;
    const orders=ui.trackingOrders.filter(trackingMatches);
    const flat=orders.flatMap(o=>(o.items||[]).map(i=>({...i,_order:o})));
    const stages=['placed','production','shipping','completed'];

    let body='';
    if(ui.trackingTab==='timeline'){
      body=`<div class="lr-board">${stages.map(stage=>{
        const list=orders.filter(o=>orderStage(o)===stage),m=stageMeta(stage);
        return `<div class="lr-col"><div class="lr-col-head"><div class="flex items-center gap-2"><span style="width:8px;height:8px;border-radius:50%;background:${m.dot}"></span><b class="text-sm">${esc(m.label)}</b></div><span class="lr-badge lr-badge-gray">${list.length}</span></div><div class="lr-col-body">${list.map(o=>trackingCard(o,true)).join('')||'<div class="lr-empty">No orders</div>'}</div></div>`;
      }).join('')}</div>`;
    } else if(ui.trackingTab==='eta'){
      const groups=new Map();
      orders.forEach(o=>{const k=dateKey(orderEta(o));if(!groups.has(k))groups.set(k,[]);groups.get(k).push(o);});
      const keys=[...groups.keys()].sort((a,b)=>a==='TBD'?1:b==='TBD'?-1:a.localeCompare(b));
      body=keys.map(k=>`<div class="lr-eta-line"><div class="flex items-center gap-3 mb-3"><span class="lr-badge lr-badge-blue">${esc(k==='TBD'?'TBD':formatDate(k))}</span><span class="text-[10px] text-gray-400">${groups.get(k).length} order${groups.get(k).length===1?'':'s'}</span></div><div class="grid gap-3">${groups.get(k).map(trackingOrderCard).join('')}</div></div>`).join('')||'<div class="lr-panel lr-empty">No ETA records.</div>';
    } else if(ui.trackingTab==='orders'){
      body=`<div class="grid gap-3">${orders.map(o=>`<div id="track-order-${o.id}">${trackingOrderCard(o)}</div>`).join('')||'<div class="lr-panel lr-empty">No orders found.</div>'}</div>`;
    } else {
      body=`<div class="grid gap-3">${flat.map(trackingItemRow).join('')||'<div class="lr-panel lr-empty">No items found.</div>'}</div>`;
    }

    root.innerHTML=`
      ${repContextBanner()}
      <div class="lr-tabs mb-4">
        ${[['timeline','Status Timeline'],['eta','ETA Schedule'],['orders','Orders'],['items','Items']].map(([v,l])=>`<button class="lr-tab ${ui.trackingTab===v?'active':''}" onclick="setTrackingTab('${v}')">${l}</button>`).join('')}
      </div>
      <div class="relative mb-5">
        <input class="lr-input pl-10" value="${esc(ui.trackingSearch)}" oninput="setTrackingSearch(this.value)" placeholder="Search Order, Client, Item, Brand, SKU...">
        <span class="absolute left-3 top-2.5 text-gray-400">⌕</span>
      </div>
      ${body}`;
  };

  async function renderOrderTracking() {
    injectStyles();
    document.getElementById('content').innerHTML=`<div class="lr-shell"><div id="orderTrackingRoot"><div class="py-20 text-center text-gray-400">Loading order tracking...</div></div></div>`;
    await loadOrderTrackingData();
    renderOrderTrackingBody();
  }

  // Wrap current navigation so "Sales Orders" becomes "Sales Tracking" without
  // disturbing role/manager workspace logic loaded by earlier scripts.
  const previousNavItems = window.navItems;
  window.navItems = function(){
    const items=previousNavItems();
    return items.map(x=>x[0]==='sales-orders'?[x[0],'Sales Tracking',x[2]]:x);
  };

  // Override only the two screens requested by the user.
  window.renderSalesOrders = renderSalesTracking;
  window.renderTracking = renderOrderTracking;

  // Refresh sidebar if app is already loaded.
  try { if(state?.profile) renderNav(); } catch(_){}
  injectStyles();
})();