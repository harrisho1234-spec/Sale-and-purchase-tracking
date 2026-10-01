// Free PWA push notifications + app attention badge.
(function(){
  const P={
    attention:null,
    key:null,
    registration:null,
    refreshTimer:null,
    openingTarget:false
  };

  function readyUser(){
    return !!(window.state&&state.user&&state.user.id&&window.db);
  }

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
      const {data,error}=await db.rpc('get_my_app_attention');
      if(error)throw error;
      P.attention=data||{count:0,target:'dashboard',body:'No action items'};
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

  window.refreshAppNotifications=refreshAttention;

  window.openAppNotifications=async function(){
    await refreshAttention();
    const count=attentionCount();
    const supported=('Notification' in window)&&('serviceWorker' in navigator)&&('PushManager' in window);

    // In-app attention works even when browser/OS push is unavailable or blocked.
    if(!supported){
      if(count>0)return openTarget(P.attention.target||'dashboard');
      return toast('No action items right now. Browser push is not supported on this browser.');
    }

    if(Notification.permission==='denied'){
      if(count>0){
        toast('Browser notifications are blocked, but your in-app requests are still available.');
        return openTarget(P.attention.target||'dashboard');
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
      if(attentionCount()>0)return openTarget(P.attention.target||'dashboard');
      return;
    }

    if(count>0){
      await openTarget(P.attention.target||'dashboard');
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