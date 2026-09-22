// Product photo thumbnails for Edit Order + Update Item Tracking.
// Loaded last so it decorates the existing workflows without changing their business logic.
(function(){
  function imgUrl(v){
    const raw=String(v||'').trim();
    if(!raw)return '';
    try{return typeof normalizeGoogleImageUrl==='function'?normalizeGoogleImageUrl(raw):raw}catch{return raw}
  }

  function injectStyles(){
    if(document.getElementById('sales-item-photo-css'))return;
    const s=document.createElement('style');
    s.id='sales-item-photo-css';
    s.textContent=`
      .sales-item-photo-box{width:72px;height:72px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;overflow:hidden;display:flex;align-items:center;justify-content:center;flex:0 0 72px}
      .sales-item-photo-box img{width:100%;height:100%;object-fit:contain;background:#fff}
      .sales-item-photo-empty{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:5px;font-size:9px;line-height:1.15;color:#9ca3af;background:#f7f7f7}
      .edit-item-photo-cell{display:flex;align-items:flex-end;justify-content:center}
      .status-item-photo-main{display:grid!important;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:center;min-width:0}
      .status-item-photo-text{min-width:0}
      @media(min-width:768px){
        .edit-order-item-row.item-photo-enabled .edit-item-photo-cell{grid-column:span 1 / span 1}
        .edit-order-item-row.item-photo-enabled .edit-item-main{grid-column:span 4 / span 4}
      }
      @media(max-width:767px){
        .edit-item-photo-cell{justify-content:flex-start}
        .sales-item-photo-box{width:64px;height:64px;flex-basis:64px}
        .status-item-photo-main{grid-template-columns:64px minmax(0,1fr)}
      }
    `;
    document.head.appendChild(s);
  }

  function photoMarkup(url){
    const u=imgUrl(url);
    if(!u)return '<div class="sales-item-photo-box"><div class="sales-item-photo-empty">No Photo</div></div>';
    return `<div class="sales-item-photo-box"><img src="${esc(u)}" alt="Product photo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="sales-item-photo-empty" style="display:none">No Photo</div></div>`;
  }

  function editRowPhoto(row){
    if(!row)return '';
    const hidden=row.querySelector('.edit-product-image');
    let url=hidden?.value||'';
    if(!url){
      const id=row.querySelector('.edit-product-id')?.value||'';
      const p=(state.products||[]).find(x=>String(x.id)===String(id));
      url=p?.image_url||'';
    }
    return url;
  }

  function decorateEditRow(row){
    if(!row)return;
    const main=[...row.children].find(x=>x.querySelector?.('.edit-product-search'));
    if(!main)return;
    main.classList.add('edit-item-main');
    row.classList.add('item-photo-enabled');

    let cell=row.querySelector(':scope > .edit-item-photo-cell');
    if(!cell){
      cell=document.createElement('div');
      cell.className='edit-item-photo-cell';
      row.insertBefore(cell,main);
    }
    cell.innerHTML=photoMarkup(editRowPhoto(row));
  }

  function decorateAllEditRows(){
    document.querySelectorAll('#editOrderItems .edit-order-item-row').forEach(decorateEditRow);
  }

  async function trackingImageMap(orderId){
    const {data,error}=await db.from('sales_order_items').select(`
      id,product_id,image_url_snapshot,
      product_catalog(image_url)
    `).eq('sales_order_id',orderId).order('line_position',{ascending:true});
    if(error){
      console.warn('Could not load item photos:',error.message);
      return new Map();
    }
    const map=new Map();
    for(const x of data||[]){
      const rel=Array.isArray(x.product_catalog)?x.product_catalog[0]:x.product_catalog;
      let u=x.image_url_snapshot||rel?.image_url||'';
      if(!u&&x.product_id){
        const p=(state.products||[]).find(z=>String(z.id)===String(x.product_id));
        u=p?.image_url||'';
      }
      map.set(x.id,u||'');
    }
    return map;
  }

  function decorateStatusCard(card,url){
    if(!card)return;
    const head=card.firstElementChild;
    if(!head)return;
    let left=head.firstElementChild;
    if(!left)return;

    if(!left.classList.contains('status-item-photo-main')){
      const text=document.createElement('div');
      text.className='status-item-photo-text';
      while(left.firstChild)text.appendChild(left.firstChild);
      const photo=document.createElement('div');
      photo.className='status-item-photo-cell';
      left.appendChild(photo);
      left.appendChild(text);
      left.classList.add('status-item-photo-main');
    }
    const photo=left.querySelector('.status-item-photo-cell');
    if(photo)photo.innerHTML=photoMarkup(url);
  }

  async function decorateStatusPhotos(orderId){
    const map=await trackingImageMap(orderId);
    document.querySelectorAll('.flex-status-card').forEach(card=>{
      decorateStatusCard(card,map.get(card.dataset.itemId)||'');
    });
  }

  injectStyles();

  const baseOpenEdit=window.openEditSalesOrder;
  if(typeof baseOpenEdit==='function'){
    window.openEditSalesOrder=async function(){
      const r=await baseOpenEdit.apply(this,arguments);
      setTimeout(decorateAllEditRows,0);
      return r;
    };
  }

  const baseAddEdit=window.addEditOrderItem;
  if(typeof baseAddEdit==='function'){
    window.addEditOrderItem=function(){
      const r=baseAddEdit.apply(this,arguments);
      setTimeout(decorateAllEditRows,0);
      return r;
    };
  }

  const baseChooseEdit=window.chooseEditProduct;
  if(typeof baseChooseEdit==='function'){
    window.chooseEditProduct=function(btn){
      const row=btn?.closest?.('.edit-order-item-row');
      const r=baseChooseEdit.apply(this,arguments);
      setTimeout(()=>decorateEditRow(row),0);
      return r;
    };
  }

  const baseEditChanged=window.editProductInputChanged;
  if(typeof baseEditChanged==='function'){
    window.editProductInputChanged=function(input){
      const row=input?.closest?.('.edit-order-item-row');
      const r=baseEditChanged.apply(this,arguments);
      setTimeout(()=>decorateEditRow(row),0);
      return r;
    };
  }

  const baseOpenStatus=window.openItemStatusManager;
  if(typeof baseOpenStatus==='function'){
    window.openItemStatusManager=async function(orderId){
      const r=await baseOpenStatus.apply(this,arguments);
      await decorateStatusPhotos(orderId);
      return r;
    };
  }
})();
