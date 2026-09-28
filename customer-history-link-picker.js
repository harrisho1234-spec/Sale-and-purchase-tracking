// Historical Showroom / Online Customer Master link picker.
// Loaded last so every role sees the same explicit match-selection workflow.
(function(){
  const linkPicker={
    indexId:null,
    context:null,
    rows:[],
    targetId:null,
    choiceMade:false,
    assignees:[],
    searchTimer:null
  };

  function role(){return state.profile?.role||''}
  function isSuper(){return role()==='super_admin'}
  function allowed(){return ['sales','manager','admin','super_admin'].includes(role())}
  function clean(v){return String(v==null?'':v).trim()}
  function normName(v){return clean(v).toLowerCase().replace(/\s+/g,' ')}
  function normPhone(v){
    let d=clean(v).replace(/\D/g,'');
    if(d.startsWith('855'))d='0'+d.slice(3);
    return d;
  }
  function rowById(id){return linkPicker.rows.find(function(x){return String(x.customer_id)===String(id)})||null}

  function contactSummary(r){
    const cs=Array.isArray(r.contacts)?r.contacts:[];
    if(!cs.length)return 'No contact saved';
    return cs.slice(0,3).map(function(c){
      return (c.type||'Contact')+': '+(c.value||'');
    }).join(' · ');
  }

  async function loadContext(indexId){
    const res=await db.rpc('get_customer_history_link_context',{p_history_index_id:Number(indexId)});
    if(res.error)throw res.error;
    return res.data||{};
  }

  async function loadAssignees(){
    if(!isSuper())return [];
    const res=await db.from('app_users')
      .select('user_id,display_name,email,role,active')
      .in('role',['sales','manager'])
      .eq('active',true)
      .order('role')
      .order('display_name');
    if(res.error)throw res.error;
    return res.data||[];
  }

  function scoreRow(r){
    let score=10,reason='Possible name match';
    const nameExact=normName(r.customer_name)===normName(linkPicker.context?.customer_name);
    if(nameExact){score=80;reason='Exact name match'}
    const p=normPhone(linkPicker.context?.phone);
    if(p){
      const contacts=Array.isArray(r.contacts)?r.contacts:[];
      const exact=contacts.some(function(c){return c.type==='phone'&&normPhone(c.value)===p});
      const matchedPhone=(r._matchedQueries||[]).some(function(q){return normPhone(q)===p});
      if(exact){score=100;reason='Exact phone match'}
      else if(matchedPhone){score=Math.max(score,90);reason='Phone/contact search match'}
    }
    return {score:score,reason:reason};
  }

  async function searchRows(manualQuery){
    const ctx=linkPicker.context||{};
    const queries=[];
    if(clean(manualQuery).length>=2){
      queries.push(clean(manualQuery));
    }else{
      if(clean(ctx.phone).length>=2)queries.push(clean(ctx.phone));
      if(clean(ctx.customer_name).length>=2)queries.push(clean(ctx.customer_name));
    }

    const unique=[...new Set(queries)];
    if(!unique.length)return [];

    const responses=await Promise.all(unique.map(function(q){
      return db.rpc('search_customer_directory',{p_query:q});
    }));

    const map=new Map();
    responses.forEach(function(res,index){
      if(res.error)return;
      const query=unique[index]||'';
      (res.data||[]).forEach(function(r){
        if(!map.has(r.customer_id)){
          const copy=Object.assign({},r);
          copy._matchedQueries=[];
          map.set(r.customer_id,copy);
        }
        const row=map.get(r.customer_id);
        if(query&&!row._matchedQueries.includes(query))row._matchedQueries.push(query);
      });
    });

    const rows=[...map.values()].map(function(r){
      const s=scoreRow(r);
      r._matchScore=s.score;
      r._matchReason=clean(manualQuery)?'Manual search result':s.reason;
      return r;
    });

    rows.sort(function(a,b){
      return Number(b._matchScore||0)-Number(a._matchScore||0)
        || String(a.customer_name||'').localeCompare(String(b.customer_name||''));
    });
    return rows.slice(0,12);
  }

  function assignmentOptions(){
    const selected=String(document.getElementById('historyLinkAssignee')?.value||linkPicker.context?.assigned_sales_id||'');
    return '<option value="">Unassigned</option>'+linkPicker.assignees.map(function(u){
      const label=(u.display_name||u.email||'User')+' — '+(u.role==='manager'?'Manager':'Sales');
      return '<option value="'+esc(u.user_id)+'" '+(String(u.user_id)===selected?'selected':'')+'>'+esc(label)+'</option>';
    }).join('');
  }

  function renderRows(){
    const box=document.getElementById('historyLinkSuggestions');
    if(!box)return;

    const rows=linkPicker.rows||[];
    let html='';
    if(rows.length){
      html+='<div class="text-[10px] uppercase tracking-wide font-bold text-gray-400 mb-2">Suggested existing customers</div>';
      html+=rows.map(function(r){
        const selected=linkPicker.choiceMade&&String(linkPicker.targetId||'')===String(r.customer_id);
        const owner=r.handled_by_name||r.handled_by_email||'Unassigned';
        const score=Number(r._matchScore||0);
        const strong=score>=90;
        return '<button type="button" onclick="selectHistoryCustomerTarget(\''+r.customer_id+'\')" class="w-full text-left rounded-xl border p-3 mb-2 '+(selected?'border-[#b3871e] bg-amber-50':'bg-white hover:bg-gray-50')+'">'
          +'<div class="flex items-start justify-between gap-3">'
            +'<div class="min-w-0">'
              +'<div class="flex flex-wrap items-center gap-2"><b>'+esc(r.customer_name||'Customer')+'</b>'
                +(r.customer_code?'<span class="text-[9px] font-bold text-[#b3871e]">'+esc(r.customer_code)+'</span>':'')
                +(strong?'<span class="px-2 py-0.5 rounded-md bg-green-50 border border-green-200 text-green-700 text-[9px] font-bold">Strong match</span>':'')
              +'</div>'
              +'<div class="text-[10px] text-gray-500 mt-1">'+esc(r._matchReason||'Possible match')+' · '+esc(contactSummary(r))+'</div>'
            +'</div>'
            +'<div class="text-right text-[10px] text-gray-500 whitespace-nowrap">Owner<br><b class="text-gray-800">'+esc(owner)+'</b></div>'
          +'</div>'
        +'</button>';
      }).join('');
    }else{
      html+='<div class="rounded-xl border border-dashed p-5 text-center text-xs text-gray-400">No existing Customer Master suggestion found.</div>';
    }

    const newSelected=linkPicker.choiceMade&&linkPicker.targetId===null;
    html+='<button type="button" onclick="selectHistoryCustomerTarget(\'\')" class="mt-2 w-full text-left rounded-xl border p-3 '+(newSelected?'border-[#b3871e] bg-amber-50':'bg-white hover:bg-gray-50')+'">'
      +'<div class="font-semibold">Create as New Customer Master</div>'
      +'<div class="text-[10px] text-gray-500 mt-1">Use this only when none of the existing customers above is the same person/company.</div>'
    +'</button>';

    box.innerHTML=html;
  }

  function renderPicker(){
    const root=document.getElementById('historyCustomerLinkPickerBody');
    if(!root)return;
    const ctx=linkPicker.context||{};
    const superText=isSuper()
      ?'<b>Super Admin direct action.</b> Choose the correct Customer Master or create a new one, then assign it to any Sales Rep/Manager. No approval reason is required.'
      :'<b>Choose the intended customer before submitting.</b> Existing ownership is shown below. Linking to another Sales Rep’s customer does not silently transfer it; the request goes through the approval/ownership workflow.';

    root.innerHTML=''
      +'<form id="historyCustomerLinkPickerForm" class="space-y-4">'
        +'<div class="rounded-xl border bg-[#faf9f6] p-4">'
          +'<div class="text-[10px] uppercase font-bold text-gray-400">Historical Customer</div>'
          +'<div class="font-bold text-lg mt-1">'+esc(ctx.customer_name||'Customer')+'</div>'
          +'<div class="text-xs text-gray-500 mt-1">'+esc(ctx.phone||'No phone')+' · Current history owner: '+esc(ctx.assigned_sales_name||'Unassigned')+'</div>'
        +'</div>'
        +'<div class="rounded-xl border '+(isSuper()?'border-blue-200 bg-blue-50 text-blue-900':'border-amber-200 bg-amber-50 text-amber-900')+' p-3 text-xs">'+superText+'</div>'
        +'<div>'
          +'<label class="text-xs font-semibold">Search Customer Master</label>'
          +'<input id="historyLinkManualSearch" autocomplete="off" oninput="historyCustomerLinkSearchChanged(this.value)" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white" placeholder="Search name, phone, Customer ID or social username...">'
          +'<div class="text-[10px] text-gray-400 mt-1">Suggestions are based on the historical name/phone. You can search manually if the correct customer is not suggested.</div>'
        +'</div>'
        +'<div id="historyLinkSuggestions"></div>'
        +(isSuper()
          ?'<div><label class="text-xs font-semibold">Assign / Reassign To</label><select id="historyLinkAssignee" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">'+assignmentOptions()+'</select><div class="text-[10px] text-gray-400 mt-1">For an existing Customer Master, this can also change its current handler.</div></div>'
          :'')
        +(!isSuper()
          ?'<div><label class="text-xs font-semibold">Request Note <span class="text-gray-400 font-normal">· optional</span></label><textarea id="historyCustomerRequestNoteV2" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional context for Manager/Admin"></textarea></div>'
          :'')
        +'<button id="historyLinkSubmitBtn" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">'+(isSuper()?'Link / Convert Now':'Submit Link / Convert Request')+'</button>'
      +'</form>';

    renderRows();
    document.getElementById('historyCustomerLinkPickerForm').onsubmit=submitPicker;
  }

  window.selectHistoryCustomerTarget=function(id){
    linkPicker.choiceMade=true;
    linkPicker.targetId=clean(id)?id:null;
    if(isSuper()){
      const sel=document.getElementById('historyLinkAssignee');
      const row=linkPicker.targetId?rowById(linkPicker.targetId):null;
      if(sel){
        if(row)sel.value=row.assigned_sales_id||'';
        else sel.value=linkPicker.context?.assigned_sales_id||'';
      }
    }
    renderRows();
  };

  window.historyCustomerLinkSearchChanged=function(v){
    clearTimeout(linkPicker.searchTimer);
    linkPicker.searchTimer=setTimeout(async function(){
      const q=clean(v);
      try{
        linkPicker.rows=await searchRows(q);
        linkPicker.choiceMade=false;
        linkPicker.targetId=null;
        renderRows();
      }catch(err){
        showToast(err.message,'err');
      }
    },250);
  };

  async function submitPicker(e){
    e.preventDefault();
    if(!linkPicker.choiceMade)return showToast('Choose an existing customer or Create as New first.','err');

    const btn=document.getElementById('historyLinkSubmitBtn');
    if(btn){btn.disabled=true;btn.textContent=isSuper()?'Linking...':'Submitting...'}

    let res;
    if(isSuper()){
      const assigned=document.getElementById('historyLinkAssignee')?.value||null;
      res=await db.rpc('superadmin_resolve_customer_history_master',{
        p_history_index_id:Number(linkPicker.indexId),
        p_target_customer_id:linkPicker.targetId||null,
        p_assigned_sales_id:assigned
      });
    }else{
      const note=clean(document.getElementById('historyCustomerRequestNoteV2')?.value)||null;
      res=await db.rpc('request_customer_history_master_selected',{
        p_history_index_id:Number(linkPicker.indexId),
        p_target_customer_id:linkPicker.targetId||null,
        p_request_note:note
      });
    }

    if(res.error){
      if(btn){btn.disabled=false;btn.textContent=isSuper()?'Link / Convert Now':'Submit Link / Convert Request'}
      return showToast(res.error.message,'err');
    }

    const out=res.data||{};
    closeModal();
    showToast(out.message||(isSuper()?'Customer linked / converted.':'Customer link request submitted.'));
    if(typeof refreshApprovalNotifications==='function')setTimeout(refreshApprovalNotifications,50);

    if(isSuper()&&out.customer_id&&typeof openCustomerOrders==='function'){
      return openCustomerOrders(out.customer_id);
    }
  }

  window.requestHistoryCustomerMaster=async function(indexId,encodedName){
    if(!allowed())return showToast('Customer conversion access required.','err');

    linkPicker.indexId=Number(indexId);
    linkPicker.context=null;
    linkPicker.rows=[];
    linkPicker.targetId=null;
    linkPicker.choiceMade=false;
    linkPicker.assignees=[];

    const fallback=decodeURIComponent(encodedName||'Customer');
    openModal('Convert / Link Customer — '+fallback,'<div id="historyCustomerLinkPickerBody" class="py-12 text-center text-sm text-gray-400">Loading customer matches...</div>');

    try{
      const results=await Promise.all([
        loadContext(linkPicker.indexId),
        loadAssignees()
      ]);
      linkPicker.context=results[0]||{};
      linkPicker.assignees=results[1]||[];

      if(linkPicker.context.linked_customer_id){
        closeModal();
        showToast('This historical customer is already linked to Customer Master.');
        if(typeof openCustomerOrders==='function')return openCustomerOrders(linkPicker.context.linked_customer_id);
        return;
      }

      linkPicker.rows=await searchRows('');
      renderPicker();
    }catch(err){
      const root=document.getElementById('historyCustomerLinkPickerBody');
      if(root)root.innerHTML='<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">'+esc(err.message)+'</div>';
      else showToast(err.message,'err');
    }
  };
})();