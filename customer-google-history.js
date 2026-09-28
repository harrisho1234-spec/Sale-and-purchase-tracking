// Google Sheet archived customer history inside Customer Database detail.
(function(){
  const baseOpenCustomerLead=window.openCustomerLead;
  if(typeof baseOpenCustomerLead!=='function')return;

  function fmtHistoryDate(v){
    if(!v)return '-';
    const raw=String(v).slice(0,10);
    const d=new Date(raw+'T00:00:00');
    return Number.isNaN(d.getTime())?raw:d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  }
  function fmtHistoryMonth(v){
    const raw=String(v||'').slice(0,7);
    const m=raw.match(/^(\d{4})-(\d{2})$/);
    if(!m)return raw||'-';
    return new Date(Date.UTC(Number(m[1]),Number(m[2])-1,1)).toLocaleDateString(undefined,{year:'numeric',month:'short',timeZone:'UTC'});
  }
  function activityName(v){return v==='showroom_visit'?'Showroom Visit':'Online'}
  function businessTone(v){
    return v==='RK'?'bg-[#fff8e7] text-[#8a650e] border-[#ead69b]':v==='TK'?'bg-[#f5f1ff] text-[#6741a5] border-[#d8c9f4]':'bg-gray-50 text-gray-600 border-gray-200';
  }
  function stageTone(v){
    const s=String(v||'').toLowerCase();
    if(s.includes('buy'))return 'bg-green-50 text-green-700 border-green-200';
    if(s.includes('potential'))return 'bg-amber-50 text-amber-700 border-amber-200';
    if(s.includes('waiting'))return 'bg-purple-50 text-purple-700 border-purple-200';
    if(s.includes('reject'))return 'bg-red-50 text-red-600 border-red-200';
    if(s.includes('contact'))return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  }
  function historyHtml(rows){
    if(!rows.length)return '<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">No Google Sheet history matched by phone number.</div>';
    return '<div class="grid gap-2">'+rows.map(h=>{
      const sources=h.source_counts&&typeof h.source_counts==='object'
        ?Object.entries(h.source_counts).map(([k,v])=>k+' × '+v).join(', ')
        :'';
      return '<div class="rounded-xl border p-3 bg-[#fffaf0]">'
        +'<div class="flex flex-wrap items-center justify-between gap-2"><div class="flex items-center gap-2"><b class="text-sm">'+esc(activityName(h.activity_type))+'</b><span class="px-2 py-0.5 rounded-md border text-[9px] font-bold '+businessTone(h.business_code)+'">'+esc(h.business_code||'-')+'</span>'+(h.latest_stage?'<span class="px-2 py-0.5 rounded-md border text-[9px] font-semibold '+stageTone(h.latest_stage)+'">'+esc(h.latest_stage)+'</span>':'')+'</div><span class="text-[10px] text-gray-400">'+esc(fmtHistoryMonth(h.period_month))+'</span></div>'
        +'<div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[10px]"><div><div class="uppercase font-bold text-gray-400">Entries</div><b>'+Number(h.entry_count||0)+'</b></div><div><div class="uppercase font-bold text-gray-400">Latest</div><b>'+esc(fmtHistoryDate(h.latest_activity_date))+'</b></div><div><div class="uppercase font-bold text-gray-400">Sales</div><b>'+esc(h.sales_rep_name||'Unassigned')+'</b></div><div><div class="uppercase font-bold text-gray-400">Source Sheet</div><b>'+esc(h.source_sheet||'-')+'</b></div></div>'
        +(h.latest_interest?'<div class="text-[11px] text-gray-600 mt-2">Interest: '+esc(h.latest_interest)+'</div>':'')
        +(sources?'<div class="text-[10px] text-gray-500 mt-1">Sources: '+esc(sources)+'</div>':'')
        +(h.latest_follow_up_date?'<div class="text-[10px] text-blue-600 mt-1">Follow up: '+esc(fmtHistoryDate(h.latest_follow_up_date))+'</div>':'')
        +'</div>';
    }).join('')+'</div>';
  }

  window.openCustomerLead=async function(id){
    await baseOpenCustomerLead(id);
    const body=document.getElementById('leadDetailBody');
    if(!body||document.getElementById('leadGoogleHistorySection'))return;

    const section=document.createElement('div');
    section.id='leadGoogleHistorySection';
    section.className='border-t mt-5 pt-5';
    section.innerHTML='<div class="flex items-center justify-between mb-3"><div><h4 class="font-bold">Google Sheet History</h4><div class="text-[10px] text-gray-400">Archived history matched by normalized phone. Raw rows stay in Google Sheets.</div></div></div><div class="py-8 text-center text-xs text-gray-400">Loading Google history...</div>';
    body.appendChild(section);

    const res=await db.rpc('get_customer_google_history_for_lead',{p_lead_id:id});
    const loading=section.lastElementChild;
    if(!loading)return;
    loading.outerHTML=res.error
      ?'<div class="text-red-500 text-xs">'+esc(res.error.message)+'</div>'
      :historyHtml(res.data||[]);
  };
})();