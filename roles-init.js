// Ensure role-aware navigation is refreshed even if app.js boot completed before the role override loaded.
(function(){
  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    try{
      if(typeof state!=='undefined'&&state.profile){
        renderNav();
        clearInterval(timer);
      }else if(tries>50){
        clearInterval(timer);
      }
    }catch(_){
      if(tries>50)clearInterval(timer);
    }
  },100);
})();
