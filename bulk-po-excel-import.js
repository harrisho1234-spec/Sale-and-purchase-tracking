// Bulk Supplier PO import from one Excel/CSV file.
// Supports multiple Official PO Numbers in a single workbook.
(function(){
  const bulkState={file:null,pos:[],errors:[],warnings:[],knownProducts:new Map(),existingPOs:new Set()};

  function role(){return state.profile?.role||''}
  function canBulkImport(){return ['admin','super_admin'].includes(role())}
  function n(v){const x=Number(String(v??'').replace(/[$,\s]/g,''));return Number.isFinite(x)?x:0}
  function clean(v){return String(v??'').trim()}
  function norm(v){return clean(v).toLowerCase()}
  function h(v){return norm(v).replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}

  function headerKey(v){
    const x=h(v);
    const m={
      'official po number':'po_number','po number':'po_number','official po':'po_number',
      'vendor supplier':'vendor_name','vendor':'vendor_name','supplier':'vendor_name',
      'order date':'order_date','date':'order_date',
      'currency':'currency',
      'shipping agent':'shipping_agent','agent':'shipping_agent',
      'eta':'estimated_arrival','estimated arrival':'estimated_arrival','estimated arrival date':'estimated_arrival',
      'code':'code','sku':'code','product code':'code','product code sku':'code',
      'qty':'qty','quantity':'qty',
      'unit cost':'unit_cost','cost':'unit_cost',
      'shipping unit':'shipping_cost','shipping per unit':'shipping_cost','shipping cost unit':'shipping_cost','shipping cost per unit':'shipping_cost',
      'item name':'item_name','product name':'item_name'
    };
    return m[x]||x.replace(/\s+/g,'_');
  }

  function excelDate(v){
    if(v===undefined||v===null||v==='')return '';
    if(v instanceof Date&&!Number.isNaN(v.getTime())){
      return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
    }
    if(typeof v==='number'&&window.XLSX?.SSF?.parse_date_code){
      const d=XLSX.SSF.parse_date_code(v);
      if(d)return `${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
    const s=clean(v);
    if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)){
      const [y,m,d]=s.split('-');return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    const d=new Date(s);
    if(!Number.isNaN(d.getTime()))return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return '';
  }

  function findHeader(matrix){
    for(let i=0;i<Math.min(matrix.length,15);i++){
      const hs=(matrix[i]||[]).map(h);
      if(hs.some(x=>['official po number','po number','official po'].includes(x))
        && hs.some(x=>['code','sku','product code','product code sku'].includes(x))
        && hs.some(x=>['qty','quantity'].includes(x)))return i;
    }
    return -1;
  }

  async function readMatrix(file){
    if(!window.XLSX)throw new Error('Excel importer is still loading. Refresh the page and try again.');
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array',cellDates:true});
    const ws=wb.Sheets[wb.SheetNames[0]];
    if(!ws)throw new Error('The workbook has no worksheet.');
    return XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  }

  function parseRows(matrix){
    const hi=findHeader(matrix);
    if(hi<0)throw new Error('Could not find the required headers: Official PO Number, Code and QTY.');
    const headers=(matrix[hi]||[]).map(headerKey);
    const raw=[];
    for(let ri=hi+1;ri<matrix.length;ri++){
      const vals=matrix[ri]||[];
      const row={_row:ri+1};
      headers.forEach((k,i)=>{if(k)row[k]=vals[i]});
      if(Object.entries(row).some(([k,v])=>k!=='_row'&&clean(v)!==''))raw.push(row);
    }

    const pos=[];
    const byPO=new Map();
    let current=null;

    for(const r of raw){
      const explicitPO=clean(r.po_number);
      if(explicitPO){
        if(!current||norm(current.po_number)!==norm(explicitPO)){
          current={
            po_number:explicitPO,
            vendor_name:'',
            order_date:'',
            currency:'USD',
            shipping_agent:'',
            estimated_arrival:'',
            items:[],
            source_rows:[]
          };
          pos.push(current);
          byPO.set(norm(explicitPO),current);
        }
      }
      if(!current){
        throw new Error(`Row ${r._row}: Official PO Number is required on the first row of each PO group.`);
      }

      // Header values may appear only on the first row of a PO; continuation item rows can leave them blank.
      if(clean(r.vendor_name))current.vendor_name=clean(r.vendor_name);
      if(clean(r.order_date))current.order_date=excelDate(r.order_date);
      if(clean(r.currency))current.currency=clean(r.currency).toUpperCase();
      if(clean(r.shipping_agent))current.shipping_agent=clean(r.shipping_agent);
      if(clean(r.estimated_arrival))current.estimated_arrival=excelDate(r.estimated_arrival);
      current.source_rows.push(r._row);

      const code=clean(r.code);
      const itemName=clean(r.item_name);
      const qty=n(r.qty);
      const cost=n(r.unit_cost);
      const ship=n(r.shipping_cost);
      const itemish=code||itemName||clean(r.qty)||clean(r.unit_cost)||clean(r.shipping_cost);
      if(itemish){
        current.items.push({
          code,
          item_name:itemName,
          qty,
          unit_cost:cost,
          shipping_cost:ship,
          _row:r._row
        });
      }
    }
    return pos;
  }

  async function loadKnownProducts(){
    const map=new Map();
    for(let from=0;;from+=1000){
      const {data,error}=await db.from('product_catalog').select('id,code,item_name,active').order('code').range(from,from+999);
      if(error)throw error;
      for(const p of data||[])map.set(norm(p.code),p);
      if(!data||data.length<1000)break;
    }
    return map;
  }

  async function loadExistingPOs(){
    const set=new Set();
    for(let from=0;;from+=1000){
      const {data,error}=await db.from('supplier_pos').select('po_number').not('po_number','is',null).range(from,from+999);
      if(error)throw error;
      for(const p of data||[])if(clean(p.po_number))set.add(norm(p.po_number));
      if(!data||data.length<1000)break;
    }
    return set;
  }

  function validate(){
    const errors=[],warnings=[];
    const seen=new Set();
    for(const po of bulkState.pos){
      if(!po.po_number)errors.push('A PO group has no Official PO Number.');
      if(seen.has(norm(po.po_number)))errors.push(`Duplicate PO number in file: ${po.po_number}`);
      seen.add(norm(po.po_number));

      if(bulkState.existingPOs.has(norm(po.po_number)))errors.push(`${po.po_number} already exists in the system.`);
      if(!po.vendor_name)errors.push(`${po.po_number}: Vendor / Supplier is missing.`);
      if(!po.order_date)errors.push(`${po.po_number}: Order Date is missing or invalid.`);
      if(!po.items.length)errors.push(`${po.po_number}: no item rows found.`);

      for(const item of po.items){
        if(!item.code)errors.push(`${po.po_number}, Excel row ${item._row}: Code / SKU is missing.`);
        if(!(item.qty>0))errors.push(`${po.po_number}, ${item.code||'item'}: QTY must be greater than zero.`);
        if(item.unit_cost<0||item.shipping_cost<0)errors.push(`${po.po_number}, ${item.code||'item'}: cost/shipping cannot be negative.`);
        const known=bulkState.knownProducts.get(norm(item.code));
        if(!known&&!item.item_name)errors.push(`${po.po_number}, ${item.code}: new SKU needs an Item Name column/value.`);
        if(!known&&item.item_name)warnings.push(`${po.po_number}, ${item.code}: new SKU "${item.item_name}".`);
        if(known&&!item.item_name)item.item_name=known.item_name||'';
      }
    }
    bulkState.errors=[...new Set(errors)];
    bulkState.warnings=[...new Set(warnings)];
  }

  function totalItems(){return bulkState.pos.reduce((a,p)=>a+p.items.length,0)}
  function totalValue(po){return po.items.reduce((a,i)=>a+(i.qty*i.unit_cost)+(i.qty*i.shipping_cost),0)}

  function previewHTML(){
    const errorBox=bulkState.errors.length?`<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><b>Fix before importing:</b><div class="mt-2 space-y-1">${bulkState.errors.slice(0,12).map(x=>`<div>• ${esc(x)}</div>`).join('')}${bulkState.errors.length>12?`<div>• + ${bulkState.errors.length-12} more</div>`:''}</div></div>`:'';
    const warnBox=!bulkState.errors.length&&bulkState.warnings.length?`<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><b>New SKUs detected:</b> ${bulkState.warnings.length}. If "Add new SKUs" is checked, they will be added to Product Catalog.</div>`:'';

    return `
      <div class="space-y-4">
        <div class="grid sm:grid-cols-3 gap-3">
          <div class="rounded-xl border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">POs Found</div><div class="text-xl font-bold mt-1">${bulkState.pos.length}</div></div>
          <div class="rounded-xl border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Item Rows</div><div class="text-xl font-bold mt-1">${totalItems()}</div></div>
          <div class="rounded-xl border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Validation</div><div class="text-sm font-bold mt-1 ${bulkState.errors.length?'text-red-600':'text-green-600'}">${bulkState.errors.length?bulkState.errors.length+' issue(s)':'Ready to import'}</div></div>
        </div>
        ${errorBox}${warnBox}
        <div class="rounded-xl border overflow-hidden max-h-[42vh] overflow-y-auto">
          <div class="divide-y">
            ${bulkState.pos.map(po=>`<div class="p-3 grid md:grid-cols-[1fr_1.2fr_90px_110px_120px] gap-3 items-center">
              <div><b>${esc(po.po_number)}</b><div class="text-[10px] text-gray-400">${esc(po.order_date||'No date')}</div></div>
              <div><div class="text-sm font-semibold">${esc(po.vendor_name||'Missing supplier')}</div><div class="text-[10px] text-gray-400">${esc(po.shipping_agent||'No shipping agent')}</div></div>
              <div class="text-xs">${po.items.length} item${po.items.length===1?'':'s'}</div>
              <div class="text-xs">${esc(po.currency||'USD')}</div>
              <div class="text-right text-xs font-bold">${money(totalValue(po),po.currency||'USD')}</div>
            </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  function renderPreview(){
    const el=document.getElementById('bulkPOPreview');
    if(el)el.innerHTML=previewHTML();
    const btn=document.getElementById('bulkPOImportBtn');
    if(btn){
      btn.disabled=bulkState.errors.length>0||!bulkState.pos.length;
      btn.textContent=bulkState.pos.length?`Import ${bulkState.pos.length} Supplier PO${bulkState.pos.length===1?'':'s'}`:'Import Supplier POs';
    }
  }

  window.bulkPOFileChanged=async function(input){
    const file=input.files?.[0];
    bulkState.file=file||null;
    bulkState.pos=[];bulkState.errors=[];bulkState.warnings=[];
    const status=document.getElementById('bulkPOFileStatus');
    if(!file){if(status)status.textContent='';renderPreview();return}

    if(!/\.(xlsx|xls|csv)$/i.test(file.name||'')){
      bulkState.errors=['Please choose an Excel (.xlsx/.xls) or CSV file.'];
      renderPreview();return;
    }

    if(status)status.textContent='Reading and validating workbook...';
    try{
      const [matrix,products,existing]=await Promise.all([
        readMatrix(file),
        loadKnownProducts(),
        loadExistingPOs()
      ]);
      bulkState.knownProducts=products;
      bulkState.existingPOs=existing;
      bulkState.pos=parseRows(matrix);
      validate();
      if(status)status.textContent=`${file.name} · ${bulkState.pos.length} PO${bulkState.pos.length===1?'':'s'} found`;
    }catch(err){
      bulkState.errors=[err.message||'Could not read workbook'];
      if(status)status.textContent=file.name;
    }
    renderPreview();
  };

  window.openBulkPOImport=function(){
    if(!canBulkImport())return showToast('Admin or Super Admin access required.','err');
    bulkState.file=null;bulkState.pos=[];bulkState.errors=[];bulkState.warnings=[];
    openModal('Bulk Import Supplier POs',`<div class="space-y-5">
      <div class="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-800">
        Upload <b>one Excel file containing multiple Official PO Numbers</b>. The system groups rows by PO Number and creates each Supplier PO with its own items. This bulk file is an import source; it is not attached as the individual supplier document for every PO.
      </div>

      <div>
        <div class="flex items-center justify-between gap-3 mb-2">
          <label class="text-xs font-semibold">Excel / CSV File</label>
          <button type="button" onclick="downloadBulkPOExcelTemplate()" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold">Download Bulk Template</button>
        </div>
        <input type="file" accept=".xlsx,.xls,.csv" onchange="bulkPOFileChanged(this)" class="w-full border rounded-xl px-3 py-2 bg-white">
        <div id="bulkPOFileStatus" class="text-[10px] text-gray-400 mt-1">Required: Official PO Number, Vendor / Supplier, Order Date, Currency, Code, QTY, Unit Cost, Shipping / Unit. Item Name is only required for a new SKU.</div>
      </div>

      <label class="flex items-start gap-2 rounded-xl border p-3 text-xs">
        <input id="bulkPOCreateProducts" type="checkbox" checked class="mt-0.5">
        <span><b>Add new SKUs to Product Catalog as active.</b><br><span class="text-gray-400">Existing codes are matched automatically. New codes require Item Name in the Excel file.</span></span>
      </label>

      <div id="bulkPOPreview"><div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">Choose an Excel file to preview the POs before importing.</div></div>

      <div class="flex flex-col sm:flex-row justify-end gap-2 border-t pt-4">
        <button type="button" onclick="closeModal()" class="px-4 py-2.5 border rounded-xl text-xs font-semibold">Cancel</button>
        <button id="bulkPOImportBtn" type="button" disabled onclick="saveBulkPOImport()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold disabled:opacity-40">Import Supplier POs</button>
      </div>
    </div>`);
  };

  window.saveBulkPOImport=async function(){
    if(!canBulkImport())return showToast('Admin or Super Admin access required.','err');
    if(!bulkState.pos.length||bulkState.errors.length)return showToast('Fix the import issues before saving.','err');

    const btn=document.getElementById('bulkPOImportBtn');
    btn.disabled=true;btn.textContent='Importing...';

    const payload=bulkState.pos.map(po=>({
      po_number:po.po_number,
      vendor_name:po.vendor_name,
      order_date:po.order_date,
      currency:po.currency||'USD',
      shipping_agent:po.shipping_agent||null,
      estimated_arrival:po.estimated_arrival||null,
      items:po.items.map(i=>({
        code:i.code,
        item_name:i.item_name||null,
        qty:i.qty,
        unit_cost:i.unit_cost,
        shipping_cost:i.shipping_cost
      }))
    }));

    const {data,error}=await db.rpc('bulk_create_supplier_pos',{
      p_pos:payload,
      p_create_new_products:document.getElementById('bulkPOCreateProducts')?.checked!==false
    });
    if(error){
      btn.disabled=false;btn.textContent=`Import ${bulkState.pos.length} Supplier PO${bulkState.pos.length===1?'':'s'}`;
      return showToast(error.message,'err');
    }

    closeModal();
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    showToast(`Imported ${Number(data?.created_po_count||0)} POs with ${Number(data?.created_item_count||0)} item rows${Number(data?.new_product_count||0)>0?` · ${Number(data.new_product_count)} new SKUs added`:''}`);
    await go('procurement');
  };

  window.downloadBulkPOExcelTemplate=function(){
    if(!window.XLSX)return showToast('Excel template tool is still loading. Refresh and try again.','err');
    const rows=[
      ['Official PO Number','Vendor / Supplier','Order Date','Currency','Shipping Agent','ETA','Code','QTY','Unit Cost','Shipping / Unit','Item Name'],
      ['PO-2026-001','Supplier A','2026-09-24','USD','Agent A','2026-11-15','SKU-001',2,100,10,''],
      ['', '', '', '', '', '', 'SKU-002',1,250,15,''],
      ['PO-2026-002','Supplier B','2026-09-24','USD','','2026-12-01','NEW-SKU-01',3,80,8,'New Product Name'],
      ['', '', '', '', '', '', 'SKU-003',2,120,12,'']
    ];
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[18,22,14,10,18,14,18,9,12,16,24].map(w=>({wch:w}));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Bulk PO Import');
    XLSX.writeFile(wb,'LImperial_Bulk_PO_Import_Template.xlsx');
  };
})();