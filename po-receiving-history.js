// Read-only, screenshot-friendly Supplier PO Receiving History for Stock & Inventory.
(function(){
  'use strict';
  const reports=new Map();
  const safe=x=>typeof esc==='function'?esc(x==null?'':String(x)):String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const qty=x=>{
    const v=Number(x||0);
    return Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:3}):'0';
  };
  const day=x=>{
    if(!x)return '—';
    const t=String(x).slice(0,10);
    const d=new Date(t+'T00:00:00');
    return isNaN(d)?t:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  };
  const recorded=x=>{
    if(!x)return '—';
    const d=new Date(x);
    return isNaN(d)?String(x):d.toLocaleString('en-GB',{
      timeZone:'Asia/Phnom_Penh',day:'2-digit',month:'short',year:'numeric',
      hour:'2-digit',minute:'2-digit',hour12:false
    });
  };
  const prettyStatus=x=>x==='complete'?'Fully Received':x==='partial'?'Partially Received':'Receipt History';
  const cleanFile=x=>String(x||'PO').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80);
  const getEvents=i=>Array.isArray(i.receipt_events)?i.receipt_events:[];
  const findPO=id=>reports.get(String(id));
  function thumbnailUrl(raw){
    const value=String(raw||'').trim();
    return /^https?:\/\/[^\s<>"']+$/i.test(value)?value:'';
  }
  function productThumbnail(raw,small=false){
    const url=thumbnailUrl(raw),size=small?'por-thumb por-thumb-sm':'por-thumb';
    return '<span class="'+size+'">'+
      '<span class="por-thumb-placeholder">No Photo</span>'+
      (url?'<img src="'+safe(url)+'" alt="" loading="eager" decoding="async" onerror="this.style.display=\'none\'">':'')+
      '</span>';
  }
  async function loadReportPhotos(g){
    if(g.photosLoaded)return;
    const ids=[...new Set((g.items||[]).map(i=>i.po_item_id).filter(Boolean))];
    if(!ids.length){g.photosLoaded=true;return}
    const photos=new Map();
    for(let i=0;i<ids.length;i+=200){
      const r=await db.rpc('get_inventory_po_receipt_thumbnails',{p_item_ids:ids.slice(i,i+200)});
      if(r.error)throw r.error;
      (r.data||[]).forEach(x=>photos.set(String(x.po_item_id),thumbnailUrl(x.image_url)));
    }
    for(const item of g.items)item.image_url=photos.get(String(item.po_item_id))||'';
    g.photosLoaded=true;
  }
  const badgeClass=x=>x==='complete'?'border-green-200 bg-green-50 text-green-700':
    x==='partial'?'border-amber-200 bg-amber-50 text-amber-800':'border-blue-200 bg-blue-50 text-blue-700';

  function groupRows(rows){
    const grouped=new Map();
    for(const item of rows||[]){
      const id=String(item.supplier_po_id||'');
      if(!id)continue;
      if(!grouped.has(id))grouped.set(id,{
        id,po_number:item.po_number||'PO Pending',vendor_name:item.vendor_name||'Supplier',
        order_date:item.order_date,po_status:item.po_status,
        items:[],events:[],ordered:0,received:0,remaining:0,historical:false,
        lastDate:null,lastRecorded:null
      });
      const g=grouped.get(id);
      g.items.push(item);
      g.historical=g.historical||!!item.historical_reconciled;
      if(!item.historical_reconciled){
        g.ordered+=Number(item.ordered_qty||0);
        g.received+=Number(item.received_qty||0);
        g.remaining+=Math.max(0,Number(item.remaining_qty||0));
      }else{
        g.received+=Number(item.received_qty||0);
      }
      for(const entry of getEvents(item)){
        g.events.push({...entry,product_code:item.product_code,item_name:item.item_name});
        if(!g.lastDate||entry.receipt_date>g.lastDate)g.lastDate=entry.receipt_date;
        if(!g.lastRecorded||entry.recorded_at>g.lastRecorded)g.lastRecorded=entry.recorded_at;
      }
    }
    const result=[...grouped.values()];
    result.forEach(g=>{
      g.events.sort((a,b)=>String(b.receipt_date).localeCompare(String(a.receipt_date))
        ||String(b.recorded_at).localeCompare(String(a.recorded_at)));
      g.locations=[...new Set(g.events.map(e=>e.location_code).filter(Boolean))];
      g.people=[...new Set(g.events.map(e=>e.received_by).filter(Boolean))];
      g.status=g.historical?'mixed':g.remaining<=0?'complete':'partial';
    });
    result.sort((a,b)=>String(b.lastRecorded||'').localeCompare(String(a.lastRecorded||'')));
    return result;
  }

  async function load(search){
    const r=await db.rpc('get_inventory_po_receipt_history',{
      p_search:String(search||'').trim()||null,p_limit:250
    });
    if(r.error)throw r.error;
    const groups=groupRows(r.data||[]);
    reports.clear();groups.forEach(g=>reports.set(String(g.id),g));
    return groups;
  }

  function summaryCard(g){
    return '<div class="rounded-2xl border border-[#ece6dc] bg-white p-4 lg:p-5">'+
      '<div class="flex flex-wrap items-start justify-between gap-3">'+
      '<div><div class="text-[10px] font-semibold tracking-wide text-[#9b792e]">SUPPLIER PO RECEIPT</div>'+
      '<div class="text-lg font-bold mt-1">'+safe(g.po_number)+'</div>'+
      '<div class="text-xs text-gray-500 mt-1">'+safe(g.vendor_name)+'</div>'+
      '<div class="text-[11px] text-gray-400 mt-1">Last received: '+safe(day(g.lastDate))+
      ' · '+g.events.length+' receipt record'+(g.events.length===1?'':'s')+'</div></div>'+
      '<span class="inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[10px] font-bold '+badgeClass(g.status)+'">'+
        safe(prettyStatus(g.status))+'</span></div>'+
      '<div class="grid grid-cols-3 gap-2 mt-4">'+
      [['Ordered',g.ordered],['Received',g.received],['Outstanding',g.remaining]].map((x,i)=>
        '<div class="rounded-xl bg-[#faf9f6] border border-[#eeeae2] p-3">'+
        '<div class="text-[10px] text-gray-400">'+x[0]+'</div>'+
        '<div class="text-xl font-bold mt-1 '+(i===1?'text-green-700':'')+'">'+qty(x[1])+'</div></div>'
      ).join('')+'</div>'+
      (g.historical?'<p class="text-[10px] text-purple-700 mt-2">Totals exclude historically reconciled lines without live receiving records.</p>':'')+
      '<div class="flex flex-wrap items-center justify-between gap-3 mt-4">'+
      '<div class="text-xs text-gray-500">Location: <b>'+safe(g.locations.join(', ')||'Not recorded')+'</b></div>'+
      '<div class="flex gap-2">'+
      '<button type="button" class="border border-[#dcc898] bg-[#fffaf0] text-[#8c661f] rounded-lg px-3 py-2 text-xs font-bold" onclick="openPOReceivingHistoryReport(\''+safe(g.id)+'\')">View Report</button>'+
      '<button type="button" class="border rounded-lg px-3 py-2 text-xs font-semibold" onclick="openPOReceivingMovements(\''+safe(g.po_number)+'\')">Movements</button>'+
      '</div></div></div>';
  }

  window.renderPOReceivingHistory=async function(search=''){
    const groups=await load(search);
    const receipts=groups.reduce((sum,g)=>sum+g.events.length,0);
    return '<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 mb-4 text-xs text-blue-800">'+
      '<b>PO Receiving History:</b> reports show only actual posted PO Receipt stock movements. Changing a Supplier PO to Arrived without receiving stock does not create a receipt here. Historical/reconciled stock without a receipt is not counted. '+
      'Use <b>View Report</b> to generate a clean report for Telegram.</div>'+
      '<div class="flex flex-wrap items-center justify-between gap-3 mb-4">'+
      '<div><h3 class="font-bold text-lg">Received Supplier POs</h3>'+
      '<div class="text-xs text-gray-500 mt-1">'+groups.length+' POs · '+receipts+' posted receiving action'+(receipts===1?'':'s')+
      ' · Showing the latest 250 matching POs</div></div>'+
      '<button onclick="setInventoryTab(\'receive\')" class="border rounded-xl px-4 py-2.5 text-xs font-semibold bg-white">Receive Another PO →</button>'+
      '</div>'+
      '<div class="grid lg:grid-cols-2 gap-3">'+
      (groups.length?groups.map(summaryCard).join(''):
        '<div class="col-span-full rounded-2xl border bg-white py-12 text-center text-sm text-gray-500">'+
        (search?'No PO receiving history matches this search.':'No posted PO stock receipts yet.')+'</div>')+
      '</div>';
  };

  function reportStyles(){
    return '.por-capture{font-family:Arial,Helvetica,sans-serif;color:#231f1b;background:#fff;border-radius:10px;box-sizing:border-box;width:100%;padding:30px;font-size:12px}'+
      '.por-head{border-bottom:2px solid #b59550;padding-bottom:16px;display:flex;justify-content:space-between;gap:20px}'+
      '.por-kicker{font-size:10px;font-weight:800;letter-spacing:2px;color:#96712b}'+
      '.por-title{font-size:25px;font-weight:800;letter-spacing:-.6px;margin:6px 0}'+
      '.por-muted{color:#736c62;font-size:11px}'+
      '.por-status{align-self:flex-start;border:1px solid #cec3a9;padding:7px 12px;border-radius:50px;font-size:11px;font-weight:bold;white-space:nowrap}'+
      '.por-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}'+
      '.por-field{background:#faf9f6;padding:10px 12px;border:1px solid #ece7df;border-radius:8px;min-width:0}'+
      '.por-label{font-size:9px;letter-spacing:.5px;text-transform:uppercase;color:#8a8178;font-weight:700}'+
      '.por-value{font-size:13px;font-weight:bold;margin-top:5px;overflow-wrap:anywhere}'+
      '.por-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 18px}'+
      '.por-stat{border:1px solid #e7dfd1;padding:13px;border-radius:8px;background:#fffdf8}'+
      '.por-stat b{display:block;font-size:23px;margin-top:6px}'+
      '.por-section{margin-top:22px;margin-bottom:10px;font-size:13px;font-weight:800;color:#3b3121}'+
      '.por-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px}'+
      '.por-table th{background:#f6f2ea;text-transform:uppercase;color:#6e624f;text-align:left;font-size:9px;padding:11px 8px;border-bottom:1px solid #ddd2bd}'+
      '.por-table td{padding:10px 8px;border-bottom:1px solid #ede9e3;vertical-align:top;overflow-wrap:anywhere}'+
      '.por-table th.num,.por-table td.num{text-align:right}'+
      '.por-product{display:flex;align-items:center;gap:10px;min-width:0}'+
      '.por-product-info{min-width:0;flex:1}'+
      '.por-thumb{width:46px;height:46px;flex:0 0 46px;display:inline-flex;align-items:center;justify-content:center;position:relative;overflow:hidden;border:1px solid #e8e2d7;border-radius:7px;background:#f7f6f3}'+
      '.por-thumb-sm{width:30px;height:30px;flex-basis:30px;border-radius:5px}'+
      '.por-thumb-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:7px;color:#aba399;text-align:center}'+
      '.por-thumb-sm .por-thumb-placeholder{font-size:6px}'+
      '.por-thumb img{position:relative;z-index:1;width:100%;height:100%;object-fit:contain;background:white}'+
      '.por-code{font-weight:800;color:#9b762f;font-size:10px}'+
      '.por-note{font-size:9px;line-height:1.5;color:#6b6257;margin-top:14px}'+
      '.por-footer{margin-top:24px;padding-top:13px;border-top:1px solid #e2d8c6;display:flex;justify-content:space-between;gap:10px;font-size:10px;color:#7c756b}';
  }

  let stylesLoaded=false;
  function ensureStyles(){
    if(stylesLoaded)return;
    const style=document.createElement('style');
    style.id='poReceivingHistoryStyle';
    style.textContent=reportStyles();
    document.head.appendChild(style);stylesLoaded=true;
  }

  function captureMarkup(g){
    const itemRows=g.items.map(i=>{
      const historic=!!i.historical_reconciled;
      const locs=[...new Set(getEvents(i).map(x=>x.location_code).filter(Boolean))];
      return '<tr>'+
        '<td style="width:46%"><div class="por-product">'+productThumbnail(i.image_url)+
          '<div class="por-product-info"><div class="por-code">'+safe(i.product_code||'No Code')+'</div>'+
          '<div style="margin-top:3px">'+safe(i.item_name||'')+'</div>'+
          (historic?'<div style="font-size:9px;color:#6d4798;margin-top:3px">Historically reconciled</div>':'')+
          '</div></div></td>'+
        '<td class="num">'+qty(i.ordered_qty)+'</td>'+
        '<td class="num" style="font-weight:800;color:#17663b">'+qty(i.received_qty)+'</td>'+
        '<td class="num">'+(historic?'—':qty(i.remaining_qty))+'</td>'+
        '<td>'+safe(locs.join(', ')||'—')+'</td>'+
        '</tr>';
    }).join('');
    const eventRows=g.events.map(x=>
      '<tr><td>'+safe(day(x.receipt_date))+'</td>'+
        '<td><div class="por-product">'+productThumbnail(g.items.find(i=>i.product_code===x.product_code)?.image_url,true)+
          '<div class="por-product-info"><b>'+safe(x.product_code)+'</b></div></div></td>'+
        '<td class="num" style="font-weight:bold;color:#17663b">+'+qty(x.qty)+'</td>'+
        '<td>'+safe(x.location_code||'—')+'</td>'+
        '<td>'+safe(x.received_by||'System')+'</td>'+
        '<td>'+safe(x.note||'—')+'</td></tr>'
    ).join('');
    const field=(label,value)=>'<div class="por-field"><div class="por-label">'+label+
      '</div><div class="por-value">'+safe(value)+'</div></div>';
    return '<section id="poReceiptCapture" class="por-capture">'+
      '<header class="por-head">'+
        '<div><div class="por-kicker">L’IMPERIAL · STOCK &amp; INVENTORY</div>'+
        '<h2 class="por-title">PO Receiving Report</h2>'+
        '<div class="por-muted">System-recorded stock receipt confirmation</div></div>'+
        '<div class="por-status">'+safe(prettyStatus(g.status))+'</div>'+
      '</header>'+
      '<div class="por-details">'+
        field('Supplier PO',g.po_number)+field('Supplier',g.vendor_name)+field('Latest receipt',day(g.lastDate))+
        field('Storage location'+(g.locations.length===1?'':'s'),g.locations.join(', ')||'—')+
        field('Recorded by',g.people.join(', ')||'System')+
        field('Receipt actions',String(g.events.length))+
      '</div>'+
      '<div class="por-stats">'+
        '<div class="por-stat"><div class="por-label">Ordered (live PO lines)</div><b>'+qty(g.ordered)+'</b></div>'+
        '<div class="por-stat"><div class="por-label">Received into stock</div><b style="color:#17663b">'+qty(g.received)+'</b></div>'+
        '<div class="por-stat"><div class="por-label">Remaining to receive</div><b>'+qty(g.remaining)+'</b></div>'+
      '</div>'+
      '<div class="por-section">Received items &amp; balances</div>'+
      '<table class="por-table"><thead><tr>'+
        '<th style="width:46%">Product / Code</th><th class="num">Ordered</th><th class="num">Received</th>'+
        '<th class="num">Remaining</th><th>Location</th>'+
      '</tr></thead><tbody>'+itemRows+'</tbody></table>'+
      '<div class="por-section">Receipt activity log</div>'+
      '<table class="por-table"><thead><tr>'+
        '<th>Date</th><th>Product code</th><th class="num">Qty IN</th><th>Location</th>'+
        '<th>Received by</th><th>Remark</th></tr></thead><tbody>'+eventRows+'</tbody></table>'+
      (g.historical?'<p class="por-note">* Historical/reconciled lines are not included in live ordered/outstanding totals unless they have posted receiving records. These are not recreated by this report.</p>':'')+
      '<p class="por-note">Based on posted “PO Receipt” stock movement records only. Dates reflect the recorded physical receipt dates. This report does not receive stock, approve movements or change inventory.</p>'+
      '<footer class="por-footer"><span>L’IMPERIAL HOME · Internal receiving record</span>'+
        '<span>Report prepared '+safe(recorded(new Date().toISOString()))+' (Phnom Penh)</span></footer>'+
    '</section>';
  }

  window.openPOReceivingHistoryReport=async function(id){
    try{
      let g=findPO(id);
      if(!g){
        const rows=await db.rpc('get_inventory_po_receipt_history',{p_search:null,p_limit:500});
        if(rows.error)throw rows.error;
        const groups=groupRows(rows.data||[]);
        g=groups.find(x=>String(x.id)===String(id));
        if(g)reports.set(String(id),g);
      }
      if(!g)throw new Error('PO receiving report not found or you do not have access.');
      try{
        await loadReportPhotos(g);
      }catch(err){
        console.warn('PO receipt thumbnails are unavailable:',err);
        showToast('Product photos could not be loaded. The receiving report remains available.','err');
      }
      ensureStyles();
      openModal('PO Receiving History · '+g.po_number,
        '<div class="space-y-3">'+
        '<div class="flex flex-wrap justify-between gap-2 items-center">'+
        '<p class="text-xs text-gray-500">Share this clean receipt report in your team group.</p>'+
        '<div class="flex flex-wrap gap-2">'+
          '<button onclick="downloadPOReceivingHistoryImage()" id="poReceiptPNG" class="rounded-lg bg-[#211d18] px-3 py-2 text-white text-xs font-bold">Save as Image (PNG)</button>'+
          '<button onclick="sharePOReceivingHistoryImage()" class="rounded-lg border px-3 py-2 text-xs font-semibold">Share Image</button>'+
          '<button onclick="exportPOReceivingHistoryExcel()" class="rounded-lg border px-3 py-2 text-xs font-semibold">Export Excel</button>'+
          '<button onclick="printPOReceivingHistory()" class="rounded-lg border px-3 py-2 text-xs font-semibold">Print / PDF</button>'+
        '</div></div>'+
        '<div class="border rounded-xl overflow-auto bg-[#f1efe9] p-2 sm:p-3">'+
          '<div style="max-width:920px;min-width:640px;margin:0 auto">'+captureMarkup(g)+'</div>'+
        '</div>'+
        '<p class="text-[11px] text-gray-500">The image and Excel file include the full receiving log, even if the preview scrolls.</p>'+
        '</div>');
      window._currentPOReceivingReport=g;
    }catch(e){showToast(e.message||'Could not open PO receiving report','err')}
  };

  window.openPOReceivingMovements=function(number){
    if(typeof window.setInventoryTab!=='function')return;
    // Use existing Movements page, which retains the original stock ledger.
    window.setInventoryTab('movements');
    const input=document.querySelector('.inv-search');
    if(input){input.value=number;window.setInventorySearch(number)}
  };

  async function imageBlob(){
    const el=document.getElementById('poReceiptCapture');
    if(!el)throw new Error('Open a PO report first.');
    if(typeof window.html2canvas!=='function')throw new Error('Image capture library is still loading. Refresh the app and try again.');
    const imageWaits=[...el.querySelectorAll('.por-thumb img')].map(img=>
      img.complete?Promise.resolve():new Promise(resolve=>{
        img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',resolve,{once:true});
      })
    );
    await Promise.race([
      Promise.all(imageWaits),
      new Promise(resolve=>setTimeout(resolve,5000))
    ]);
    const height=el.scrollHeight||el.offsetHeight||1500;
    const scale=Math.min(2,Math.max(1,12000/Math.max(height,1)));
    const canvas=await window.html2canvas(el,{
      scale,backgroundColor:'#ffffff',useCORS:true,allowTaint:false,
      logging:false,scrollX:0,scrollY:-window.scrollY
    });
    return new Promise((resolve,reject)=>canvas.toBlob(
      b=>b?resolve(b):reject(new Error('Could not create image. Try Print / PDF instead.')),
      'image/png'
    ));
  }
  function saveFile(blob,name){
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }

  window.downloadPOReceivingHistoryImage=async function(){
    const g=window._currentPOReceivingReport;
    if(!g)return;
    const button=document.getElementById('poReceiptPNG');
    if(button)button.disabled=true;
    try{
      const blob=await imageBlob();
      saveFile(blob,'PO_Receiving_'+cleanFile(g.po_number)+'.png');
      showToast('PO receiving image saved. Attach it to your Telegram group.');
    }catch(e){showToast(e.message,'err')}
    finally{if(button)button.disabled=false}
  };

  window.sharePOReceivingHistoryImage=async function(){
    const g=window._currentPOReceivingReport;
    if(!g)return;
    try{
      const blob=await imageBlob();
      const name='PO_Receiving_'+cleanFile(g.po_number)+'.png';
      const file=new File([blob],name,{type:'image/png'});
      if(navigator.canShare&&navigator.canShare({files:[file]})&&navigator.share){
        await navigator.share({files:[file],title:'PO Receiving · '+g.po_number});
      }else{
        saveFile(blob,name);
        showToast('Image downloaded. Attach it to your Telegram group.');
      }
    }catch(e){if(e.name!=='AbortError')showToast(e.message,'err')}
  };

  window.exportPOReceivingHistoryExcel=async function(){
    const g=window._currentPOReceivingReport;
    if(!g)return;
    if(typeof ExcelJS==='undefined')return showToast('Excel export is unavailable; refresh and try again.','err');
    try{
      const wb=new ExcelJS.Workbook();
      wb.creator='L’Imperial Stock & Inventory';
      const sh=wb.addWorksheet('PO Receiving Report');
      sh.columns=[{width:23},{width:43},{width:17},{width:18},{width:18},{width:22}];
      const text=v=>{
        const s=String(v??'');
        return /^[\s]*[=+\-@]/.test(s)?"'"+s:s;
      };
      sh.addRow(['L’IMPERIAL · PO RECEIVING REPORT']);
      sh.addRow(['Supplier PO',text(g.po_number),'Supplier',text(g.vendor_name)]);
      sh.addRow(['Last Receipt',g.lastDate||'','Status',prettyStatus(g.status)]);
      sh.addRow(['Recorded By',text(g.people.join(', ')),'Location(s)',text(g.locations.join(', '))]);
      sh.addRow(['Live Ordered',g.ordered,'Posted Received',g.received,'Remaining',g.remaining]);
      sh.addRow([]);
      const header=sh.addRow(['Product Code','Item Name','Ordered','Received','Remaining','Receiving Locations']);
      header.font={bold:true,color:{argb:'FFFFFFFF'}};header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF30271C'}};
      for(const i of g.items){
        const locations=[...new Set(getEvents(i).map(x=>x.location_code).filter(Boolean))].join(', ');
        sh.addRow([
          text(i.product_code),text(i.item_name),Number(i.ordered_qty||0),
          Number(i.received_qty||0),i.historical_reconciled?null:Number(i.remaining_qty||0),
          text(locations)
        ]);
      }
      const details=wb.addWorksheet('Receiving Log');
      details.columns=[
        {header:'Receipt Date',key:'date',width:18},
        {header:'PO Number',key:'po',width:20},
        {header:'Product Code',key:'code',width:28},
        {header:'Item Name',key:'name',width:44},
        {header:'Qty Received',key:'qty',width:18},
        {header:'Location',key:'location',width:18},
        {header:'Received By',key:'user',width:25},
        {header:'Remark',key:'remark',width:38},
        {header:'Recorded Time (Phnom Penh)',key:'recorded',width:30}
      ];
      details.getRow(1).font={bold:true};
      for(const e of g.events){
        details.addRow({
          date:e.receipt_date||'',po:text(g.po_number),code:text(e.product_code),
          name:text(e.item_name),qty:Number(e.qty||0),
          location:text(e.location_code),user:text(e.received_by),
          remark:text(e.note||''),recorded:recorded(e.recorded_at)
        });
      }
      const buffer=await wb.xlsx.writeBuffer();
      saveFile(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
        'PO_Receiving_'+cleanFile(g.po_number)+'.xlsx');
      showToast('PO receiving report exported.');
    }catch(e){showToast(e.message||'Could not export Excel','err')}
  };

  window.printPOReceivingHistory=function(){
    const g=window._currentPOReceivingReport;
    if(!g)return;
    const popup=window.open('','_blank');
    if(!popup)return showToast('Allow popups to print or save this report as a PDF.','err');
    const content=captureMarkup(g);
    popup.document.open();
    popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>PO Receiving '+safe(g.po_number)+'</title>'+
      '<style>body{margin:0;background:#fff}'+reportStyles()+
      '@page{size:A4 portrait;margin:12mm}@media print{.por-capture{padding:0}.por-table tr{break-inside:avoid}}'+
      '</style></head><body>'+content+'</body></html>');
    popup.document.close();
    popup.focus();
    const waits=[...popup.document.querySelectorAll('.por-thumb img')].map(img=>
      img.complete?Promise.resolve():new Promise(resolve=>{
        img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',resolve,{once:true});
      })
    );
    Promise.race([Promise.all(waits),new Promise(resolve=>setTimeout(resolve,5000))])
      .then(()=>{if(!popup.closed)popup.print()});
  };
})();