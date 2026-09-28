// Customer create/edit approval workflow for Sales users.
(function(){
  var C={requests:[]};
  function role(){return state.profile&&state.profile.role||''}
  function sales(){return role()==='sales'}
  function accountant(){return role()==='accountant'}
  function requester(){return sales()||accountant()}
  function reviewer(){return ['manager','admin','super_admin'].includes(role())}
  function clean(v){return String(v==null?'':v).trim()}
  function contactRows(root){
    return [].slice.call((root||document).querySelectorAll('.customer-contact-row')).map(function(r,i){
      return {contact_type:r.querySelector('.cc-type').value||'other',label:clean(r.querySelector('.cc-label').value)||null,contact_value:clean(r.querySelector('.cc-value').value),is_primary:i===0};
    }).filter(function(x){return x.contact_value});
  }
  async function loadRequests(){
    var r=await db.rpc('get_visible_customer_change_requests',{p_status:null});if(r.error)throw r.error;C.requests=r.data||[];return C.requests;
  }
  function pendingForCustomer(id){return C.requests.find(function(x){return x.status==='pending'&&x.customer_id===id})}
  function requestKind(r){
    var reason=String((r.requested_customer||{})._workflow_reason||'');
    if(reason==='ownership_claim'||reason==='ownership_claim_phone')return 'Ownership / Customer Claim';
    if(reason==='crm_ownership_claim')return 'CRM Customer Ownership Claim';
    if(reason==='activity_customer_request')return 'Showroom / Online Customer Request';
    if(reason==='history_customer_request')return 'Historical Showroom / Online Customer';
    if(reason==='history_customer_link')return 'Link Historical Customer';
    if(reason==='buy_conversion')return 'Buyer → Customer Master';
    return r.request_type==='create'?'New Customer':'Customer Change';
  }
  function statusBadge(s){
    var cls=s==='approved'?'bg-green-50 text-green-700 border-green-200':s==='rejected'?'bg-red-50 text-red-600 border-red-200':'bg-amber-50 text-amber-700 border-amber-200';
    return '<span class="inline-flex px-2 py-1 border rounded-lg text-[9px] font-bold uppercase '+cls+'">'+esc(s||'pending')+'</span>';
  }
  function same(a,b){return JSON.stringify(a==null?null:a)===JSON.stringify(b==null?null:b)}
  function display(v){var s=clean(v);return s||'-'}
  function contactKey(x,i){
    x=x||{};
    return [String(x.contact_type||'other').toLowerCase(),clean(x.label).toLowerCase()||('#'+i)].join('|');
  }
  function contactLabel(x){
    x=x||{};
    var type=titleCase(String(x.contact_type||'other'));
    var label=clean(x.label);
    return label?type+' · '+label:type;
  }
  function customerFieldChanges(r){
    var a=r.original_customer||{},b=r.requested_customer||{};
    var fields=[
      ['Customer Name',a.name,b.name],
      ['Customer Since',a.customer_since,b.customer_since],
      ['Address',a.address,b.address],
      ['Customer Note',a.notes,b.notes]
    ];
    if(r.request_type==='create'){
      return fields.filter(function(x){return clean(x[2])}).map(function(x){return {kind:'added',label:x[0],old:'',next:display(x[2])}});
    }
    return fields.filter(function(x){return !same(clean(x[1]),clean(x[2]))}).map(function(x){return {kind:'changed',label:x[0],old:display(x[1]),next:display(x[2])}});
  }
  function customerContactChanges(r){
    var oldList=Array.isArray(r.original_contacts)?r.original_contacts:[];
    var newList=Array.isArray(r.requested_contacts)?r.requested_contacts:[];
    if(r.request_type==='create'){
      return newList.filter(function(x){return clean(x.contact_value)}).map(function(x){
        return {kind:'added',label:contactLabel(x),old:'',next:display(x.contact_value)};
      });
    }

    var oldMap=new Map(),newMap=new Map();
    oldList.forEach(function(x,i){oldMap.set(contactKey(x,i),x)});
    newList.forEach(function(x,i){newMap.set(contactKey(x,i),x)});
    var out=[];

    oldMap.forEach(function(old,key){
      var cur=newMap.get(key);
      if(!cur){
        out.push({kind:'removed',label:contactLabel(old),old:display(old.contact_value),next:''});
        return;
      }
      if(!same(clean(old.contact_value),clean(cur.contact_value))
        || !same(clean(old.label),clean(cur.label))
        || !same(String(old.contact_type||''),String(cur.contact_type||''))){
        out.push({kind:'changed',label:contactLabel(cur),old:display(old.contact_value),next:display(cur.contact_value)});
      }
    });

    newMap.forEach(function(cur,key){
      if(!oldMap.has(key)){
        out.push({kind:'added',label:contactLabel(cur),old:'',next:display(cur.contact_value)});
      }
    });
    return out;
  }
  function customerRequestChangesHtml(r){
    var fields=customerFieldChanges(r),contacts=customerContactChanges(r);
    var count=fields.length+contacts.length;
    var row=function(x){
      var badge=x.kind==='added'?'NEW':x.kind==='removed'?'REMOVED':'CHANGED';
      var cls=x.kind==='added'?'bg-green-50 text-green-700 border-green-200':x.kind==='removed'?'bg-red-50 text-red-600 border-red-200':'bg-amber-50 text-amber-700 border-amber-200';
      if(x.kind==='added'){
        return '<div class="rounded-lg border bg-white p-3 grid md:grid-cols-[100px_150px_1fr] gap-2 items-center"><span class="px-2 py-1 rounded-md border text-[9px] font-bold '+cls+' w-fit">'+badge+'</span><b class="text-xs">'+esc(x.label)+'</b><div class="text-xs font-semibold break-words">'+esc(x.next)+'</div></div>';
      }
      if(x.kind==='removed'){
        return '<div class="rounded-lg border bg-white p-3 grid md:grid-cols-[100px_150px_1fr] gap-2 items-center"><span class="px-2 py-1 rounded-md border text-[9px] font-bold '+cls+' w-fit">'+badge+'</span><b class="text-xs">'+esc(x.label)+'</b><div class="text-xs text-red-600 line-through break-words">'+esc(x.old)+'</div></div>';
      }
      return '<div class="rounded-lg border bg-white p-3 grid md:grid-cols-[100px_140px_1fr_28px_1fr] gap-2 items-center"><span class="px-2 py-1 rounded-md border text-[9px] font-bold '+cls+' w-fit">'+badge+'</span><b class="text-xs">'+esc(x.label)+'</b><div class="text-xs text-gray-500 break-words">'+esc(x.old)+'</div><div class="text-center text-amber-600">→</div><div class="text-xs font-semibold break-words">'+esc(x.next)+'</div></div>';
    };

    return '<details open class="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50/40 overflow-hidden">'
      +'<summary class="cursor-pointer px-4 py-3 flex items-center justify-between gap-3"><div><div class="font-bold text-sm">Requested Changes</div><div class="text-[10px] text-gray-500">'+(r.request_type==='create'?'Everything below is proposed as a new customer.':'Original customer information compared with the request.')+'</div></div><span class="min-w-[24px] h-[24px] px-2 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold inline-flex items-center justify-center">'+count+'</span></summary>'
      +'<div class="border-t border-amber-100 p-4 space-y-4">'
      +'<div><div class="text-[10px] uppercase font-bold text-gray-400 mb-2">Customer Information</div><div class="grid gap-2">'+(fields.length?fields.map(row).join(''):'<div class="rounded-lg border border-dashed p-3 text-xs text-gray-400">No customer-field changes.</div>')+'</div></div>'
      +'<div><div class="text-[10px] uppercase font-bold text-gray-400 mb-2">Contact Changes</div><div class="grid gap-2">'+(contacts.length?contacts.map(row).join(''):'<div class="rounded-lg border border-dashed p-3 text-xs text-gray-400">No contact changes.</div>')+'</div></div>'
      +'</div></details>';
  }

  function customerPhoneOwnerText(m){
    if(!m)return 'Unassigned';
    return m.assigned_sales_name||'Unassigned';
  }

  window.openCrmCustomerFromCreate=async function(leadId){
    closeModal();
    await go('customer-database');
    setTimeout(function(){
      if(typeof openCustomerLead==='function')openCustomerLead(leadId);
    },120);
  };

  window.openExistingMasterFromCreate=async function(customerId){
    closeModal();
    await go('customers');
    if(customerId&&typeof openCustomerOrders==='function')setTimeout(function(){openCustomerOrders(customerId)},120);
  };

  window.submitPhoneOwnershipRequest=async function(phone){
    var note=clean(document.getElementById('phoneOwnershipRequestNote')?.value)||null;
    var btn=document.getElementById('phoneOwnershipRequestBtn');
    if(btn){btn.disabled=true;btn.textContent='Submitting...'}
    var r=await db.rpc('request_customer_ownership_by_phone',{p_phone:phone,p_request_note:note});
    if(r.error){
      if(btn){btn.disabled=false;btn.textContent='Request Ownership'}
      return showToast(r.error.message,'err');
    }
    var out=r.data||{};
    closeModal();
    if(out.action==='own_crm'){
      showToast('This customer is already in your Customer Database. Convert / Link the CRM customer first.');
      return window.openCrmCustomerFromCreate(out.lead_id);
    }
    if(out.action==='own_customer'){
      showToast('This customer is already in your Customer Master.');
      return window.openExistingMasterFromCreate(out.customer_id);
    }
    showToast(out.message||'Ownership request sent to Manager/Admin.');
    if(typeof refreshApprovalNotifications==='function')setTimeout(refreshApprovalNotifications,50);
  };

  function openCustomerPhoneConflict(phone,m){
    var mine=String(m?.assigned_sales_id||'')===String(state.user?.id||'');
    var source=m?.source==='customer_master'?'Customer Master':'Customer Database / CRM';
    var owner=customerPhoneOwnerText(m);
    var action='';
    if(mine&&m?.source==='crm'&&m?.lead_id){
      action='<button type="button" onclick="openCrmCustomerFromCreate(\''+m.lead_id+'\')" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Open CRM Customer & Convert / Link</button>';
    }else if(mine&&m?.source==='customer_master'&&m?.customer_id){
      action='<button type="button" onclick="openExistingMasterFromCreate(\''+m.customer_id+'\')" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Open Existing Customer</button>';
    }else{
      action='<div><label class="text-xs font-semibold">Request Note <span class="text-gray-400 font-normal">· optional</span></label><textarea id="phoneOwnershipRequestNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional context for Manager/Admin"></textarea></div>'
        +'<button id="phoneOwnershipRequestBtn" type="button" onclick="submitPhoneOwnershipRequest(\''+String(phone).replace(/'/g,"\\'")+'\')" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Request Ownership</button>';
    }
    openModal('Existing Customer Found',
      '<div class="space-y-4">'
      +'<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>This phone number already exists.</b><div class="mt-2">A duplicate customer cannot be created for a Sales Order.</div></div>'
      +'<div class="rounded-xl border bg-white p-4"><div class="font-bold">'+esc(m?.customer_name||'Customer')+'</div><div class="text-xs text-gray-500 mt-1">'+esc(phone)+' · '+esc(source)+'</div><div class="text-xs mt-2"><span class="text-gray-400">Handled by:</span> <b>'+esc(owner)+'</b></div></div>'
      +(mine?'<div class="text-xs text-blue-700 rounded-xl border border-blue-100 bg-blue-50 p-3">This customer is already assigned to you. Use the existing CRM/Customer Master record instead of creating another one.</div>':'<div class="text-xs text-blue-700 rounded-xl border border-blue-100 bg-blue-50 p-3">Manager/Admin approval is required before this customer can move to your ownership and be used for your Sales Order.</div>')
      +action
      +'<button type="button" onclick="closeModal()" class="w-full border rounded-xl py-3 font-semibold">Cancel</button>'
      +'</div>');
  }

  function installCreateCustomerNameSuggestions(form){
    var nameInput=document.getElementById('mcName');if(!nameInput)return;
    var box=document.createElement('div');
    box.id='customerCreatePossibleMatches';
    box.className='md:col-span-2 hidden rounded-xl border border-dashed bg-[#faf9f6] p-3';
    var banner=form.querySelector('.border-blue-100');
    if(banner&&banner.nextSibling)form.insertBefore(box,banner.nextSibling);else form.prepend(box);
    var timer=null,seq=0;
    nameInput.addEventListener('input',function(){
      clearTimeout(timer);
      var q=clean(nameInput.value);
      if(q.length<2){box.classList.add('hidden');box.innerHTML='';return}
      var my=++seq;
      timer=setTimeout(async function(){
        var r=await db.rpc('search_activity_customer_candidates',{p_query:q});
        if(my!==seq||r.error)return;
        var rows=(r.data||[]).slice(0,5);
        if(!rows.length){box.classList.add('hidden');box.innerHTML='';return}
        box.classList.remove('hidden');
        box.innerHTML='<div class="text-[10px] uppercase font-bold text-gray-400 mb-2">Possible existing customers · suggestion only</div>'
          +'<div class="grid gap-2">'+rows.map(function(x){
            var type=x.source_type==='customer_master'?'Customer Master':x.source_type==='pending_customer'?'Pending Customer':'CRM';
            var owner=x.assigned_sales_name||'Unassigned';
            return '<div class="rounded-lg border bg-white px-3 py-2 flex items-center justify-between gap-3"><div class="min-w-0"><b class="text-xs">'+esc(x.customer_name||'Customer')+'</b><div class="text-[10px] text-gray-500 mt-0.5">'+esc(type)+' · '+esc(x.phone||'Private / no phone')+' · '+esc(owner)+'</div></div>'
              +(x.source_type==='crm'&&String(x.assigned_sales_id||'')===String(state.user?.id||'')?'<button type="button" onclick="openCrmCustomerFromCreate(\''+x.lead_id+'\')" class="px-2.5 py-1.5 border rounded-lg text-[10px] font-semibold whitespace-nowrap">View CRM</button>':'')
              +'</div>';
          }).join('')+'</div><div class="text-[10px] text-gray-400 mt-2">Names alone never block or merge customers. Phone remains the strong identity check.</div>';
      },250);
    });
  }

  var baseNew=window.openNewCustomer;
  if(typeof baseNew==='function')window.openNewCustomer=async function(){
    var out=await baseNew.apply(this,arguments);
    if(!sales())return out;
    var form=document.getElementById('multiCustomerForm');if(!form)return out;
    var banner=document.createElement('div');banner.className='md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800';banner.innerHTML='<b>Manager/Admin approval required.</b> Submitting this form creates a request only. <b>No Customer Master or Customer ID is created until the request is approved.</b> Sales can add working leads directly in Customer Database / CRM.';form.prepend(banner);
    var note=document.createElement('div');note.className='md:col-span-2';note.innerHTML='<label class="text-xs font-semibold">Request Note</label><textarea id="customerCreateRequestNote" rows="2" class="mt-1 w-full border border-amber-200 bg-amber-50 rounded-xl px-3 py-2" placeholder="Optional context for Manager/Admin"></textarea>';form.insertBefore(note,form.lastElementChild);
    installCreateCustomerNameSuggestions(form);
    var btn=form.querySelector('button:not([type="button"])');if(btn)btn.textContent='Submit New Customer Request';
    form.onsubmit=async function(e){
      e.preventDefault();
      var contacts=contactRows(form),name=clean(document.getElementById('mcName').value);if(!name)return showToast('Customer name is required.','err');
      var phone=contacts.find(function(x){return x.contact_type==='phone'})?.contact_value||'';
      if(phone){
        var match=await db.rpc('find_customer_identity_by_phone',{p_phone:phone});
        if(match.error)return showToast(match.error.message,'err');
        if(match.data&&match.data.matched){
          openCustomerPhoneConflict(phone,match.data);
          return;
        }
      }
      var payload={name:name,address:clean(document.getElementById('mcAddress').value)||null,notes:clean(document.getElementById('mcNotes').value)||null,assigned_sales_id:state.user.id,active:true,customer_since:new Date().toISOString().slice(0,10)};
      var x=await db.rpc('submit_sales_customer_master_create_request',{p_requested_customer:payload,p_requested_contacts:contacts,p_request_note:clean(document.getElementById('customerCreateRequestNote').value)||null});
      if(x.error)return showToast(x.error.message,'err');
      closeModal();showToast('New customer request sent to Manager/Admin. The Customer Master will be created only after approval.');await go('customers');
    };
    return out;
  };

  var baseEdit=window.openEditCustomer;
  if(typeof baseEdit==='function')window.openEditCustomer=async function(id){
    if(requester()){
      try{await loadRequests()}catch(e){return showToast(e.message,'err')}
      var p=pendingForCustomer(id);
      if(p)return openModal('Customer Change Pending','<div class="space-y-4"><div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>Your customer change request is pending review.</b><div class="mt-1">The live customer profile has not changed.</div></div>'+(p.request_note?'<div class="rounded-xl border p-3 text-sm"><b>Request note:</b> '+esc(p.request_note)+'</div>':'')+'<button onclick="closeModal()" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Close</button></div>');
    }
    var out=await baseEdit.apply(this,arguments);
    if(!requester())return out;
    var form=document.getElementById('multiEditCustomerForm');if(!form)return out;
    var c=(state.customers||[]).find(function(x){return x.id===id});
    var banner=document.createElement('div');banner.className='md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800';banner.innerHTML='<b>Approval required.</b> Your changes will be sent to Manager/Admin. The live customer profile stays unchanged until approval.';form.prepend(banner);
    var note=document.createElement('div');note.className='md:col-span-2';note.innerHTML='<label class="text-xs font-semibold">Reason for Change</label><textarea id="customerEditRequestNote" required rows="2" class="mt-1 w-full border border-amber-200 bg-amber-50 rounded-xl px-3 py-2" placeholder="Explain what needs to be corrected."></textarea>';form.insertBefore(note,form.lastElementChild);
    var btn=form.querySelector('button:not([type="button"])');if(btn)btn.textContent='Submit Customer Change Request';
    form.onsubmit=async function(e){
      e.preventDefault();
      var contacts=contactRows(form),name=clean(document.getElementById('mecName').value),reason=clean(document.getElementById('customerEditRequestNote').value);if(!name)return showToast('Customer name is required.','err');if(!reason)return showToast('Enter the reason for this change.','err');
      var phone=contacts.find(function(x){return x.contact_type==='phone'})?.contact_value||'';
      if(phone&&sales()){
        var match=await db.rpc('find_customer_identity_by_phone',{p_phone:phone});
        if(match.error)return showToast(match.error.message,'err');
        if(match.data&&match.data.matched&&match.data.customer_id&&String(match.data.customer_id)!==String(id))return showToast('This phone number already belongs to '+(match.data.customer_name||'another customer')+'.','err');
      }
      var payload={name:name,address:clean(document.getElementById('mecAddress').value)||null,notes:clean(document.getElementById('mecNotes').value)||null,assigned_sales_id:c?c.assigned_sales_id:(sales()?state.user.id:null),active:c?c.active!==false:true,customer_since:c&&c.customer_since||null};
      var rpc=accountant()?'submit_accountant_customer_change_request':'submit_customer_change_request';
      var args=accountant()
        ?{p_customer_id:id,p_requested_customer:payload,p_requested_contacts:contacts,p_request_note:reason}
        :{p_request_type:'update',p_customer_id:id,p_requested_customer:payload,p_requested_contacts:contacts,p_request_note:reason};
      var x=await db.rpc(rpc,args);
      if(x.error)return showToast(x.error.message,'err');
      closeModal();showToast('Customer change submitted for Manager/Admin approval. Live information is unchanged.');await renderCustomers();
    };
    return out;
  };

  function addTopButton(){
    if(!reviewer()&&!requester())return;
    var add=document.querySelector('#content button[onclick="openNewCustomer()"]'),box=add&&add.parentElement;if(!box)return;if(sales())add.textContent='+ Request Customer';
    var old=box.querySelector('.customer-request-review-btn');if(old)old.remove();
    var count=C.requests.filter(function(x){return x.status==='pending'}).length,b=document.createElement('button');
    b.type='button';b.className='customer-request-review-btn px-4 py-3 border border-amber-200 bg-amber-50 text-amber-800 rounded-xl text-sm font-semibold whitespace-nowrap';
    b.textContent=reviewer()?'Pending Customer Requests ('+count+')':'My Customer Requests'+(count?' ('+count+' pending)':'');
    b.onclick=openCustomerRequests;box.insertBefore(b,add);
    if(requester())C.requests.filter(function(x){return x.status==='pending'&&x.request_type==='update'}).forEach(function(r){var btn=document.querySelector('button[onclick="openEditCustomer(\''+r.customer_id+'\')"]');if(btn){btn.textContent='Change Pending';btn.classList.add('text-amber-700','bg-amber-50')}});
  }
  var baseRender=window.renderCustomers;
  if(typeof baseRender==='function')window.renderCustomers=async function(){
    var out=await baseRender.apply(this,arguments);
    try{await loadRequests();addTopButton()}catch(e){console.warn('Customer requests:',e.message)}
    return out;
  };

  window.openCustomerRequests=async function(){
    try{await loadRequests()}catch(e){return showToast(e.message,'err')}
    var rows=reviewer()?C.requests.filter(function(x){return x.status==='pending'}):C.requests.slice(0,30);
    var html='<div class="space-y-4"><div class="rounded-xl border bg-gray-50 p-3 text-xs text-gray-600">'+(reviewer()?'Review, adjust, then publish customer changes.':'Pending requests do not change the live customer master until approved.')+'</div><div class="grid gap-2 max-h-[60vh] overflow-y-auto">';
    html+=rows.length?rows.map(function(r){return '<button type="button" onclick="openCustomerRequestDetail(\''+r.request_id+'\')" class="w-full text-left rounded-xl border bg-white p-4"><div class="flex justify-between gap-3"><div><div class="flex gap-2 items-center"><b>'+esc(r.customer_name||'Customer')+'</b>'+statusBadge(r.status)+'</div><div class="text-[10px] text-gray-400 mt-1">'+esc(requestKind(r))+' · Requested by '+esc(r.requested_by_name||'Sales')+' · '+new Date(r.requested_at).toLocaleString()+'</div>'+(r.request_note?'<div class="text-xs text-gray-600 mt-2">'+esc(r.request_note)+'</div>':'')+'</div></div></button>'}).join(''):'<div class="p-8 text-center text-sm text-gray-400 border border-dashed rounded-xl">No customer requests.</div>';
    html+='</div></div>';openModal(reviewer()?'Pending Customer Requests':'My Customer Requests',html);
  };

  function contactRow(x){
    x=x||{};var types=['phone','telegram','whatsapp','line','wechat','email','other'];
    return '<div class="review-c-contact grid grid-cols-[120px_110px_minmax(0,1fr)_42px] gap-2 items-end p-2 border rounded-xl bg-gray-50"><select class="rc-type border rounded-lg px-2 py-2 text-xs bg-white">'+types.map(function(t){return '<option value="'+t+'" '+(t===(x.contact_type||'phone')?'selected':'')+'>'+titleCase(t)+'</option>'}).join('')+'</select><input class="rc-label border rounded-lg px-2 py-2 text-xs" value="'+esc(x.label||'')+'" placeholder="Label"><input class="rc-value border rounded-lg px-2 py-2 text-xs" value="'+esc(x.contact_value||'')+'" placeholder="Number / username"><button type="button" onclick="this.closest(\'.review-c-contact\').remove()" class="h-[34px] border rounded-lg text-red-500">×</button></div>';
  }
  window.addReviewCustomerContact=function(){var x=document.getElementById('reviewCustomerContacts');if(x)x.insertAdjacentHTML('beforeend',contactRow({contact_type:'phone'}))};
  async function assignmentOptions(selected){
    var r=await db.from('app_users').select('user_id,display_name,email,role,active').in('role',['sales','manager']).eq('active',true).order('role').order('display_name');if(r.error)throw r.error;
    return '<option value="">Unassigned</option>'+(r.data||[]).map(function(u){return '<option value="'+u.user_id+'" '+(u.user_id===selected?'selected':'')+'>'+esc(u.display_name||u.email)+' — '+titleCase(u.role)+'</option>'}).join('');
  }
  window.openCustomerRequestDetail=async function(id){
    try{await loadRequests()}catch(e){return showToast(e.message,'err')}var r=C.requests.find(function(x){return x.request_id===id});if(!r)return showToast('Customer request not found.','err');
    if(!reviewer())return openModal('Customer Request','<div class="space-y-4"><div class="rounded-xl border p-4"><div class="flex gap-2 items-center"><b>'+esc(r.customer_name||'Customer')+'</b>'+statusBadge(r.status)+'</div><div class="text-xs text-gray-500 mt-2">'+esc(r.request_note||'No request note')+'</div></div>'+customerRequestChangesHtml(r)+'<button onclick="closeModal()" class="w-full bg-[#211d18] text-white rounded-xl py-3">Close</button></div>');
    var o=r.requested_customer||{},contacts=Array.isArray(r.requested_contacts)?r.requested_contacts:[],opts;try{opts=await assignmentOptions(o.assigned_sales_id||'')}catch(e){return showToast(e.message,'err')}
    var pendingOrders=[];
    if(r.customer_id){
      var orderRes=await db.from('sales_orders').select('id,order_no,sales_invoice_no,sr_no,order_date,status,customer_review_status').eq('customer_id',r.customer_id).order('order_date',{ascending:false}).limit(20);
      if(!orderRes.error)pendingOrders=orderRes.data||[];
    }
    var kind=requestKind(r);
    var html='<form id="reviewCustomerRequestForm" class="grid md:grid-cols-2 gap-4"><div class="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>'+esc(kind)+' awaiting review.</b> Requested by '+esc(r.requested_by_name||'Sales')+'.'+(r.request_type==='create'?(r.customer_id?'<div class="mt-1">This is an older provisional request. Review it before the customer is finalized.</div>':'<div class="mt-1"><b>No Customer Master has been created yet.</b> Approval will create the Customer Master and assign its Customer ID. Rejection creates nothing.</div>'):'')+(r.request_note?'<div class="mt-2"><b>Request note:</b> '+esc(r.request_note)+'</div>':'')+'</div>'
      +customerRequestChangesHtml(r)
      +(pendingOrders.length?'<div class="md:col-span-2 rounded-xl border border-purple-100 bg-purple-50 p-3"><div class="flex items-center justify-between gap-3"><div><b class="text-sm text-purple-900">Orders created while customer review is pending</b><div class="text-[10px] text-purple-700 mt-0.5">These orders remain attached to this provisional customer. Approving or merging the customer will finalize their customer review status automatically.</div></div><span class="min-w-[26px] h-[26px] rounded-full bg-purple-100 text-purple-800 text-[10px] font-bold inline-flex items-center justify-center">'+pendingOrders.length+'</span></div><div class="grid gap-1.5 mt-3">'+pendingOrders.slice(0,8).map(function(o){var doc=o.sales_invoice_no||o.sr_no||o.order_no||'Order';return '<div class="rounded-lg border border-purple-100 bg-white px-3 py-2 flex justify-between gap-3 text-xs"><b>'+esc(doc)+'</b><span class="text-gray-500">'+esc(o.order_date||'')+' · '+esc(o.customer_review_status||'pending')+'</span></div>'}).join('')+'</div></div>':'')
      +'<div class="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Final review draft below.</b> Sales\' requested values are prefilled. You can adjust them before approval.'+(r.request_type==='create'&&!r.customer_id?' The Customer Master is created only when you approve.':'')+'</div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Customer Name</label><input id="rcName" value="'+esc(o.name||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2"></div>'
      +'<div class="md:col-span-2 rounded-xl border bg-[#faf9f6] p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Customer ID</div><div class="mt-1 font-bold text-[#b3871e]">'+esc(o.customer_code||'Assigned automatically on approval')+'</div><div class="text-[9px] text-gray-400 mt-1">Automatic and permanent — reviewers cannot edit it.</div></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Address</label><input id="rcAddress" value="'+esc(o.address||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2"></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Assign Customer To</label><select id="rcHandler" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">'+opts+'</select></div>'
      +'<div class="md:col-span-2"><div class="flex justify-between items-center mb-2"><div><b class="text-sm">Contact Methods</b><div class="text-[10px] text-gray-400">Edit before publishing if needed.</div></div><button type="button" onclick="addReviewCustomerContact()" class="px-3 py-2 border rounded-lg text-xs">+ Contact</button></div><div id="reviewCustomerContacts" class="grid gap-2">'+(contacts.length?contacts.map(contactRow).join(''):contactRow({contact_type:'phone'}))+'</div></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="rcNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2">'+esc(o.notes||'')+'</textarea></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Reviewer Note</label><textarea id="rcReviewNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Optional for approval; required for rejection."></textarea></div>'
      +'<div class="md:col-span-2 flex flex-wrap justify-end gap-2 border-t pt-4">'+(r.request_type==='create'?'<button type="button" onclick="openCustomerMergePicker(\''+r.request_id+'\')" class="px-4 py-2.5 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">Link / Merge Existing</button>':'')+'<button type="button" onclick="reviewCustomerRequest(\''+r.request_id+'\',\'reject\')" class="px-4 py-2.5 border border-red-200 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">Reject</button><button type="button" onclick="reviewCustomerRequest(\''+r.request_id+'\',\'approve\')" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">'+(r.request_type==='create'?'Approve Customer':'Approve & Apply')+'</button></div></form>';
    openModal((r.request_type==='create'?'Review New Customer':'Review Customer Change'),html);
  };
  window.openCustomerMergePicker=function(requestId){
    var r=C.requests.find(function(x){return x.request_id===requestId});
    if(!r)return showToast('Customer request not found.','err');
    openModal('Link / Merge Existing Customer',
      '<div class="space-y-4">'
      +'<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">'+(r.customer_id?'<b>Use this when the Pending Review customer is actually an existing customer.</b><div class="mt-1">Linked orders/activity will be moved to the approved existing customer and the duplicate provisional record will be retired.</div>':'<b>Use this when the Sales request is actually an existing customer.</b><div class="mt-1">The request will be linked to the approved existing Customer Master instead of creating a new customer. The requested name is kept as an alias for future matching.</div>')+'</div>'
      +'<div><label class="text-xs font-semibold">Search existing customer</label><input id="mergeCustomerSearch" autocomplete="off" oninput="searchCustomerMergeTargets(\''+requestId+'\')" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Type customer name, phone or Customer ID..."></div>'
      +'<div id="mergeCustomerResults" class="grid gap-2 max-h-[45vh] overflow-y-auto"><div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">Type at least 2 characters to search.</div></div>'
      +'<div><label class="text-xs font-semibold">Reviewer Note</label><textarea id="mergeCustomerReviewNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Optional note about why these records are the same customer"></textarea></div>'
      +'<button type="button" onclick="openCustomerRequestDetail(\''+requestId+'\')" class="w-full border rounded-xl py-2.5 text-xs font-semibold">Back to Review</button>'
      +'</div>');
    setTimeout(function(){document.getElementById('mergeCustomerSearch')?.focus()},20);
  };
  window.searchCustomerMergeTargets=async function(requestId){
    var q=clean(document.getElementById('mergeCustomerSearch')?.value);
    var box=document.getElementById('mergeCustomerResults');if(!box)return;
    if(q.length<2){box.innerHTML='<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">Type at least 2 characters to search.</div>';return}
    box.innerHTML='<div class="p-5 text-center text-xs text-gray-400">Searching...</div>';
    var res=await db.rpc('search_activity_customer_candidates',{p_query:q});
    if(res.error){box.innerHTML='<div class="p-4 text-red-600 text-xs">'+esc(res.error.message)+'</div>';return}
    var req=C.requests.find(function(x){return x.request_id===requestId});
    var rows=(res.data||[]).filter(function(x){return x.source_type==='customer_master'&&String(x.customer_id)!==String(req&&req.customer_id||'')});
    box.innerHTML=rows.length?rows.map(function(x){
      return '<button type="button" onclick="mergeCustomerRequestToExisting(\''+requestId+'\',\''+x.customer_id+'\',\''+encodeURIComponent(x.customer_name||'Customer')+'\')" class="w-full text-left rounded-xl border bg-white p-3 hover:bg-blue-50"><div class="flex justify-between gap-3"><div><b>'+esc(x.customer_name||'Customer')+'</b><div class="text-[10px] text-gray-500 mt-1">'+esc(x.phone||'No phone')+(x.customer_code?' · '+esc(x.customer_code):'')+'</div></div><div class="text-right text-[10px] text-gray-500">Owner<br><b class="text-gray-700">'+esc(x.assigned_sales_name||'Unassigned')+'</b><div class="mt-1">'+Number(x.order_count||0)+' order'+(Number(x.order_count||0)===1?'':'s')+'</div></div></div></button>';
    }).join(''):'<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">No approved Customer Master match found.</div>';
  };
  window.mergeCustomerRequestToExisting=async function(requestId,targetId,encodedName){
    if(!reviewer())return showToast('Manager/Admin access required.','err');
    var name=decodeURIComponent(encodedName||'Customer');
    var req=C.requests.find(function(x){return x.request_id===requestId});var msg=req&&req.customer_id?'Merge this Pending Review customer into '+name+'? Orders and activity will move to the existing customer.':'Link this new-customer request to '+name+'? No new Customer Master will be created.';if(!confirm(msg))return;
    var note=clean(document.getElementById('mergeCustomerReviewNote')?.value)||null;
    var res=await db.rpc('review_customer_request_merge_existing',{p_request_id:requestId,p_target_customer_id:targetId,p_review_note:note});
    if(res.error)return showToast(res.error.message,'err');
    closeModal();showToast('Customer linked/merged into '+name+'.');await go('customers');
  };

  async function duplicateWarning(contacts,excludeId){
    var hits=[];for(var i=0;i<contacts.length;i++){var c=contacts[i];if(!c.contact_value)continue;var r=await db.rpc('check_customer_contact_duplicate',{p_type:c.contact_type,p_value:c.contact_value,p_exclude_customer_id:excludeId||null});if(!r.error&&(r.data||[]).length)hits.push(c.contact_value)}
    return hits;
  }
  window.reviewCustomerRequest=async function(id,action){
    if(!reviewer())return showToast('Manager/Admin access required.','err');var r=C.requests.find(function(x){return x.request_id===id});if(!r)return showToast('Request not found.','err');
    var note=clean(document.getElementById('rcReviewNote')&&document.getElementById('rcReviewNote').value);if(action==='reject'&&!note&&role()!=='super_admin')return showToast('Enter a rejection reason.','err');
    var finalCustomer=null,finalContacts=null;
    if(action==='approve'){
      var name=clean(document.getElementById('rcName').value);if(!name)return showToast('Customer name is required.','err');
      finalContacts=[].slice.call(document.querySelectorAll('#reviewCustomerContacts .review-c-contact')).map(function(x,i){return {contact_type:x.querySelector('.rc-type').value,label:clean(x.querySelector('.rc-label').value)||null,contact_value:clean(x.querySelector('.rc-value').value),is_primary:i===0}}).filter(function(x){return x.contact_value});
      var dups=await duplicateWarning(finalContacts,r.customer_id);if(dups.length&&!confirm('Duplicate contact found: '+dups.join(', ')+'. Approve anyway?'))return;
      finalCustomer=Object.assign({},r.requested_customer||{},{name:name,address:clean(document.getElementById('rcAddress').value)||null,notes:clean(document.getElementById('rcNotes').value)||null,assigned_sales_id:document.getElementById('rcHandler').value||null,active:true});
      delete finalCustomer.customer_code;
    }
    if(!confirm(action==='approve'?(r.request_type==='create'?'Approve and publish this customer?':'Approve and apply these customer changes?'):'Reject this customer request?'))return;
    var x=await db.rpc('review_customer_change_request',{p_request_id:id,p_action:action,p_review_note:note||null,p_final_customer:finalCustomer,p_final_contacts:finalContacts});if(x.error)return showToast(x.error.message,'err');
    closeModal();showToast(action==='approve'?(r.request_type==='create'?'Customer approved and published':'Customer changes approved and applied'):'Customer request rejected');await go('customers');
  };
})();