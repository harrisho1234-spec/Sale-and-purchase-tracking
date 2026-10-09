/* Customer Delivery Order print/PDF template.
 * Read-only export: all fields come from one permission-checked Supabase RPC.
 * Browser print supports Khmer text and external product images without
 * attempting to modify stock, order, or approval data. */
(function(){
  'use strict';

  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function quantity(value){
    const n=Number(value);
    if(!Number.isFinite(n))return '0';
    return Number.isInteger(n)?String(n):n.toLocaleString('en-US',{maximumFractionDigits:2});
  }
  function issueDate(value){
    const date=value?new Date(value):new Date();
    if(Number.isNaN(date.getTime()))return '—';
    const f=new Intl.DateTimeFormat('en-GB',{
      day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Phnom_Penh'
    });
    return f.format(date).replace(/ /g,' / ');
  }
  function deliveryDate(value){
    const s=String(value||'');
    const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if(!m)return '—';
    const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
    return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(d);
  }
  function productImage(value){
    const raw=String(value||'').trim();
    let src=raw;
    if(typeof window.normalizeGoogleImageUrl==='function'){
      try{src=window.normalizeGoogleImageUrl(raw)}catch(_){src=raw}
    }
    if(!/^https:\/\//i.test(src)&&!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src))return '<span class="no-photo">No Photo</span>';
    return '<img src="'+escapeHtml(src)+'" alt="Product photo" loading="eager" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode(\'No Photo\'))">';
  }

  const printStyle=[
    '@page{size:A4 portrait;margin:11mm 12mm;}',
    '*{box-sizing:border-box;}',
    'html,body{margin:0;padding:0;background:#fff;color:#17202d;font-family:Arial,"Noto Sans Khmer","Khmer OS",sans-serif;font-size:10px;}',
    'body{line-height:1.42;}',
    '.sheet{max-width:210mm;margin:0 auto;padding:0 1mm;}',
    '.title{text-align:center;font-weight:800;margin:1mm 0 7mm;}',
    '.title .kh{font-family:"Noto Sans Khmer","Khmer OS",sans-serif;font-size:14px;font-weight:800;}',
    '.title .en{font-size:12px;font-weight:800;letter-spacing:.5px;margin-top:1mm;}',
    '.details{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(165px,.85fr);gap:18px;align-items:start;margin-bottom:5mm;}',
    '.details-left,.details-right{display:flex;flex-direction:column;gap:5px;min-width:0;}',
    '.details-right{text-align:right;}',
    '.detail{min-height:14px;overflow-wrap:anywhere;}',
    '.detail strong{font-weight:800;}',
    '.do-number{color:#bb2025;font-weight:900;font-size:12px;}',
    '.source-ref{font-size:9px;color:#667085;}',
    'table.items{width:100%;border-collapse:collapse;table-layout:fixed;margin:0;}',
    '.items col.no{width:6%;}.items col.name{width:27%;}.items col.desc{width:26%;}.items col.qty{width:9%;}.items col.picture{width:18%;}.items col.remarks{width:14%;}',
    '.items th{background:#0a2c4c;color:#fff;border:1px solid #aab9c8;text-align:center;font-size:9px;font-weight:700;padding:7px 3px;}',
    '.items th .kh{display:block;font-family:"Noto Sans Khmer","Khmer OS",sans-serif;font-size:9px;font-weight:700;}',
    '.items th .en{display:block;font-size:9px;font-weight:700;}',
    '.items td{border:1px solid #cbd2d9;vertical-align:middle;padding:8px 6px;font-size:9.5px;overflow-wrap:anywhere;}',
    '.items tr{break-inside:avoid;page-break-inside:avoid;}',
    '.items thead{display:table-header-group;}',
    '.center{text-align:center;}.bold{font-weight:800;}.product-name{font-size:10px;font-weight:800;line-height:1.5;}',
    '.product-code{font-size:9px;font-weight:650;line-height:1.5;}',
    '.preorder{font-size:9px;font-weight:800;color:#c17e35;margin-top:4px;}',
    '.description{white-space:pre-line;text-align:center;}',
    '.remarks{white-space:pre-line;text-align:center;}',
    '.photo{display:flex;min-height:65px;align-items:center;justify-content:center;}',
    '.photo img{display:block;max-width:88px;max-height:78px;width:auto;height:auto;object-fit:contain;border:1px solid #e5e7eb;border-radius:3px;}',
    '.no-photo{color:#9aa4b2;font-size:9px;}',
    '.delivery-remark{margin-top:9px;font-size:9px;white-space:pre-line;overflow-wrap:anywhere;}',
    '.notice{break-inside:avoid;page-break-inside:avoid;margin-top:6mm;padding:7px 8px;border:1px dashed #e5d1a8;background:#fffcf6;font-size:9px;line-height:1.65;}',
    '.notice b{font-weight:900;}',
    '.signatures{break-inside:avoid;page-break-inside:avoid;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8mm;margin-top:8mm;text-align:center;}',
    '.sign-cell{min-height:33mm;display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;}',
    '.sign-cell .kh{font-family:"Noto Sans Khmer","Khmer OS",sans-serif;font-size:10px;font-weight:700;}',
    '.sign-cell .line{margin:0 9px;border-top:1px solid #18232f;}',
    '.sign-cell .en{font-size:10px;font-weight:800;}',
    '.tools{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#0a2c4c;color:#fff;padding:12px 16px;margin:0 0 18px;}',
    '.tools button{background:#dfb26c;border:0;border-radius:7px;padding:10px 15px;color:#182333;font-size:13px;font-weight:800;cursor:pointer;}',
    '.tools .hint{font-size:12px;opacity:.9;}',
    '@media screen{body{background:#e8edf3;}.sheet{background:#fff;min-height:297mm;box-shadow:0 6px 24px #0002;padding:13mm;}}',
    '@media print{.tools{display:none!important;}html,body,.sheet{background:#fff!important;box-shadow:none!important;}.sheet{max-width:none;min-height:0;padding:0;}a{color:inherit;text-decoration:none;}',
    '  .notice{-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
    '  .items th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}'
  ].join('\n');

  function makeItem(item,index){
    const name=escapeHtml(item.item_name||'');
    const code=escapeHtml(item.product_code||'');
    const q=quantity(item.qty);
    const preorder=String(item.source_type||'').toLowerCase()==='pre_order'
      ?'<div class="preorder">PRE-ORDER: '+escapeHtml(q)+' PC'+(Number(item.qty)===1?'':'S')+'</div>':'';
    return '<tr>'+
      '<td class="center bold">'+(index+1)+'</td>'+
      '<td class="center"><div class="product-name">'+(name||'—')+'</div><div class="product-code">'+(code||'—')+'</div>'+preorder+'</td>'+
      '<td class="description">'+escapeHtml(item.description||'')+'</td>'+
      '<td class="center bold">'+escapeHtml(q)+' pcs</td>'+
      '<td><div class="photo">'+productImage(item.image_url)+'</div></td>'+
      '<td class="remarks">'+escapeHtml(item.remarks||'')+'</td>'+
    '</tr>';
  }

  function pageHtml(doc){
    const doNumber=String(doc.do_no||'').trim();
    const customer=escapeHtml(doc.customer_name||'');
    const address=escapeHtml(doc.delivery_address||'');
    const phone=escapeHtml(doc.customer_phone||'');
    const sale=escapeHtml(doc.sales_rep_name||'');
    const requested=escapeHtml(deliveryDate(doc.requested_delivery_date));
    const items=Array.isArray(doc.items)?doc.items:[];
    const note=String(doc.request_note||'').trim();
    const title='Delivery Order '+doNumber;
    return '<!DOCTYPE html><html lang="en"><head>'+
      '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+escapeHtml(title)+'</title>'+
      '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;500;700;800&display=swap" rel="stylesheet">'+
      '<style>'+printStyle+'</style></head><body>'+
      '<div class="tools"><div><strong>'+escapeHtml(title)+'</strong><div class="hint">Print or choose “Save as PDF” in the printer destination.</div></div>'+
      '<button type="button" onclick="window.print()">Print / Save PDF</button></div>'+
      '<main class="sheet">'+
      '<header class="title"><div class="kh" lang="km">លិខិតដឹកជញ្ជូនទំនិញ</div><div class="en">DELIVERY ORDER</div></header>'+
      '<section class="details">'+
        '<div class="details-left">'+
          '<div class="detail"><strong>Date:</strong> '+escapeHtml(issueDate(doc.issued_at))+'</div>'+
          '<div class="detail"><strong lang="km">ឈ្មោះអតិថិជន</strong><strong>/Customer:</strong> '+(customer||'—')+'</div>'+
          '<div class="detail"><strong lang="km">អាសយដ្ឋាន</strong><strong>/Address:</strong> '+(address||'—')+'</div>'+
          '<div class="detail"><strong lang="km">ទូរស័ព្ទ</strong><strong>/Contact:</strong> '+(phone||'—')+'</div>'+
        '</div>'+
        '<div class="details-right">'+
          '<div class="detail do-number">DO N°: '+escapeHtml(doNumber)+'</div>'+
          '<div class="detail"><strong>Install Date:</strong> -</div>'+
          '<div class="detail"><strong>QB:</strong> -</div>'+
          '<div class="detail"><strong>Sale:</strong> '+(sale||'—')+'</div>'+
          '<div class="detail"><strong>Requested Delivery:</strong> '+requested+'</div>'+
          '<div class="detail source-ref">Sales Order: '+escapeHtml(doc.document_no||'—')+'</div>'+
        '</div>'+
      '</section>'+
      '<table class="items"><colgroup><col class="no"><col class="name"><col class="desc"><col class="qty"><col class="picture"><col class="remarks"></colgroup>'+
      '<thead><tr>'+
        '<th>No</th>'+
        '<th><span class="kh" lang="km">ឈ្មោះ / លេខកូដ</span><span class="en">Name/ Code Item</span></th>'+
        '<th><span class="kh" lang="km">ពិពណ៌នាលម្អិត</span><span class="en">Description</span></th>'+
        '<th><span class="kh" lang="km">ចំនួន</span><span class="en">QTY</span></th>'+
        '<th><span class="kh" lang="km">រូបភាព</span><span class="en">Item Picture</span></th>'+
        '<th><span class="kh" lang="km">សំគាល់</span><span class="en">Remarks</span></th>'+
      '</tr></thead><tbody>'+items.map(makeItem).join('')+'</tbody></table>'+
      (note?'<section class="delivery-remark"><b>Delivery Note:</b> '+escapeHtml(note)+'</section>':'')+
      '<section class="notice"><b><span lang="km">សេចក្តីជូនដំណឹង</span> / NOTICE:</b> Please note that any product sold is not returnable and please inspect all items carefully upon delivery. Any damage, shortage, or discrepancy must be reported 24 hours of receiving this delivery. Once signed below, this Delivery Order confirms that the items listed have been received in good condition and in the correct quantity.</section>'+
      '<section class="signatures">'+
        '<div class="sign-cell"><div class="kh" lang="km">ដឹកជញ្ជូនដោយ</div><div class="line"></div><div class="en">Delivered By</div></div>'+
        '<div class="sign-cell"><div class="kh" lang="km">ត្រួតពិនិត្យដោយ</div><div class="line"></div><div class="en">Checked By</div></div>'+
        '<div class="sign-cell"><div class="kh" lang="km">ទទួលដោយ</div><div class="line"></div><div class="en">Received By</div></div>'+
      '</section>'+
      '</main></body></html>';
  }

  window.exportStockDeliveryOrder=async function(deliveryRequestId){
    if(!deliveryRequestId)return showToast('Missing Delivery Order request ID.','err');
    // Open from the actual button click: browsers otherwise block async popups.
    const preview=window.open('','_blank');
    if(!preview){
      showToast('Allow pop-ups for this app to open the Delivery Order PDF preview.','err');
      return;
    }
    preview.document.write('<!DOCTYPE html><html><head><title>Preparing Delivery Order</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:16px Arial,sans-serif;padding:32px;color:#263348">Preparing Delivery Order and product photos…</body></html>');
    preview.document.close();
    try{
      const result=await db.rpc('get_inventory_do_export',{p_delivery_request_id:deliveryRequestId});
      if(result.error)throw result.error;
      const doc=result.data||{};
      if(!String(doc.do_no||'').trim()){
        throw new Error('This request has no official DO number. Ask an Admin to assign it before exporting.');
      }
      if(!Array.isArray(doc.items)||!doc.items.length){
        throw new Error('No DO items found to export.');
      }
      if(preview.closed)return;
      preview.document.open();
      preview.document.write(pageHtml(doc));
      preview.document.close();
      try{preview.focus()}catch(_){}
    }catch(err){
      const message=err&&err.message?err.message:'Could not prepare the Delivery Order.';
      if(!preview.closed){
        preview.document.open();
        preview.document.write('<!DOCTYPE html><meta charset="UTF-8"><title>Export Failed</title><div style="font:15px Arial;padding:24px;color:#9b1c1c"><b>Delivery Order export failed.</b><p>'+escapeHtml(message)+'</p></div>');
        preview.document.close();
      }
      showToast(message,'err');
    }
  };
})();