// Tax-only declared Code / Set manager.
// A Tax Code is a declaration only; physical stock remains on its component products.
(function(){
  const T=window.taxDeclaredCodeState||{codes:[],loadedAt:0,collapsed:false,editor:null,catalog:[],catalogLoaded:false};
  window.taxDeclaredCodeState=T;

  const role=()=>String((typeof state!=='undefined'&&state.profile?.role)||'');
  const n=v=>Number(v||0);
  const q=v=>{const x=n(v);return Number.isInteger(x)?x.toLocaleString():x.toLocaleString(undefined,{maximumFractionDigits:2})};
  const e=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const cash=(v,cur='USD')=>{
    if(v==null||v==='')return '—';
    const x=Number(v);
    if(!Number.isFinite(x))return e(v);
    try{return new Intl.NumberFormat(undefined,{style:'currency',currency:String(cur||'USD').toUpperCase(),maximumFractionDigits:2}).format(x)}
    catch(_){return String(cur||'USD').toUpperCase()+' '+x.toLocaleString(undefined,{maximumFractionDigits:2})}
  };

  async function fetchAllBalances(){
    const rows=[];
    for(let from=0;;from+=250){
      const r=await db.from('inventory_product_tax_balance').select('*').order('product_id').range(from,from+249);
      if(r.error)throw r.error;
      rows.push(...(r.data||[]));
      if((r.data||[]).length<250)break;
    }
    T.catalog=rows;
    T.catalogLoaded=true;
    return rows;
  }

  window.loadTaxDeclaredCodes=async function(force=false){
    const now=Date.now();
    if(!force&&T.loadedAt&&now-T.loadedAt<30000)return T.codes;
    const r=await db.rpc('get_tax_declared_codes',{p_include_inactive:role()==='super_admin'});
    if(r.error)throw r.error;
    T.codes=Array.isArray(r.data)?r.data:[];
    T.loadedAt=now;
    return T.codes;
  };

  window.invalidateTaxDeclaredCodes=function(){T.loadedAt=0;T.codes=[]};
  window.taxDeclaredCodeSignature=function(){
    return (T.codes||[]).map(x=>[x.id,x.active,x.on_hand_sets,x.available_sets,x.updated_at].join(':')).join('|');
  };

  window.toggleTaxCodePanel=function(){
    T.collapsed=!T.collapsed;
    if(typeof window.renderStockInventoryBody==='function')window.renderStockInventoryBody();
  };

  window.taxDeclaredCodesHtml=function(search=''){
    const s=String(search||'').trim().toLowerCase();
    const rows=(T.codes||[]).filter(x=>{
      if(!s)return true;
      const hay=[x.code,x.name,x.tax_note,x.tax_pricing_note,
        ...(Array.isArray(x.components)?x.components.flatMap(p=>[p.code,p.item_name,p.brand,p.class]):[])
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
    const active=(T.codes||[]).filter(x=>x.active!==false).length;
    return \`<div class="mb-4 rounded-2xl border border-amber-200 bg-amber-50/20 overflow-hidden">
      <div class="px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 \${T.collapsed?'':'border-b border-amber-100'}">
        <button type="button" onclick="toggleTaxCodePanel()" class="flex-1 text-left flex items-start gap-3">
          <span class="mt-0.5 text-amber-700">\${T.collapsed?'▸':'▾'}</span>
          <span><span class="font-bold text-sm text-amber-900">Tax Codes / Sets</span>
          <span class="block text-[10px] text-amber-800 mt-1">Tax-only Codes are declarations, not physical stock items. Their Qty is calculated from the physical product Codes and Required Qty mapped underneath.</span></span>
        </button>
        <div class="flex flex-wrap items-center gap-2">
          <span class="px-2.5 py-1.5 rounded-lg border border-amber-200 bg-white text-[10px] font-bold text-amber-800">\${active} active</span>
          \${role()==='super_admin'?'<button onclick="event.stopPropagation();openTaxCodeEditor()" class="px-3 py-2 rounded-xl bg-[#211d18] text-white text-xs font-semibold">+ Create Tax Code / Set</button>':''}
        </div>
      </div>
      \${T.collapsed?'':\`<div class="p-3">
        \${rows.length?\`<div class="grid xl:grid-cols-2 gap-3">\${rows.map(x=>{
          const comps=Array.isArray(x.components)?x.components:[];
          return \`<div class="rounded-2xl border bg-white p-4 \${x.active===false?'opacity-60':''}">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2"><span class="text-[10px] font-black text-[#a77d1a]">\${e(x.code||'')}</span><span class="px-2 py-0.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[8px] font-bold">TAX-ONLY CODE</span>\${x.active===false?'<span class="px-2 py-0.5 rounded-lg border text-[8px] font-bold text-gray-500">INACTIVE</span>':''}</div>
                <div class="font-bold text-base mt-1">\${e(x.name||'Tax Set')}</div>
                <div class="text-[10px] text-gray-400 mt-1">\${comps.length} component\${comps.length===1?'':'s'} · Physical stock stays on component Codes</div>
              </div>
              <div class="grid grid-cols-2 gap-2 shrink-0">
                <div class="rounded-xl border bg-gray-50 px-3 py-2 text-center"><div class="text-[8px] uppercase font-bold text-gray-400">Sets On Hand</div><div class="text-lg font-black">\${q(x.on_hand_sets)}</div></div>
                <div class="rounded-xl border bg-green-50 px-3 py-2 text-center"><div class="text-[8px] uppercase font-bold text-green-700">Available Qty</div><div class="text-lg font-black text-green-700">\${q(x.available_sets)}</div></div>
              </div>
            </div>
            \${role()==='super_admin'?\`<div class="mt-3 flex flex-wrap gap-2 text-[10px]"><span class="px-2 py-1 rounded-lg border bg-amber-50"><b>Tax Cost:</b> \${x.tax_cost==null?'—':cash(x.tax_cost,x.tax_currency)}</span><span class="px-2 py-1 rounded-lg border bg-amber-50"><b>Tax Sale:</b> \${x.tax_sale_price==null?'—':cash(x.tax_sale_price,x.tax_currency)}</span></div>\`:''}
            <div class="mt-3 flex flex-wrap gap-1.5">\${comps.length?comps.slice(0,8).map(p=>\`<span class="inline-flex items-center px-2 py-1 rounded-lg border bg-gray-50 text-[9px]"><b>\${e(p.code||'')}</b>&nbsp;×&nbsp;\${q(p.required_qty)}</span>\`).join(''):'<span class="text-[10px] text-gray-400">No components</span>'}\${comps.length>8?\`<span class="text-[9px] text-gray-400 px-1">+\${comps.length-8} more</span>\`:''}</div>
            \${x.tax_note?\`<div class="mt-2 text-[10px] text-gray-500 whitespace-pre-wrap">\${e(x.tax_note)}</div>\`:''}
            \${role()==='super_admin'?\`<div class="mt-3 flex justify-end gap-2"><button onclick="openTaxCodeEditor('\${x.id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Edit Tax Code / Set</button><button onclick="setTaxCodeActive('\${x.id}',\${x.active===false?'true':'false'})" class="px-3 py-2 border \${x.active===false?'border-green-200 text-green-700':'border-red-200 text-red-600'} rounded-lg text-[10px] font-semibold">\${x.active===false?'Reactivate':'Deactivate'}</button></div>\`:''}
          </div>\`;
        }).join('')}</div>\`:'<div class="py-8 text-center text-sm text-gray-400">No Tax Codes / Sets yet. Create one to map physical product Codes and Required Qty under a separate tax-only Code.</div>'}
      </div>\`}
    </div>\`;
  };

  const productById=id=>(T.catalog||[]).find(x=>String(x.product_id)===String(id))||null;

  function renderEditor(){
    const x=T.editor,body=document.getElementById('modalBody');
    if(!x||!body)return;
    const comps=x.components||[];
    body.innerHTML=\`<div class="space-y-4">
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-900"><b>Tax-only Code:</b> this does not create a physical product or any Stock IN / OUT. Qty is calculated automatically from the component products below.</div>
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="text-xs font-semibold text-gray-600">Tax Code *</label><input value="\${e(x.code)}" oninput="taxCodeEditorField('code',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm" placeholder="Example: TAX-VENUS-01"></div>
        <div><label class="text-xs font-semibold text-gray-600">Tax Name *</label><input value="\${e(x.name)}" oninput="taxCodeEditorField('name',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm" placeholder="Example: Venus Mirror Set"></div>
        <div><label class="text-xs font-semibold text-gray-600">Tax Cost</label><input type="number" min="0" step="0.01" value="\${e(x.tax_cost??'')}" oninput="taxCodeEditorField('tax_cost',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm" placeholder="Optional"></div>
        <div><label class="text-xs font-semibold text-gray-600">Tax Sale Price</label><input type="number" min="0" step="0.01" value="\${e(x.tax_sale_price??'')}" oninput="taxCodeEditorField('tax_sale_price',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm" placeholder="Optional"></div>
        <div><label class="text-xs font-semibold text-gray-600">Tax Currency</label><select onchange="taxCodeEditorField('tax_currency',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm bg-white">\${['USD','EUR','CNY','GBP'].map(v=>\`<option value="\${v}" \${String(x.tax_currency||'USD')===v?'selected':''}>\${v}</option>\`).join('')}</select></div>
        <div><label class="text-xs font-semibold text-gray-600">Tax Pricing Note</label><input value="\${e(x.tax_pricing_note||'')}" oninput="taxCodeEditorField('tax_pricing_note',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm" placeholder="Optional"></div>
      </div>
      <div><label class="text-xs font-semibold text-gray-600">Tax Note</label><textarea oninput="taxCodeEditorField('tax_note',this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm min-h-[70px]" placeholder="Optional">\${e(x.tax_note||'')}</textarea></div>
      <div class="rounded-2xl border p-4">
        <div class="font-bold text-sm">Add Physical Product + Required Qty</div>
        <div class="text-[10px] text-gray-400 mt-1">Example: Code A × 2 means one unit of this Tax Code requires 2 units of Code A.</div>
        <div class="grid lg:grid-cols-[1fr_110px_1fr_120px] gap-2 mt-3">
          <div class="relative"><input id="taxCodeComponentSearch" oninput="showTaxCodeComponentSuggestions(this)" class="w-full border rounded-xl px-3 py-2 text-xs" placeholder="Search Code, product or brand..."><input id="taxCodeComponentId" type="hidden"><div id="taxCodeComponentSuggestions" class="absolute left-0 right-0 top-full mt-1 z-30 bg-white border rounded-xl shadow-xl max-h-64 overflow-auto hidden"></div></div>
          <input id="taxCodeComponentQty" type="number" min="0.0001" step="0.01" value="1" class="border rounded-xl px-3 py-2 text-xs" placeholder="Required Qty">
          <input id="taxCodeComponentNote" class="border rounded-xl px-3 py-2 text-xs" placeholder="Optional note">
          <button onclick="addTaxCodeEditorComponent()" class="px-3 py-2 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Add Component</button>
        </div>
      </div>
      <div class="rounded-2xl border overflow-hidden">
        <div class="px-4 py-3 bg-gray-50 border-b flex items-center justify-between"><div><div class="font-bold text-sm">Components</div><div class="text-[10px] text-gray-400">\${comps.length} physical product\${comps.length===1?'':'s'} mapped</div></div><div class="text-[10px] text-gray-400">Tax Qty is derived automatically.</div></div>
        <div class="divide-y">\${comps.length?comps.map((p,i)=>\`<div class="p-4 grid lg:grid-cols-[1.3fr_120px_1fr_90px] gap-3 items-center">
          <div class="flex items-center gap-3 min-w-0"><div class="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden shrink-0">\${p.image_url?\`<img loading="lazy" decoding="async" src="\${e(p.image_url)}" class="w-full h-full object-cover">\`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">\${e(p.code||'')}</div><div class="font-semibold text-sm truncate">\${e(p.item_name||'')}</div><div class="text-[9px] text-gray-400">On hand \${q(p.on_hand)} · Available \${q(p.available)}</div></div></div>
          <div><label class="text-[9px] text-gray-400">Required Qty</label><input type="number" min="0.0001" step="0.01" value="\${e(p.required_qty)}" oninput="taxCodeEditorComponentField(\${i},'required_qty',this.value)" class="mt-1 w-full border rounded-lg px-2 py-1.5 text-xs"></div>
          <div><label class="text-[9px] text-gray-400">Component Note</label><input value="\${e(p.note||'')}" oninput="taxCodeEditorComponentField(\${i},'note',this.value)" class="mt-1 w-full border rounded-lg px-2 py-1.5 text-xs" placeholder="Optional"></div>
          <button onclick="removeTaxCodeEditorComponent(\${i})" class="px-2.5 py-2 border border-red-200 text-red-600 rounded-lg text-[10px] font-semibold">Remove</button>
        </div>\`).join(''):'<div class="p-8 text-center text-sm text-gray-400">Add at least one product Code and Required Qty.</div>'}</div>
      </div>
      <div class="flex justify-end gap-2"><button onclick="closeModal()" class="px-4 py-2.5 border rounded-xl text-xs font-semibold">Cancel</button><button onclick="saveTaxCodeEditor()" class="px-5 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Save Tax Code / Set</button></div>
    </div>\`;
  }

  window.taxCodeEditorField=function(field,value){if(T.editor)T.editor[field]=value};
  window.taxCodeEditorComponentField=function(i,field,value){if(T.editor?.components?.[i])T.editor.components[i][field]=value};

  window.openTaxCodeEditor=async function(id=null){
    if(role()!=='super_admin')return showToast('Super Admin only.','err');
    try{
      await Promise.all([window.loadTaxDeclaredCodes(true),T.catalogLoaded?Promise.resolve(T.catalog):fetchAllBalances()]);
      const row=id?(T.codes||[]).find(x=>String(x.id)===String(id)):null;
      T.editor={
        id:row?.id||null,code:row?.code||'',name:row?.name||'',
        tax_cost:row?.tax_cost??'',tax_sale_price:row?.tax_sale_price??'',
        tax_currency:row?.tax_currency||'USD',tax_note:row?.tax_note||'',
        tax_pricing_note:row?.tax_pricing_note||'',
        components:(row?.components||[]).map(p=>({...p,required_qty:p.required_qty??1,note:p.note||''}))
      };
      openModal(row?'Edit Tax Code / Set':'Create Tax Code / Set','');
      const shell=document.querySelector('#modal > div');if(shell)shell.style.maxWidth='1050px';
      renderEditor();
    }catch(err){showToast(err.message||'Could not open Tax Code editor.','err')}
  };

  window.showTaxCodeComponentSuggestions=function(input){
    const box=document.getElementById('taxCodeComponentSuggestions');
    if(!box||!T.editor)return;
    document.getElementById('taxCodeComponentId').value='';
    const s=String(input?.value||'').trim().toLowerCase();
    if(!s){box.classList.add('hidden');box.innerHTML='';return}
    const used=new Set((T.editor.components||[]).map(p=>String(p.product_id)));
    const rows=(T.catalog||[]).filter(p=>!used.has(String(p.product_id))&&[p.code,p.item_name,p.brand,p.class].filter(Boolean).join(' ').toLowerCase().includes(s)).slice(0,30);
    box.innerHTML=rows.length?rows.map(p=>\`<button type="button" onclick="selectTaxCodeComponent('\${p.product_id}')" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-0"><div class="text-[10px] font-bold text-[#a77d1a]">\${e(p.code||'')}</div><div class="text-xs font-semibold">\${e(p.item_name||'')}</div><div class="text-[9px] text-gray-400">\${e(p.brand||'')} · On hand \${q(p.on_hand)} · Available \${q(p.available)}</div></button>\`).join(''):'<div class="p-3 text-xs text-gray-400">No matching active product.</div>';
    box.classList.remove('hidden');
  };

  window.selectTaxCodeComponent=function(id){
    const p=productById(id);if(!p)return;
    document.getElementById('taxCodeComponentId').value=id;
    document.getElementById('taxCodeComponentSearch').value=(p.code||'')+' · '+(p.item_name||'');
    document.getElementById('taxCodeComponentSuggestions').classList.add('hidden');
  };

  window.addTaxCodeEditorComponent=function(){
    if(!T.editor)return;
    const id=document.getElementById('taxCodeComponentId')?.value||'';
    const qty=Number(document.getElementById('taxCodeComponentQty')?.value||0);
    const note=document.getElementById('taxCodeComponentNote')?.value.trim()||'';
    if(!id)return showToast('Choose a product from the suggestions.','err');
    if(!Number.isFinite(qty)||qty<=0)return showToast('Required Qty must be greater than 0.','err');
    if(T.editor.components.some(p=>String(p.product_id)===String(id)))return showToast('This product is already in the Tax Code.','err');
    const p=productById(id);if(!p)return showToast('Product not found.','err');
    T.editor.components.push({product_id:id,required_qty:qty,note,code:p.code,item_name:p.item_name,brand:p.brand,class:p.class,image_url:p.image_url,on_hand:p.on_hand,available:p.available});
    renderEditor();
  };

  window.removeTaxCodeEditorComponent=function(i){if(T.editor){T.editor.components.splice(i,1);renderEditor()}};

  window.saveTaxCodeEditor=async function(){
    const x=T.editor;if(!x||role()!=='super_admin')return;
    const code=String(x.code||'').trim(),name=String(x.name||'').trim();
    if(!code)return showToast('Tax Code is required.','err');
    if(!name)return showToast('Tax Name is required.','err');
    if(!x.components.length)return showToast('Add at least one physical product component.','err');
    const comps=x.components.map(p=>({product_id:p.product_id,required_qty:Number(p.required_qty),note:String(p.note||'').trim()||null}));
    if(comps.some(p=>!Number.isFinite(p.required_qty)||p.required_qty<=0))return showToast('Every Required Qty must be greater than 0.','err');
    const num=v=>String(v??'').trim()===''?null:Number(v);
    const r=await db.rpc('save_tax_declared_code',{
      p_id:x.id||null,p_code:code,p_name:name,p_tax_cost:num(x.tax_cost),p_tax_sale_price:num(x.tax_sale_price),
      p_tax_currency:x.tax_currency||'USD',p_tax_note:String(x.tax_note||'').trim()||null,
      p_tax_pricing_note:String(x.tax_pricing_note||'').trim()||null,p_components:comps
    });
    if(r.error)return showToast(r.error.message,'err');
    T.editor=null;closeModal();T.loadedAt=0;
    await window.loadTaxDeclaredCodes(true);
    if(typeof window.renderStockInventoryBody==='function')await window.renderStockInventoryBody();
    showToast('Tax Code / Set saved. Physical stock was not changed.');
  };

  window.setTaxCodeActive=async function(id,active){
    if(role()!=='super_admin')return;
    const row=(T.codes||[]).find(x=>String(x.id)===String(id));if(!row)return;
    if(!confirm((active?'Reactivate ':'Deactivate ')+(row.code||'this Tax Code')+'?\\n\\nThis changes only the tax declaration. Physical stock is not changed.'))return;
    const r=await db.rpc('set_tax_declared_code_active',{p_id:id,p_active:!!active});
    if(r.error)return showToast(r.error.message,'err');
    T.loadedAt=0;await window.loadTaxDeclaredCodes(true);
    if(typeof window.renderStockInventoryBody==='function')await window.renderStockInventoryBody();
    showToast(active?'Tax Code reactivated.':'Tax Code deactivated.');
  };
})();