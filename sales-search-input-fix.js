// Keep the Sales Tracking search input focused while results re-render.
// Also avoid interrupting Khmer/other IME composition while the user is typing.
(function(){
  const ui=window.trackingRedesign;
  if(!ui||typeof window.renderSalesTrackingBody!=='function')return;

  const selector='#salesTrackingRoot input[placeholder^="Search Invoice"]';
  let composing=false;

  function isSalesSearch(el){
    return !!(el&&el.matches&&el.matches(selector));
  }

  function renderAndRestore(value,caret){
    ui.salesSearch=String(value??'');
    window.renderSalesTrackingBody();
    requestAnimationFrame(()=>{
      const input=document.querySelector(selector);
      if(!input)return;
      input.focus({preventScroll:true});
      const pos=Math.max(0,Math.min(Number.isFinite(caret)?caret:input.value.length,input.value.length));
      try{input.setSelectionRange(pos,pos)}catch(_){/* text input should support this */}
    });
  }

  // Override the original function, which rebuilt the whole Sales Tracking panel
  // on every keypress and caused the newly-created input to lose focus.
  window.setSalesSearch=function(v){
    ui.salesSearch=String(v??'');
    const ev=window.event;
    if(composing||ev?.isComposing)return;
    const active=document.activeElement;
    const caret=isSalesSearch(active)?active.selectionStart:ui.salesSearch.length;
    renderAndRestore(ui.salesSearch,caret);
  };

  // Khmer, Chinese, Japanese and other IME keyboards emit composition events.
  // Do not rebuild the DOM until that composed character/word is committed.
  document.addEventListener('compositionstart',e=>{
    if(isSalesSearch(e.target))composing=true;
  },true);

  document.addEventListener('compositionend',e=>{
    if(!isSalesSearch(e.target))return;
    composing=false;
    const value=e.target.value;
    const caret=e.target.selectionStart??String(value||'').length;
    renderAndRestore(value,caret);
  },true);
})();
