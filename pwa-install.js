// Android/Desktop PWA install helper.
(function(){
  let deferredPrompt=null;

  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone===true;
  }

  function button(){
    return document.getElementById('pwaInstallBtn');
  }

  function ensureButton(){
    if(isStandalone())return null;
    if(button())return button();

    const passwordBtn=document.querySelector('button[onclick="openChangeMyPassword()"]');
    if(!passwordBtn||!passwordBtn.parentElement)return null;

    const b=document.createElement('button');
    b.id='pwaInstallBtn';
    b.type='button';
    b.className='hidden inline-flex px-3 py-2 rounded-lg border border-[#d8b04d] bg-[#fffaf0] text-[#8b6914] text-xs font-semibold whitespace-nowrap';
    b.textContent='Install App';
    b.title="Install L'Imperial Order Management";
    b.onclick=window.installLimperialApp;
    passwordBtn.parentElement.insertBefore(b,passwordBtn);
    return b;
  }

  function render(){
    const b=ensureButton();
    if(!b)return;
    if(isStandalone()){
      b.remove();
      return;
    }
    b.classList.toggle('hidden',!deferredPrompt);
  }

  window.installLimperialApp=async function(){
    if(isStandalone())return;

    if(!deferredPrompt){
      if(typeof showToast==='function'){
        showToast('In Chrome, open ⋮ → Install app. If an older broken install is shown, refresh this page once and try again.','err');
      }
      return;
    }

    const prompt=deferredPrompt;
    deferredPrompt=null;
    prompt.prompt();
    try{await prompt.userChoice}catch(_){}
    render();
  };

  window.addEventListener('beforeinstallprompt',function(e){
    e.preventDefault();
    deferredPrompt=e;
    render();
  });

  window.addEventListener('appinstalled',function(){
    deferredPrompt=null;
    render();
    if(typeof showToast==='function')showToast("L'Imperial Order Management installed.");
  });

  window.addEventListener('load',function(){
    ensureButton();
    render();
  });

  setTimeout(function(){ensureButton();render()},1200);
})();