// Searchable product code / item selector for Edit Supplier PO -> Add PO Item.
// Loaded last so it enhances the existing PO edit modal without changing save logic.
(function(){
  const baseOpenEditSupplierPO=window.openEditSupplierPO;
  if(typeof baseOpenEditSupplierPO!=='function')return;

  let productCache=null;

  function norm(v){return String(v||'').trim().toLowerCase()}
  function imgUrl(raw){return typeof normalizeGoogleImageUrl==='function'?normalizeGoogleImageUrl(raw||''):(raw||'')}

  async function loadProducts(){
    if(productCache)return productCache;
    const all=[];
    for(let from=0;;from+=1000){
      const r=await db.from('product_catalog')
        .select('id,code,item_name,brand,class,image_url,active')
        .eq('active',true)
        .order('code',{ascending:true})
        .range(from,from+999);
      if(r.error)throw r.error;
      all.push(...(r.data||[]));
      if(!r.data||r.data.length<1000)break;
    }
    productCache=all;
    return all;
  }

  function matches(products,q){
    const s=norm(q);
    if(!s)return products.slice(0,20);
    return products.map(p=>{
      const code=norm(p.code),name=norm(p.item_name),brand=norm(p.brand),cls=norm(p.class);
      let score=99;
      if(code===s)score=0;
      else if(code.startsWith(s))score=1;
      else if(code.includes(s))score=2;
      else if(name.startsWith(s))score=3;
      else if(name.includes(s))score=4;
      else if(brand.includes(s))score=5;
      else if(cls.includes(s))score=6;
      return {p,score};
    }).filter(x=>x.score<99)
      .sort((a,b)=>a.score-b.score||String(a.p.code||'').localeCompare(String(b.p.code||'')))
      .slice(0,20)
      .map(x=>x.p);
  }

  function photoHtml(raw){
    const u=imgUrl(raw);
    if(!u)return '<div class="w-10 h-10 rounded-lg border bg-gray-100 flex items-center justify-center text-[8px] text-gray-400 shrink-0">No Photo</div>';
    return `<div class="w-10 h-10 rounded-lg border bg-gray-100 overflow-hidden shrink-0"><img src="${esc(u)}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none" class="w-full h-full items-center justify-center text-[8px] text-gray-400">No Photo</div></div>`;
  }

  async function enhancePOItemEntry(){
    const form=document.getElementById('addPOItemForm');
    const code=document.getElementById('poiCode');
    const name=document.getElementById('poiName');
    if(!form||!code||!name||code.dataset.typeaheadReady==='1')return;
    code.dataset.typeaheadReady='1';
    code.autocomplete='off';
    code.placeholder='Type SKU / code or item name...';
    code.classList.add('w-full','min-w-0');

    let products=[];
    try{products=await loadProducts()}catch(err){console.warn('Could not load PO product suggestions:',err.message);return;}

    const wrap=document.createElement('div');
    wrap.className='relative w-full min-w-0';
    code.parentNode.insertBefore(wrap,code);
    wrap.appendChild(code);

    const menu=document.createElement('div');
    menu.className='hidden absolute z-[140] left-0 top-full mt-1 w-[min(580px,85vw)] max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-2xl';
    wrap.appendChild(menu);

    const hint=document.createElement('div');
    hint.className='text-[9px] text-gray-400 mt-1';
    hint.textContent='Type product code or item name, then choose a suggestion.';
    wrap.appendChild(hint);

    let visible=[];
    let active=-1;
    let composing=false;

    function choose(p){
      if(!p)return;
      code.value=p.code||'';
      name.value=p.item_name||'';
      code.dataset.productId=p.id||'';
      menu.classList.add('hidden');
      active=-1;
      code.dispatchEvent(new Event('change',{bubbles:true}));
    }

    function draw(){
      visible=matches(products,code.value);
      active=-1;
      if(!visible.length){
        menu.innerHTML='<div class="px-4 py-3 text-xs text-gray-400">No matching product. You can still enter a new SKU manually.</div>';
      }else{
        menu.innerHTML=visible.map((p,i)=>`<button type="button" data-po-product-index="${i}" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-b-0 border-gray-100 flex gap-3 items-center">
          ${photoHtml(p.image_url)}
          <div class="min-w-0 flex-1">
            <div class="text-xs font-extrabold text-[#a77d1a] truncate">${esc(p.code||'No Code')}</div>
            <div class="text-sm font-semibold text-gray-800 truncate">${esc(p.item_name||'')}</div>
            <div class="text-[10px] text-gray-400 truncate">${[p.brand,p.class,p.active===false?'Inactive':null].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
        </button>`).join('');
      }
      menu.classList.remove('hidden');
      menu.querySelectorAll('[data-po-product-index]').forEach(btn=>{
        btn.addEventListener('mousedown',e=>{e.preventDefault();choose(visible[Number(btn.dataset.poProductIndex)])});
      });
    }

    function paint(){
      menu.querySelectorAll('[data-po-product-index]').forEach((b,i)=>b.classList.toggle('bg-amber-50',i===active));
      menu.querySelector(`[data-po-product-index="${active}"]`)?.scrollIntoView({block:'nearest'});
    }

    code.addEventListener('focus',draw);
    code.addEventListener('compositionstart',()=>{composing=true});
    code.addEventListener('compositionend',()=>{composing=false;delete code.dataset.productId;draw()});
    code.addEventListener('input',()=>{
      delete code.dataset.productId;
      if(!composing)draw();
      const exact=products.find(p=>norm(p.code)===norm(code.value));
      if(exact&&(!name.value.trim()||name.dataset.autoFromCode==='1')){
        name.value=exact.item_name||'';
        name.dataset.autoFromCode='1';
      }else if(!exact&&name.dataset.autoFromCode==='1'){
        name.value='';delete name.dataset.autoFromCode;
      }
    });
    name.addEventListener('input',()=>delete name.dataset.autoFromCode);
    code.addEventListener('keydown',e=>{
      if(composing)return;
      if(menu.classList.contains('hidden')&&['ArrowDown','ArrowUp'].includes(e.key))draw();
      if(e.key==='ArrowDown'){
        e.preventDefault();if(visible.length){active=(active+1)%visible.length;paint()}
      }else if(e.key==='ArrowUp'){
        e.preventDefault();if(visible.length){active=(active-1+visible.length)%visible.length;paint()}
      }else if(e.key==='Enter'&&active>=0&&visible[active]){
        e.preventDefault();choose(visible[active]);name.focus();
      }else if(e.key==='Escape'){
        menu.classList.add('hidden');active=-1;
      }
    });
    code.addEventListener('blur',()=>setTimeout(()=>menu.classList.add('hidden'),160));
  }

  window.openEditSupplierPO=async function(){
    const out=await baseOpenEditSupplierPO.apply(this,arguments);
    await enhancePOItemEntry();
    return out;
  };
})();