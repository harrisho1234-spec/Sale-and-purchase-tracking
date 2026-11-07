// Free PWA push notifications + app attention badge.
(function(){
  const P={
    attention:null,
    key:null,
    registration:null,
    refreshTimer:null,
    openingTarget:false,
    sections:[]
  };

  function readyUser(){
    return !!(window.state&&state.user&&state.user.id&&window.db);
  }

  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function toast(msg,type){
    if(typeof showToast==='function')showToast(msg,type);
  }

  function urlBase64ToUint8Array(base64String){
    const padding='='.repeat((4-base64String.length%4)%4);
    const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(base64);
    return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
  }

  async function registration(){
    if(P.registration)return P.registration;
    if(!('serviceWorker' in navigator))throw new Error('Service workers are not supported on this device.');
    P.registration=await navigator.serviceWorker.ready;
    try{await P.registration.update()}catch(_){}
    return P.registration;
  }

  async function getPublicKey(){
    if(P.key)return P.key;
    const {data,error}=await db.rpc('get_web_push_public_key');
    if(error)throw error;
    P.key=data;
    return data;
  }

  function subscriptionKeys(sub){
    const j=sub.toJSON();
    return {
      endpoint:sub.endpoint,
      p256dh:j.keys&&j.keys.p256dh||'',
      auth:j.keys&&j.keys.auth||''
    };
  }

  async function saveSubscription(sub){
    if(!sub||!readyUser())return;
    const k=subscriptionKeys(sub);
    if(!k.endpoint||!k.p256dh||!k.auth)return;
    const {error}=await db.rpc('save_web_push_subscription',{
      p_endpoint:k.endpoint,
      p_p256dh:k.p256dh,
      p_auth:k.auth,
      p_user_agent:navigator.userAgent||null
    });
    if(error)throw error;
  }

  async function ensureSubscription(askPermission){
    if(!readyUser())return null;
    if(!('Notification' in window)||!('PushManager' in window))return null;

    let permission=Notification.permission;
    if(permission==='default'&&askPermission){
      permission=await Notification.requestPermission();
    }

    if(permission!=='granted')return null;

    const reg=await registration();
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      const key=await getPublicKey();
      sub=await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(key)
      });
    }

    await saveSubscription(sub);
    return sub;
  }

  async function deactivateSubscriptionForLogout(){
    try{
      if(!readyUser()||!('serviceWorker' in navigator))return;
      const reg=await registration();
      const sub=await reg.pushManager.getSubscription();
      if(!sub)return;
      await db.rpc('remove_web_push_subscription',{p_endpoint:sub.endpoint});
    }catch(_){}
  }

  function attentionCount(){
    return Number(P.attention&&P.attention.count||0);
  }

  function button(){
    return document.getElementById('appNotificationBtn');
  }

  function ensureButton(){
    if(button())return button();
    const passwordBtn=document.querySelector('button[onclick="openChangeMyPassword()"]');
    if(!passwordBtn||!passwordBtn.parentElement)return null;

    const b=document.createElement('button');
    b.id='appNotificationBtn';
    b.type='button';
    b.className='relative px-3 py-2 rounded-lg border bg-white text-xs font-semibold min-w-[42px]';
    b.onclick=window.openAppNotifications;
    passwordBtn.parentElement.insertBefore(b,passwordBtn);
    return b;
  }

  function renderButton(){
    const b=ensureButton();
    if(!b)return;

    const count=attentionCount();
    const supported='Notification' in window&&'serviceWorker' in navigator&&'PushManager' in window;
    const permission=supported?Notification.permission:'unsupported';

    const countBadge=count>0?'<span class="absolute -top-2 -right-2 min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold inline-flex items-center justify-center">'+Math.min(count,99)+(count>99?'+':'')+'</span>':'';
    if(permission==='granted'){
      b.innerHTML='🔔'+countBadge;
      b.title=count>0?(P.attention.body||count+' action items'):'Notifications enabled · No action items';
      b.classList.toggle('border-amber-300',count>0);
    }else if(permission==='denied'){
      b.innerHTML='🔕'+countBadge;
      b.title=count>0?(P.attention.body||count+' action items')+' · Browser push is blocked':'Notifications are blocked in browser settings';
      b.classList.toggle('border-amber-300',count>0);
    }else if(permission==='unsupported'){
      b.innerHTML='🔔'+countBadge;
      b.title=count>0?(P.attention.body||count+' action items')+' · Browser push is not supported':'Push notifications are not supported on this browser';
      b.classList.toggle('border-amber-300',count>0);
    }else{
      b.innerHTML='🔔'+(countBadge||'<span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500"></span>');
      b.title=count>0?(P.attention.body||count+' action items')+' · Click to enable browser notifications':'Enable app notifications';
      b.classList.toggle('border-amber-300',count>0);
    }
  }

  async function applyAppBadge(){
    const count=attentionCount();
    if(navigator.setAppBadge){
      try{
        if(count>0)await navigator.setAppBadge(count);
        else if(navigator.clearAppBadge)await navigator.clearAppBadge();
      }catch(_){}
    }
  }

  async function refreshAttention(){
    if(!readyUser())return;
    try{
      let base={count:0,target:'dashboard',body:'No action items'};
      try{
        const {data,error}=await db.rpc('get_my_app_attention');
        if(error)throw error;
        if(data)base=data;
      }catch(err){console.warn('Other app attention unavailable; continuing Google Sheet alerts:',err.message||err)}
      // The database powers real web-push alerts. Daily Plan reviews live only
      // in Google Sheets, so add their authenticated count to the IN-APP bell.
      // Do not store or duplicate report content in Supabase.
      // Independent permission-checked Google Sheets lookups run in parallel.
      // This avoids adding three separate relay delays to the notification bell.
      const [dailyCount,dailyAlerts,todoAlerts]=await Promise.all([
        (async()=>{
          if(typeof window.getSalesDailyApprovalQueue!=='function')return 0;
          try{
            const rows=await window.getSalesDailyApprovalQueue();
            return Array.isArray(rows)?rows.length:0;
          }catch(err){console.warn('Google Sheet daily reviews could not update app bell:',err.message||err);return 0}
        })(),
        (async()=>{
          if(typeof window.getSalesDailyAttention!=='function')
            return {count:0,missingCount:0,unfinishedCount:0,target:'dashboard'};
          try{return await window.getSalesDailyAttention()}
          catch(err){
            console.warn('Google Sheet Daily Plan alerts unavailable:',err.message||err);
            return {count:0,missingCount:0,unfinishedCount:0,target:'dashboard'};
          }
        })(),
        (async()=>{
          if(typeof window.getSalesTodoAttention!=='function')
            return {count:0,overdueCount:0,items:[],target:'sales-todo'};
          try{return await window.getSalesTodoAttention()}
          catch(err){
            console.warn('Google Sheet overdue To-Do alerts unavailable:',err.message||err);
            return {count:0,overdueCount:0,items:[],target:'sales-todo'};
          }
        })()
      ]);
      const overdueCount=Math.max(0,Number(todoAlerts.overdueCount||0));
      const summaries=[];
      if(overdueCount)summaries.push(overdueCount+' overdue Sales To-Do task'+(overdueCount===1?'':'s'));
      if(dailyCount)summaries.push(dailyCount+' pending Team Daily Review'+(dailyCount===1?'':'s'));
      if(dailyAlerts.missingCount)summaries.push(dailyAlerts.missingCount+' missing Evening Result'+(dailyAlerts.missingCount===1?'':'s'));
      if(dailyAlerts.unfinishedCount)summaries.push(dailyAlerts.unfinishedCount+' unfinished sales task'+(dailyAlerts.unfinishedCount===1?'':'s'));
      if(Number(base.count||0))summaries.push(base.body||Number(base.count)+' other action items');
      P.sections=[
        ...(overdueCount?[{name:'Overdue Sales To-Do',count:overdueCount,target:'sales-todo-overdue',items:Array.isArray(todoAlerts.items)?todoAlerts.items:[]}]:[]),
        ...(dailyAlerts.missingCount?[{name:'Missing Evening Results',count:Number(dailyAlerts.missingCount),target:dailyAlerts.target}]:[]),
        ...(dailyCount?[{name:'Pending Team Daily Reviews',count:dailyCount,target:'approvals'}]:[]),
        ...(dailyAlerts.unfinishedCount?[{name:'Unfinished Daily Plan tasks',count:Number(dailyAlerts.unfinishedCount),target:dailyAlerts.target}]:[]),
        ...(Number(base.count||0)?[{name:'Other app action items',count:Number(base.count),target:base.target||'dashboard'}]:[])
      ];
      P.attention={
        ...base,
        count:Number(base.count||0)+dailyCount+Number(dailyAlerts.count||0)+overdueCount,
        body:summaries.length?summaries.join(' · '):(base.body||'No action items'),
        // Missing PM deadlines are important to management, but are NOT
        // misclassified as pending manager approvals.
        target:Number(dailyAlerts.missingCount||0)>0?dailyAlerts.target:
          dailyCount>0?'approvals':
          overdueCount>0?'sales-todo':
          Number(dailyAlerts.count||0)>0?dailyAlerts.target:base.target
      };
      renderButton();
      await applyAppBadge();
      if('Notification' in window&&Notification.permission==='granted'){
        await ensureSubscription(false);
      }
    }catch(err){
      console.warn('App notification refresh:',err&&err.message||err);
    }
  }

  async function waitForUser(){
    for(let i=0;i<50;i++){
      if(readyUser())return true;
      await new Promise(r=>setTimeout(r,200));
    }
    return false;
  }

  async function openTarget(target){
    if(!target||P.openingTarget)return;
    P.openingTarget=true;
    try{
      if(await waitForUser()){
        if(target==='tax-inventory'){
          if(typeof go==='function')await go('stock-inventory');
          if(typeof setInventoryTab==='function')await setInventoryTab('tax');
        }else if(target==='stock-approvals'){
          if(typeof go==='function')await go('stock-inventory');
          if(typeof setInventoryTab==='function')await setInventoryTab('requests');
        }else if(typeof go==='function'){
          await go(target);
        }
      }
    }finally{
      P.openingTarget=false;
    }
  }

  function openAttentionList(){
    if(!P.sections.length)return;
    if(P.sections.length===1)return window.openAppNotificationSection(0);
    if(typeof openModal!=='function')return window.openAppNotificationSection(0);
    const html='<div class="space-y-3">'+
      '<p class="text-sm text-slate-600">Choose which notifications to review. Overdue Sales To-Do tasks remain visible until completed, cancelled, or rescheduled.</p>'+
      P.sections.map((section,i)=>{
        const overdue=section.target==='sales-todo-overdue';
        const sample=overdue?'<div class="mt-2 space-y-1">'+
          section.items.slice(0,5).map(t=>'<div class="text-xs text-slate-600">'+
            esc(t.assignee?String(t.assignee)+' · ':'')+esc(t.title)+' · '+esc(t.dueDate)+
            ' ('+Math.max(1,Number(t.daysOverdue||1))+' day(s) overdue)</div>').join('')+
          (section.count>5?'<div class="text-xs text-slate-500">And more overdue tasks…</div>':'')+'</div>':'';
        return '<button type="button" class="block text-left w-full border rounded-xl px-4 py-3 bg-white hover:bg-slate-50" onclick="openAppNotificationSection('+i+')">'+
          '<span class="flex items-center justify-between gap-3"><b class="text-sm '+(overdue?'text-red-700':'text-slate-800')+'">'+esc(section.name)+'</b>'+
          '<span class="rounded-full bg-red-100 text-red-800 px-2.5 py-1 text-xs font-bold">'+section.count+'</span></span>'+
          sample+'</button>';
      }).join('')+'</div>';
    openModal('Notifications',html);
  }
  window.openAppNotificationSection=async function(index){
    const section=P.sections[Number(index)];
    if(!section)return;
    if(typeof closeModal==='function')closeModal();
    if(section.target==='sales-todo-overdue'){
      if(typeof window.openSalesTodoOverdue==='function')return window.openSalesTodoOverdue();
      return openTarget('sales-todo');
    }
    return openTarget(section.target||'dashboard');
  };

  window.refreshAppNotifications=refreshAttention;

  window.openAppNotifications=async function(){
    await refreshAttention();
    const count=attentionCount();
    const supported=('Notification' in window)&&('serviceWorker' in navigator)&&('PushManager' in window);

    // In-app attention works even when browser/OS push is unavailable or blocked.
    if(!supported){
      if(count>0)return openAttentionList();
      return toast('No action items right now. Browser push is not supported on this browser.');
    }

    if(Notification.permission==='denied'){
      if(count>0){
        toast('Browser notifications are blocked, but your in-app requests are still available.');
        return openAttentionList();
      }
      return toast('Notifications are blocked. Allow notifications for this site in your browser/app settings.','err');
    }

    if(Notification.permission!=='granted'){
      try{
        const sub=await ensureSubscription(true);
        if(sub){
          await refreshAttention();
          toast('Browser notifications enabled.');
        }else{
          toast('Browser notifications were not enabled. In-app notifications will still work.');
        }
      }catch(err){
        toast(err.message||'Could not enable browser notifications.','err');
      }
      if(attentionCount()>0)return openAttentionList();
      return;
    }

    if(count>0){
      await openAttentionList();
    }else{
      toast('Notifications are enabled. No action items right now.');
    }
  };

  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data&&event.data.type==='OPEN_APP_TARGET'){
      openTarget(event.data.target||'dashboard');
    }
  });

  const oldLogout=window.logout;
  if(typeof oldLogout==='function'){
    window.logout=async function(){
      await deactivateSubscriptionForLogout();
      return oldLogout.apply(this,arguments);
    };
  }

  async function boot(){
    renderButton();
    if(!(await waitForUser()))return;

    await refreshAttention();

    const params=new URLSearchParams(location.search);
    const target=params.get('open');
    if(target){
      history.replaceState({},document.title,location.pathname+location.hash);
      await openTarget(target);
    }

    clearInterval(P.refreshTimer);
    P.refreshTimer=setInterval(refreshAttention,60000);
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')refreshAttention();
  });

  window.addEventListener('focus',refreshAttention);
  window.addEventListener('load',()=>setTimeout(boot,250));
  setTimeout(boot,900);
})();