// Add order date + order aging indicators to every Sales Tracking invoice card.
(function(){
  const ui=window.trackingRedesign;
  if(!ui||typeof window.renderSalesTrackingBody!=='function')return;

  const baseRender=window.renderSalesTrackingBody;

  function parseLocalDate(v){
    if(!v)return null;
    const s=String(v).slice(0,10);
    const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m)return null;
    const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    return Number.isNaN(d.getTime())?null:d;
  }

  function formatDate(v){
    const d=parseLocalDate(v);
    if(!d)return 'No order date';
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  }

  function ageDays(v){
    const d=parseLocalDate(v);
    if(!d)return null;
    const now=new Date();
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    return Math.floor((today-d)/86400000);
  }

  function ageStyle(days){
    if(days==null)return 'bg-gray-50 text-gray-500 border-gray-200';
    if(days<0)return 'bg-blue-50 text-blue-700 border-blue-200';
    if(days<=30)return 'bg-green-50 text-green-700 border-green-200';
    if(days<=60)return 'bg-amber-50 text-amber-700 border-amber-200';
    if(days<=90)return 'bg-orange-50 text-orange-700 border-orange-200';
    return 'bg-red-50 text-red-600 border-red-200';
  }

  function ageLabel(days){
    if(days==null)return 'Age unavailable';
    if(days<0)return `Starts in ${Math.abs(days)} day${Math.abs(days)===1?'':'s'}`;
    if(days===0)return 'Age: Today';
    return `Age: ${days} day${days===1?'':'s'}`;
  }

  function decorate(){
    const root=document.getElementById('salesTrackingRoot');
    if(!root)return;

    for(const o of (ui.salesOrders||[])){
      const trigger=root.querySelector(`button[onclick="toggleSalesInvoice('${o.id}')"]`);
      const card=trigger?.closest('.lr-order-card');
      if(!card)continue;

      card.querySelector('.lr-order-aging')?.remove();

      const left=card.querySelector('.lr-order-main > div:first-child');
      if(!left)continue;

      const days=ageDays(o.order_date);
      const wrap=document.createElement('div');
      wrap.className='lr-order-aging flex flex-wrap items-center gap-2 mt-2';
      wrap.innerHTML=`
        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-gray-50 border-gray-200 text-gray-600 text-[10px] font-semibold" title="Order date">
          <span aria-hidden="true">◷</span> Ordered: ${esc(formatDate(o.order_date))}
        </span>
        <span class="inline-flex items-center px-2 py-1 rounded-md border text-[10px] font-bold ${ageStyle(days)}" title="Days since the order date">
          ${esc(ageLabel(days))}
        </span>`;
      left.appendChild(wrap);
    }
  }

  window.renderSalesTrackingBody=function(){
    const out=baseRender.apply(this,arguments);
    decorate();
    return out;
  };

  // If Sales Tracking is already open when this script loads.
  setTimeout(decorate,100);
})();
