// Excel / CSV import for Create Supplier PO.
// Uses the existing PO document file input: PDF/image is document-only; Excel/CSV also fills the PO header + item rows.
(function(){
  const EXCEL_TYPES=/\.(xlsx|xls|csv)$/i;

  function normHeader(v){
    return String(v??'')
      .trim()
      .toLowerCase()
      .replace(/&/g,' and ')
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function moneyNum(v){
    if(typeof v==='number')return Number.isFinite(v)?v:0;
    const s=String(v??'').replace(/[$,\s]/g,'').trim();
    const n=Number(s);
    return Number.isFinite(n)?n:0;
  }

  function isoDate(v){
    if(!v)return '';
    if(v instanceof Date && !Number.isNaN(v.getTime()))return [
      v.getFullYear(),
      String(v.getMonth()+1).padStart(2,'0'),
      String(v.getDate()).padStart(2,'0')
    ].join('-');

    if(typeof v==='number' && window.XLSX?.SSF?.parse_date_code){
      const d=XLSX.SSF.parse_date_code(v);
      if(d)return `${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }

    const s=String(v).trim();
    if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)){
      const [y,m,d]=s.split('-');
      return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    const d=new Date(s);
    if(!Number.isNaN(d.getTime()))return [
      d.getFullYear(),
      String(d.getMonth()+1).padStart(2,'0'),
      String(d.getDate()).padStart(2,'0')
    ].join('-');
    return '';
  }

  function firstNonBlank(rows,key){
    for(const r of rows){
      const v=r[key];
      if(v!==undefined && v!==null && String(v).trim()!=='')return v;
    }
    return '';
  }

  function setIfValue(id,value){
    const el=document.getElementById(id);
    if(!el || value===undefined || value===null || String(value).trim()==='')return;
    el.value=String(value).trim();
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function findHeaderRow(matrix){
    const limit=Math.min(matrix.length,12);
    for(let i=0;i<limit;i++){
      const hs=(matrix[i]||[]).map(normHeader);
      const hasCode=hs.some(h=>['code','sku','product code','product code sku'].includes(h));
      const hasQty=hs.some(h=>['qty','quantity'].includes(h));
      if(hasCode&&hasQty)return i;
    }
    return 0;
  }

  function canonicalKey(header){
    const h=normHeader(header);
    const map=new Map([
      ['official po number','po_no'],['po number','po_no'],['official po','po_no'],
      ['vendor supplier','vendor'],['vendor','vendor'],['supplier','vendor'],
      ['order date','order_date'],['date','order_date'],
      ['currency','currency'],
      ['shipping agent','shipping_agent'],['agent','shipping_agent'],
      ['eta','eta'],['estimated arrival','eta'],['estimated arrival date','eta'],
      ['code','code'],['sku','code'],['product code','code'],['product code sku','code'],
      ['qty','qty'],['quantity','qty'],
      ['unit cost','unit_cost'],['cost','unit_cost'],
      ['shipping unit','shipping_unit'],['shipping per unit','shipping_unit'],['shipping cost unit','shipping_unit'],['shipping cost per unit','shipping_unit'],
      ['item name','item_name'],['product name','item_name']
    ]);
    return map.get(h)||h.replace(/\s+/g,'_');
  }

  async function readWorkbook(file){
    if(!window.XLSX)throw new Error('Excel importer is still loading. Refresh the page and try again.');
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array',cellDates:true});
    const ws=wb.Sheets[wb.SheetNames[0]];
    if(!ws)throw new Error('The Excel file has no worksheet.');
    return XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  }

  function rowsFromMatrix(matrix){
    const headerIndex=findHeaderRow(matrix);
    const headers=(matrix[headerIndex]||[]).map(canonicalKey);
    const rows=[];
    for(let r=headerIndex+1;r<matrix.length;r++){
      const values=matrix[r]||[];
      const obj={};
      headers.forEach((h,i)=>{if(h)obj[h]=values[i]});
      const hasAny=Object.values(obj).some(v=>v!==undefined&&v!==null&&String(v).trim()!=='');
      if(hasAny)rows.push(obj);
    }
    return rows;
  }

  async function productMapForCodes(codes){
    const unique=[...new Set(codes.filter(Boolean).map(x=>String(x).trim()).filter(Boolean))];
    const out=new Map();
    if(!unique.length)return out;
    for(let i=0;i<unique.length;i+=100){
      const batch=unique.slice(i,i+100);
      const {data,error}=await db.from('product_catalog')
        .select('id,code,item_name,image_url')
        .in('code',batch);
      if(error)throw error;
      for(const p of data||[])out.set(String(p.code||'').trim().toLowerCase(),p);
    }
    return out;
  }

  function clearOldImportedRows(){
    document.querySelectorAll('#poCreateItems .po-create-item[data-excel-imported="1"]').forEach(x=>x.remove());

    // Remove the original untouched blank row so import does not leave a spare empty line at the top.
    document.querySelectorAll('#poCreateItems .po-create-item').forEach(row=>{
      const code=row.querySelector('.po-code')?.value.trim()||'';
      const name=row.querySelector('.po-name')?.value.trim()||'';
      const cost=Number(row.querySelector('.po-unit-cost')?.value||0);
      const ship=Number(row.querySelector('.po-shipping')?.value||0);
      const qty=Number(row.querySelector('.po-qty')?.value||1);
      if(!code&&!name&&cost===0&&ship===0&&qty===1)row.remove();
    });
  }

  function appendImportedItem(data,product){
    poCreateAddItem();
    const row=[...document.querySelectorAll('#poCreateItems .po-create-item')].pop();
    if(!row)return;
    row.dataset.excelImported='1';

    const code=String(data.code??'').trim();
    const importedName=String(data.item_name??'').trim();
    const name=importedName||product?.item_name||'';

    row.dataset.productId=product?.id||'';
    const codeInput=row.querySelector('.po-code');
    const nameInput=row.querySelector('.po-name');
    const search=row.querySelector('.po-product-search');
    const qty=row.querySelector('.po-qty');
    const cost=row.querySelector('.po-unit-cost');
    const ship=row.querySelector('.po-shipping');

    codeInput.value=code;
    nameInput.value=name;
    qty.value=String(moneyNum(data.qty)||1);
    cost.value=String(moneyNum(data.unit_cost));
    ship.value=String(moneyNum(data.shipping_unit));

    if(product){
      search.value=`${product.code||code} · ${product.item_name||name}`;
      if(typeof poCreateManualCode==='function')poCreateManualCode(codeInput);
    }else{
      search.value='';
      if(!name){
        nameInput.classList.add('border-amber-400','bg-amber-50');
        nameInput.placeholder='Enter item name for this new SKU';
      }
    }
    if(typeof poCreateRecalcRow==='function')poCreateRecalcRow(qty);
  }

  async function importExcel(file){
    const status=document.getElementById('poExcelImportStatus');
    if(status){status.textContent='Reading Excel file...';status.className='text-[10px] text-blue-600 mt-1';}

    const matrix=await readWorkbook(file);
    const rows=rowsFromMatrix(matrix);
    if(!rows.length)throw new Error('No data rows were found in the Excel file.');

    const poNos=[...new Set(rows.map(r=>String(r.po_no??'').trim()).filter(Boolean))];
    if(poNos.length>1)throw new Error('This Excel file contains more than one Official PO Number. Please upload one PO per file.');

    const vendors=[...new Set(rows.map(r=>String(r.vendor??'').trim()).filter(Boolean))];
    if(vendors.length>1)throw new Error('This Excel file contains more than one Vendor / Supplier. Please upload one supplier PO per file.');

    const itemRows=rows.filter(r=>String(r.code??'').trim());
    if(!itemRows.length)throw new Error('No item rows with a Code / SKU were found.');

    const products=await productMapForCodes(itemRows.map(r=>String(r.code??'').trim()));

    clearOldImportedRows();

    setIfValue('poOfficialNo',firstNonBlank(rows,'po_no'));
    setIfValue('poVendor',firstNonBlank(rows,'vendor'));

    const orderDate=isoDate(firstNonBlank(rows,'order_date'));
    if(orderDate)setIfValue('poOrderDate',orderDate);

    const eta=isoDate(firstNonBlank(rows,'eta'));
    if(eta)setIfValue('poEta',eta);

    setIfValue('poAgent',firstNonBlank(rows,'shipping_agent'));

    const currency=String(firstNonBlank(rows,'currency')||'').trim().toUpperCase();
    if(currency){
      const sel=document.getElementById('poCurrency');
      if(sel && [...sel.options].some(o=>o.value===currency)){
        sel.value=currency;
        sel.dispatchEvent(new Event('change',{bubbles:true}));
      }
    }

    let matched=0,needsName=0;
    for(const r of itemRows){
      const code=String(r.code??'').trim();
      const p=products.get(code.toLowerCase())||null;
      if(p)matched++;
      if(!p&&!String(r.item_name??'').trim())needsName++;
      appendImportedItem(r,p);
    }

    if(typeof poCreateRecalcAll==='function')poCreateRecalcAll();

    if(status){
      status.className=needsName?'text-[10px] text-amber-700 mt-1':'text-[10px] text-green-700 mt-1';
      status.innerHTML=`Excel imported: <b>${itemRows.length}</b> item${itemRows.length===1?'':'s'} · <b>${matched}</b> matched to Product Catalog${needsName?` · <b>${needsName}</b> new SKU${needsName===1?' needs':'s need'} an Item Name before saving`:''}.`;
    }
    showToast(`Excel loaded: ${itemRows.length} PO item${itemRows.length===1?'':'s'} created in the form`);
  }

  window.poCreateDocumentChanged=async function(input){
    const file=input.files?.[0];
    if(!file)return;
    if(!EXCEL_TYPES.test(file.name||'')){
      const status=document.getElementById('poExcelImportStatus');
      if(status){status.textContent='Document selected. PDF/image files are stored with the PO; they do not change item rows.';status.className='text-[10px] text-gray-400 mt-1';}
      return;
    }
    try{
      await importExcel(file);
    }catch(err){
      const status=document.getElementById('poExcelImportStatus');
      if(status){status.textContent=err.message||'Could not import Excel file.';status.className='text-[10px] text-red-600 mt-1';}
      showToast(err.message||'Could not import Excel file.','err');
    }
  };

  window.downloadPOExcelTemplate=function(){
    if(!window.XLSX)return showToast('Excel template tool is still loading. Refresh and try again.','err');
    const headers=[
      'Official PO Number','Vendor / Supplier','Order Date','Currency','Shipping Agent','ETA',
      'Code','QTY','Unit Cost','Shipping / Unit','Item Name'
    ];
    const sample=[
      'PO-2026-001','Example Supplier',new Date().toISOString().slice(0,10),'USD','', '',
      'SKU-001',1,0,0,''
    ];
    const ws=XLSX.utils.aoa_to_sheet([headers,sample]);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'PO Import');
    XLSX.writeFile(wb,'LImperial_PO_Import_Template.xlsx');
  };

  function decorateImporter(){
    const input=document.getElementById('poFile');
    if(!input)return;
    input.accept='.pdf,image/*,.xlsx,.xls,.csv';
    input.onchange=function(){poCreateDocumentChanged(this)};

    const help=input.nextElementSibling;
    if(help){
      help.innerHTML='Upload a PDF/image as the supplier document, or upload <b>Excel / CSV</b> to automatically fill the PO header and item lines.';
    }

    if(!document.getElementById('poExcelImportStatus')){
      const s=document.createElement('div');
      s.id='poExcelImportStatus';
      s.className='text-[10px] text-gray-400 mt-1';
      s.textContent='Excel columns supported: Official PO Number, Vendor / Supplier, Order Date, Currency, Shipping Agent, ETA, Code, QTY, Unit Cost, Shipping / Unit, Item Name (optional when Code already exists).';
      help?.insertAdjacentElement('afterend',s);
    }

    const itemsWrap=document.getElementById('poCreateItems')?.parentElement;
    const header=itemsWrap?.querySelector('.flex.items-center.justify-between');
    const addButton=header?.querySelector('button[onclick="poCreateAddItem()"]');
    if(header&&addButton&&!header.querySelector('.po-excel-template-btn')){
      const group=document.createElement('div');
      group.className='flex gap-2 flex-wrap justify-end';
      const tmpl=document.createElement('button');
      tmpl.type='button';
      tmpl.className='po-excel-template-btn px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold';
      tmpl.textContent='Download Excel Template';
      tmpl.onclick=downloadPOExcelTemplate;
      addButton.replaceWith(group);
      group.appendChild(tmpl);
      group.appendChild(addButton);
    }
  }

  const baseOpen=window.openNewSupplierPO;
  if(typeof baseOpen==='function'){
    window.openNewSupplierPO=async function(){
      const out=await baseOpen.apply(this,arguments);
      setTimeout(decorateImporter,0);
      return out;
    };
  }
})();