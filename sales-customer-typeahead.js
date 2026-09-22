// Searchable customer selector for Create Sale / Customer Order.
// Keeps #orderCustomer as the real customer_id field used by save logic.
(function(){
  const baseOpenNewOrder=window.openNewOrder;
  if(typeof baseOpenNewOrder!=='function')return;

  function normalize(v){return String(v||'').trim().toLowerCase()}
  function optionRows(select){
    return [...select.options]
      .filter(o=>o.value)
      .map(o=>{
        const c=(state.customers||[]).find(x=>x.id===o.value)||{};
        return {
          id:o.value,
          name:c.name||o.textContent||'Customer',
          code:c.customer_code||'',
          phone:c.phone||'',
          address:c.address||''
        };
      });
  }

  function buildCustomerTypeahead(){
    const select=document.getElementById('orderCustomer');
    if(!select||select.dataset.typeaheadReady==='1')return;
    select.dataset.typeaheadReady='1';

    const wrap=document.createElement('div');
    wrap.className='relative mt-1';
    select.parentNode.insertBefore(wrap,select);
    wrap.appendChild(select);

    // Keep the original select in the DOM so all existing save/validation logic still uses customer_id.
    select.classList.add('hidden-force');
    select.required=false;

    const input=document.createElement('input');
    input.id='orderCustomerSearch';
    input.type='text';
    input.autocomplete='off';
    input.placeholder='Type customer name, code, or phone...';
    input.className='w-full border rounded-xl px-4 py-2.5 bg-white outline-none focus:ring-2 focus:ring-[#d6ba72]';
    input.setAttribute('aria-label','Search customer');
    wrap.appendChild(input);

    const menu=document.createElement('div');
    menu.id='orderCustomerSuggestions';
    menu.className='hidden absolute z-[120] left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto';
    wrap.appendChild(menu);

    let active=-1;
    let visible=[];

    function setSelected(row){
      select.value=row.id;
      select.dispatchEvent(new Event('change',{bubbles:true}));
      input.value=row.name;
      input.dataset.customerId=row.id;
      menu.classList.add('hidden');
      active=-1;
    }

    function draw(){
      const q=normalize(input.value);
      const rows=optionRows(select);
      visible=(q?rows.filter(r=>normalize([r.name,r.code,r.phone,r.address].join(' ')).includes(q)):rows).slice(0,20);
      active=-1;
      if(!visible.length){
        menu.innerHTML='<div class="px-4 py-3 text-sm text-gray-400">No matching customer</div>';
      }else{
        menu.innerHTML=visible.map((r,i)=>`
          <button type="button" data-customer-index="${i}" class="w-full text-left px-4 py-3 hover:bg-amber-50 border-b last:border-b-0 border-gray-100">
            <div class="font-semibold text-sm text-gray-800">${esc(r.name)}</div>
            <div class="text-[11px] text-gray-400 mt-0.5">${[r.code,r.phone,r.address].filter(Boolean).map(esc).join(' · ')||'Customer'}</div>
          </button>`).join('');
      }
      menu.classList.remove('hidden');
      menu.querySelectorAll('[data-customer-index]').forEach(btn=>{
        btn.addEventListener('mousedown',e=>{e.preventDefault();setSelected(visible[Number(btn.dataset.customerIndex)])});
      });
    }

    function paintActive(){
      menu.querySelectorAll('[data-customer-index]').forEach((b,i)=>{
        b.classList.toggle('bg-amber-50',i===active);
      });
      const el=menu.querySelector(`[data-customer-index="${active}"]`);
      if(el)el.scrollIntoView({block:'nearest'});
    }

    input.addEventListener('focus',draw);
    input.addEventListener('input',()=>{
      // Typing after a selection clears the old customer_id until a suggestion is picked again.
      if(input.dataset.customerId){delete input.dataset.customerId;select.value=''}
      draw();
    });
    input.addEventListener('keydown',e=>{
      if(menu.classList.contains('hidden')&&['ArrowDown','ArrowUp'].includes(e.key))draw();
      if(e.key==='ArrowDown'){
        e.preventDefault();if(visible.length){active=(active+1)%visible.length;paintActive()}
      }else if(e.key==='ArrowUp'){
        e.preventDefault();if(visible.length){active=(active-1+visible.length)%visible.length;paintActive()}
      }else if(e.key==='Enter'&&active>=0&&visible[active]){
        e.preventDefault();setSelected(visible[active]);
      }else if(e.key==='Escape'){
        menu.classList.add('hidden');active=-1;
      }
    });
    input.addEventListener('blur',()=>setTimeout(()=>menu.classList.add('hidden'),150));

    // New order must always begin blank.
    select.value='';
    input.value='';
  }

  window.openNewOrder=async function(){
    const out=await baseOpenNewOrder.apply(this,arguments);
    buildCustomerTypeahead();
    return out;
  };
})();
