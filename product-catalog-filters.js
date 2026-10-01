// Product catalog filters: Product Type, Brand, Category and live stock Location.
// Loaded after installTaxInventoryUI() so it extends the final Products renderer/filter chain.
(function(){
  const F=window.productCatalogFilterState||{
    productType:'',
    brand:'',
    category:'',
    locationId:'',
    locations:[],
    stockByProduct:new Map(),
    loadedAt:0
  };
  window.productCatalogFilterState=F;

  const categoryNames=new Set([
    'classic','modern','contemporary','neo-classic','neoclassic',
    'crystal','cast','glass','brass','ceramic'
  ]);

  function norm(v){return String(v==null?'':v).trim().toLowerCase()}
  function parts(v){
    return String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
  }
  function productClassification(p){
    const all=parts(p&&p.class);
    const categories=all.filter(x=>categoryNames.has(norm(x)));
    const types=all.filter(x=>!categoryNames.has(norm(x)));
    // If an unusual class contains only category/style text, keep the full class usable as Product Type.
    if(!types.length&&all.length)types.push(...all);
    return {types,categories};
  }
  function uniqueSorted(values){
    const map=new Map();
    (values||[]).forEach(v=>{
      const clean=String(v||'').trim();
      if(!clean)return;
      const key=norm(clean);
      if(!map.has(key))map.set(key,clean);
    });
    return [...map.values()].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  }
  function option(value,label,current){
    return '<option value="'+esc(value)+'" '+(String(current||'')===String(value)?'selected':'')+'>'+esc(label)+'</option>';
  }

  async function fetchPaged(table,columns){
    const out=[];
    for(let from=0;;from+=1000){
      const r=await db.from(table).select(columns).range(from,from+999);
      if(r.error)throw r.error;
      out.push(...(r.data||[]));
      if((r.data||[]).length<1000)break;
    }
    return out;
  }

  async function loadProductLocationFilterData(force=false){
    if(!force&&F.loadedAt&&Date.now()-F.loadedAt<60000)return;
    try{
      const [locRes,balances]=await Promise.all([
        db.from('stock_locations').select('id,code,name,active').eq('active',true).order('sort_order').order('code'),
        fetchPaged('inventory_product_tax_balance','product_id,locations')
      ]);
      if(locRes.error)throw locRes.error;
      F.locations=locRes.data||[];
      F.stockByProduct=new Map((balances||[]).map(x=>[String(x.product_id),Array.isArray(x.locations)?x.locations:[]]));
      F.loadedAt=Date.now();
    }catch(err){
      console.warn('Product location filter data could not be refreshed:',err);
      // Keep any previously loaded map. Location dropdown can still use legacy product location text.
      if(!F.locations.length){
        try{
          const r=await db.from('stock_locations').select('id,code,name,active').eq('active',true).order('code');
          if(!r.error)F.locations=r.data||[];
        }catch(_){}
      }
    }
  }

  const baseFilteredProducts=window.filteredProducts;
  if(typeof baseFilteredProducts==='function'){
    window.filteredProducts=function(){
      let rows=baseFilteredProducts.apply(this,arguments)||[];

      if(F.productType){
        const want=norm(F.productType);
        rows=rows.filter(p=>productClassification(p).types.some(x=>norm(x)===want));
      }
      if(F.brand){
        const want=norm(F.brand);
        rows=rows.filter(p=>norm(p.brand)===want);
      }
      if(F.category){
        const want=norm(F.category);
        rows=rows.filter(p=>productClassification(p).categories.some(x=>norm(x)===want));
      }
      if(F.locationId){
        const loc=F.locations.find(x=>String(x.id)===String(F.locationId));
        const wantId=String(F.locationId);
        const wantCode=norm(loc&&loc.code);
        const wantName=norm(loc&&loc.name);
        rows=rows.filter(p=>{
          const stockLocs=F.stockByProduct.get(String(p.id))||[];
          const liveMatch=stockLocs.some(x=>
            String(x.location_id||'')===wantId &&
            Number(x.qty||0)>0
          );
          if(liveMatch)return true;
          // Legacy fallback for catalog rows that have not yet been reconciled into the stock ledger.
          const legacy=norm(p.location);
          return !!legacy&&(legacy===wantCode||legacy===wantName);
        });
      }
      return rows;
    };
  }

  function filterOptions(){
    const active=(state.products||[]).filter(p=>p.active!==false);
    const productTypes=uniqueSorted(active.flatMap(p=>productClassification(p).types));
    const brands=uniqueSorted(active.map(p=>p.brand));
    const categories=uniqueSorted(active.flatMap(p=>productClassification(p).categories));

    const productTypeOptions=['<option value="">All Product Types</option>']
      .concat(productTypes.map(v=>option(v,v,F.productType))).join('');
    const brandOptions=['<option value="">All Brands</option>']
      .concat(brands.map(v=>option(v,v,F.brand))).join('');
    const categoryOptions=['<option value="">All Categories</option>']
      .concat(categories.map(v=>option(v,v,F.category))).join('');
    const locationOptions=['<option value="">All Locations</option>']
      .concat((F.locations||[]).map(l=>{
        const label=l.name&&norm(l.name)!==norm(l.code)?l.code+' · '+l.name:l.code;
        return option(l.id,label,F.locationId);
      })).join('');

    return {productTypeOptions,brandOptions,categoryOptions,locationOptions};
  }

  function injectProductCatalogFilters(){
    const search=document.getElementById('productSearch');
    if(!search||document.getElementById('productCatalogAdvancedFilters'))return;

    // Preserve the visible search value across refreshes.
    if(state.productQuery)search.value=state.productQuery;

    const o=filterOptions();
    const bar=document.createElement('div');
    bar.id='productCatalogAdvancedFilters';
    bar.className='mb-4 rounded-2xl border border-[#eee8df] bg-white p-3';
    bar.innerHTML=
      '<div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">'+
        '<select id="productTypeFilter" onchange="setProductCatalogFilter(\'productType\',this.value)" class="border rounded-xl px-3 py-2.5 bg-white text-xs">'+o.productTypeOptions+'</select>'+
        '<select id="productBrandFilter" onchange="setProductCatalogFilter(\'brand\',this.value)" class="border rounded-xl px-3 py-2.5 bg-white text-xs">'+o.brandOptions+'</select>'+
        '<select id="productCategoryFilter" onchange="setProductCatalogFilter(\'category\',this.value)" class="border rounded-xl px-3 py-2.5 bg-white text-xs">'+o.categoryOptions+'</select>'+
        '<select id="productLocationFilter" onchange="setProductCatalogFilter(\'locationId\',this.value)" class="border rounded-xl px-3 py-2.5 bg-white text-xs">'+o.locationOptions+'</select>'+
      '</div>'+
      '<div class="mt-2 flex items-center justify-between gap-3">'+
        '<div class="text-[10px] text-gray-400">Product Type and Category are derived from the product Class. Location uses the live stock ledger.</div>'+
        ((F.productType||F.brand||F.category||F.locationId)?'<button onclick="clearProductCatalogFilters()" class="px-3 py-1.5 rounded-lg border text-[10px] font-semibold bg-white whitespace-nowrap">Clear Filters</button>':'')+
      '</div>';

    const topRow=search.closest('.mb-4');
    if(topRow&&topRow.parentNode)topRow.insertAdjacentElement('afterend',bar);
    else search.insertAdjacentElement('afterend',bar);
  }

  window.setProductCatalogFilter=function(key,value){
    if(!Object.prototype.hasOwnProperty.call(F,key))return;
    F[key]=value||'';
    state.productPage=1;
    if(typeof renderProductGrid==='function')renderProductGrid();
    const old=document.getElementById('productCatalogAdvancedFilters');
    if(old)old.remove();
    injectProductCatalogFilters();
  };

  window.clearProductCatalogFilters=function(){
    F.productType='';
    F.brand='';
    F.category='';
    F.locationId='';
    state.productPage=1;
    if(typeof renderProductGrid==='function')renderProductGrid();
    const old=document.getElementById('productCatalogAdvancedFilters');
    if(old)old.remove();
    injectProductCatalogFilters();
  };

  const baseRenderProducts=window.renderProducts;
  if(typeof baseRenderProducts==='function'){
    window.renderProducts=async function(){
      await loadProductLocationFilterData();
      const out=await baseRenderProducts.apply(this,arguments);
      injectProductCatalogFilters();
      // base renderer runs before the extra filter controls exist; rerender so retained filters apply.
      if(F.productType||F.brand||F.category||F.locationId){
        state.productPage=1;
        if(typeof renderProductGrid==='function')renderProductGrid();
      }
      return out;
    };
  }

  window.refreshProductLocationFilters=async function(){
    await loadProductLocationFilterData(true);
    if(state.page==='products')await renderProducts();
  };
})();