// Customer create/edit approval workflow for Sales users.
(function(){
  var C={requests:[]};
  function role(){return state.profile&&state.profile.role||''}
  function sales(){return role()==='sales'}
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
  function pendingForCustomer(id){return C.requests.find(function(x){return x.status==='pending'&&x.request_type==='update'&&x.customer_id===id})}
  function statusBadge(s){
    var cls=s==='approved'?'bg-green-50 text-green-700 border-green-200':s==='rejected'?'bg-red-50 text-red-600 border-red-200':'bg-amber-50 text-amber-700 border-amber-200';
    return '<span class="inline-flex px-2 py-1 border rounded-lg text-[9px] font-bold uppercase '+cls+'">'+esc(s||'pending')+'</span>';
  }

  var baseNew=window.openNewCustomer;
  if(typeof baseNew==='function')window.openNewCustomer=async function(){
    var out=await baseNew.apply(this,arguments);
    if(!sales())return out;
    var form=document.getElementById('multiCustomerForm');if(!form)return out;
    var banner=document.createElement('div');banner.className='md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800';banner.innerHTML='<b>Approval required.</b> This customer will stay Pending and will not appear in the live customer master until Manager/Admin approves and publishes it.';form.prepend(banner);
    var note=document.createElement('div');note.className='md:col-span-2';note.innerHTML='<label class="text-xs font-semibold">Request Note</label><textarea id="customerCreateRequestNote" rows="2" class="mt-1 w-full border border-amber-200 bg-amber-50 rounded-xl px-3 py-2" placeholder="Optional context for Manager/Admin"></textarea>';form.insertBefore(note,form.lastElementChild);
    var btn=form.querySelector('button:not([type="button"])');if(btn)btn.textContent='Submit Customer for Approval';
    form.onsubmit=async function(e){
      e.preventDefault();
      var contacts=contactRows(form),name=clean(document.getElementById('mcName').value);if(!name)return showToast('Customer name is required.','err');
      var payload={name:name,customer_code:clean(document.getElementById('mcCode').value)||null,address:clean(document.getElementById('mcAddress').value)||null,notes:clean(document.getElementById('mcNotes').value)||null,assigned_sales_id:state.user.id,active:true,customer_since:new Date().toISOString().slice(0,10)};
      var x=await db.rpc('submit_customer_change_request',{p_request_type:'create',p_customer_id:null,p_requested_customer:payload,p_requested_contacts:contacts,p_request_note:clean(document.getElementById('customerCreateRequestNote').value)||null});
      if(x.error)return showToast(x.error.message,'err');
      closeModal();showToast('Customer submitted for Manager/Admin approval. It is not public yet.');await go('customers');
    };
    return out;
  };

  var baseEdit=window.openEditCustomer;
  if(typeof baseEdit==='function')window.openEditCustomer=async function(id){
    if(sales()){
      try{await loadRequests()}catch(e){return showToast(e.message,'err')}
      var p=pendingForCustomer(id);
      if(p)return openModal('Customer Change Pending','<div class="space-y-4"><div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>Your customer change request is pending review.</b><div class="mt-1">The live customer profile has not changed.</div></div>'+(p.request_note?'<div class="rounded-xl border p-3 text-sm"><b>Request note:</b> '+esc(p.request_note)+'</div>':'')+'<button onclick="closeModal()" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Close</button></div>');
    }
    var out=await baseEdit.apply(this,arguments);
    if(!sales())return out;
    var form=document.getElementById('multiEditCustomerForm');if(!form)return out;
    var c=(state.customers||[]).find(function(x){return x.id===id});
    var banner=document.createElement('div');banner.className='md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800';banner.innerHTML='<b>Approval required.</b> Your changes will be sent to Manager/Admin. The live customer profile stays unchanged until approval.';form.prepend(banner);
    var note=document.createElement('div');note.className='md:col-span-2';note.innerHTML='<label class="text-xs font-semibold">Reason for Change</label><textarea id="customerEditRequestNote" required rows="2" class="mt-1 w-full border border-amber-200 bg-amber-50 rounded-xl px-3 py-2" placeholder="Explain what needs to be corrected."></textarea>';form.insertBefore(note,form.lastElementChild);
    var btn=form.querySelector('button:not([type="button"])');if(btn)btn.textContent='Submit Customer Change Request';
    form.onsubmit=async function(e){
      e.preventDefault();
      var contacts=contactRows(form),name=clean(document.getElementById('mecName').value),reason=clean(document.getElementById('customerEditRequestNote').value);if(!name)return showToast('Customer name is required.','err');if(!reason)return showToast('Enter the reason for this change.','err');
      var payload={name:name,customer_code:clean(document.getElementById('mecCode').value)||null,address:clean(document.getElementById('mecAddress').value)||null,notes:clean(document.getElementById('mecNotes').value)||null,assigned_sales_id:c&&c.assigned_sales_id||state.user.id,active:c?c.active!==false:true,customer_since:c&&c.customer_since||null};
      var x=await db.rpc('submit_customer_change_request',{p_request_type:'update',p_customer_id:id,p_requested_customer:payload,p_requested_contacts:contacts,p_request_note:reason});
      if(x.error)return showToast(x.error.message,'err');
      closeModal();showToast('Customer change submitted for Manager/Admin approval. Live information is unchanged.');await renderCustomers();
    };
    return out;
  };

  function addTopButton(){
    if(!reviewer()&&!sales())return;
    var add=document.querySelector('#content button[onclick="openNewCustomer()"]'),box=add&&add.parentElement;if(!box)return;
    var old=box.querySelector('.customer-request-review-btn');if(old)old.remove();
    var count=C.requests.filter(function(x){return x.status==='pending'}).length,b=document.createElement('button');
    b.type='button';b.className='customer-request-review-btn px-4 py-3 border border-amber-200 bg-amber-50 text-amber-800 rounded-xl text-sm font-semibold whitespace-nowrap';
    b.textContent=reviewer()?'Pending Customer Requests ('+count+')':'My Customer Requests'+(count?' ('+count+' pending)':'');
    b.onclick=openCustomerRequests;box.insertBefore(b,add);
    if(sales())C.requests.filter(function(x){return x.status==='pending'&&x.request_type==='update'}).forEach(function(r){var btn=document.querySelector('button[onclick="openEditCustomer(\''+r.customer_id+'\')"]');if(btn){btn.textContent='Change Pending';btn.classList.add('text-amber-700','bg-amber-50')}});
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
    html+=rows.length?rows.map(function(r){return '<button type="button" onclick="openCustomerRequestDetail(\''+r.request_id+'\')" class="w-full text-left rounded-xl border bg-white p-4"><div class="flex justify-between gap-3"><div><div class="flex gap-2 items-center"><b>'+esc(r.customer_name||'Customer')+'</b>'+statusBadge(r.status)+'</div><div class="text-[10px] text-gray-400 mt-1">'+(r.request_type==='create'?'New Customer':'Customer Change')+' · Requested by '+esc(r.requested_by_name||'Sales')+' · '+new Date(r.requested_at).toLocaleString()+'</div>'+(r.request_note?'<div class="text-xs text-gray-600 mt-2">'+esc(r.request_note)+'</div>':'')+'</div></div></button>'}).join(''):'<div class="p-8 text-center text-sm text-gray-400 border border-dashed rounded-xl">No customer requests.</div>';
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
    if(!reviewer())return openModal('Customer Request','<div class="space-y-4"><div class="rounded-xl border p-4"><div class="flex gap-2 items-center"><b>'+esc(r.customer_name||'Customer')+'</b>'+statusBadge(r.status)+'</div><div class="text-xs text-gray-500 mt-2">'+esc(r.request_note||'No request note')+'</div></div><button onclick="closeModal()" class="w-full bg-[#211d18] text-white rounded-xl py-3">Close</button></div>');
    var o=r.requested_customer||{},contacts=Array.isArray(r.requested_contacts)?r.requested_contacts:[],opts;try{opts=await assignmentOptions(o.assigned_sales_id||'')}catch(e){return showToast(e.message,'err')}
    var html='<form id="reviewCustomerRequestForm" class="grid md:grid-cols-2 gap-4"><div class="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>'+(r.request_type==='create'?'New customer awaiting publication.':'Customer change awaiting approval.')+'</b> Requested by '+esc(r.requested_by_name||'Sales')+'. You can adjust the final information below.'+(r.request_note?'<div class="mt-2"><b>Sales note:</b> '+esc(r.request_note)+'</div>':'')+'</div>'
      +'<div><label class="text-xs font-semibold">Customer Name</label><input id="rcName" value="'+esc(o.name||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Customer Code</label><input id="rcCode" value="'+esc(o.customer_code||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2"></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Address</label><input id="rcAddress" value="'+esc(o.address||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2"></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Assign Customer To</label><select id="rcHandler" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">'+opts+'</select></div>'
      +'<div class="md:col-span-2"><div class="flex justify-between items-center mb-2"><div><b class="text-sm">Contact Methods</b><div class="text-[10px] text-gray-400">Edit before publishing if needed.</div></div><button type="button" onclick="addReviewCustomerContact()" class="px-3 py-2 border rounded-lg text-xs">+ Contact</button></div><div id="reviewCustomerContacts" class="grid gap-2">'+(contacts.length?contacts.map(contactRow).join(''):contactRow({contact_type:'phone'}))+'</div></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="rcNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2">'+esc(o.notes||'')+'</textarea></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Reviewer Note</label><textarea id="rcReviewNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Optional for approval; required for rejection."></textarea></div>'
      +'<div class="md:col-span-2 flex justify-end gap-2 border-t pt-4"><button type="button" onclick="reviewCustomerRequest(\''+r.request_id+'\',\'reject\')" class="px-4 py-2.5 border border-red-200 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">Reject</button><button type="button" onclick="reviewCustomerRequest(\''+r.request_id+'\',\'approve\')" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">'+(r.request_type==='create'?'Approve & Publish':'Approve & Apply')+'</button></div></form>';
    openModal((r.request_type==='create'?'Review New Customer':'Review Customer Change'),html);
  };
  async function duplicateWarning(contacts,excludeId){
    var hits=[];for(var i=0;i<contacts.length;i++){var c=contacts[i];if(!c.contact_value)continue;var r=await db.rpc('check_customer_contact_duplicate',{p_type:c.contact_type,p_value:c.contact_value,p_exclude_customer_id:excludeId||null});if(!r.error&&(r.data||[]).length)hits.push(c.contact_value)}
    return hits;
  }
  window.reviewCustomerRequest=async function(id,action){
    if(!reviewer())return showToast('Manager/Admin access required.','err');var r=C.requests.find(function(x){return x.request_id===id});if(!r)return showToast('Request not found.','err');
    var note=clean(document.getElementById('rcReviewNote')&&document.getElementById('rcReviewNote').value);if(action==='reject'&&!note)return showToast('Enter a rejection reason.','err');
    var finalCustomer=null,finalContacts=null;
    if(action==='approve'){
      var name=clean(document.getElementById('rcName').value);if(!name)return showToast('Customer name is required.','err');
      finalContacts=[].slice.call(document.querySelectorAll('#reviewCustomerContacts .review-c-contact')).map(function(x,i){return {contact_type:x.querySelector('.rc-type').value,label:clean(x.querySelector('.rc-label').value)||null,contact_value:clean(x.querySelector('.rc-value').value),is_primary:i===0}}).filter(function(x){return x.contact_value});
      var dups=await duplicateWarning(finalContacts,r.customer_id);if(dups.length&&!confirm('Duplicate contact found: '+dups.join(', ')+'. Approve anyway?'))return;
      finalCustomer=Object.assign({},r.requested_customer||{},{name:name,customer_code:clean(document.getElementById('rcCode').value)||null,address:clean(document.getElementById('rcAddress').value)||null,notes:clean(document.getElementById('rcNotes').value)||null,assigned_sales_id:document.getElementById('rcHandler').value||null,active:true});
    }
    if(!confirm(action==='approve'?(r.request_type==='create'?'Approve and publish this customer?':'Approve and apply these customer changes?'):'Reject this customer request?'))return;
    var x=await db.rpc('review_customer_change_request',{p_request_id:id,p_action:action,p_review_note:note||null,p_final_customer:finalCustomer,p_final_contacts:finalContacts});if(x.error)return showToast(x.error.message,'err');
    closeModal();showToast(action==='approve'?(r.request_type==='create'?'Customer approved and published':'Customer changes approved and applied'):'Customer request rejected');await go('customers');
  };
})();