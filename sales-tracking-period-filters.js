// Sales Tracking calendar periods. Filters use the order date, not payment or invoice issue dates.
(function () {
  const ui=window.trackingRedesign;
  if(!ui)return;

  const now=new Date();
  const period={
    mode:'all',
    year:now.getFullYear(),
    months:new Set([now.getMonth()+1]),
    quarters:new Set([Math.floor(now.getMonth()/3)+1]),
    menuOpen:false
  };
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function parsedDate(value){
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if(!m)return null;
    const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
    if(month<1||month>12||day<1||day>31)return null;
    return {year,month,quarter:Math.floor((month-1)/3)+1};
  }
  function selectedPeriods(){
    return period.mode==='month'?period.months:period.quarters;
  }
  function periodValues(){
    return period.mode==='month'?monthNames.map((name,i)=>({value:i+1,label:name})):
      [1,2,3,4].map(i=>({value:i,label:'Q'+i}));
  }
  function periodLabel(){
    const values=selectedPeriods();
    const type=period.mode==='month'?'Months':'Quarters';
    if(values===null)return 'All '+type;
    if(values.size===0)return 'No '+type;
    const labels=[...values].sort((a,b)=>a-b).map(v=>period.mode==='month'?monthNames[v-1]:'Q'+v);
    return labels.length<=3?labels.join(', '):labels.length+' '+type;
  }
  function availableYears(){
    const current=new Date().getFullYear();
    const years=new Set([period.year]);
    for(let y=Math.max(2000,current-5);y<=Math.min(2100,current+1);y++)years.add(y);
    (ui.salesOrders||[]).forEach(o=>{
      const d=parsedDate(o.order_date);
      if(d&&d.year>=2000&&d.year<=2100)years.add(d.year);
    });
    return [...years].sort((a,b)=>b-a);
  }
  function refresh(){window.renderSalesTrackingBody?.();}

  window.salesTrackingPeriodMatch=function(dateValue){
    if(period.mode==='all')return true;
    const date=parsedDate(dateValue);
    if(!date||date.year!==period.year)return false;
    if(period.mode==='year')return true;
    const values=selectedPeriods();
    return values===null || values.has(period.mode==='month'?date.month:date.quarter);
  };
  // Called by the original quick-date selector so the two date controls never conflict.
  window.salesTrackingPeriodReset=function(){
    period.mode='all';
    period.menuOpen=false;
  };
  window.setSalesTrackingPeriodMode=function(value){
    if(!['all','month','quarter','year'].includes(value))return;
    period.mode=value;
    period.menuOpen=false;
    ui.salesDate='all';
    refresh();
  };
  window.setSalesTrackingPeriodYear=function(value){
    const year=Number(value);
    if(!Number.isInteger(year)||year<2000||year>2100)return;
    period.year=year;
    refresh();
  };
  window.toggleSalesTrackingPeriodMenu=function(){
    period.menuOpen=!period.menuOpen;
    refresh();
  };
  window.setSalesTrackingPeriodAll=function(checked){
    if(period.mode==='month')period.months=checked?null:new Set();
    else if(period.mode==='quarter')period.quarters=checked?null:new Set();
    refresh();
  };
  window.setSalesTrackingPeriodItem=function(value,checked){
    value=Number(value);
    const count=period.mode==='month'?12:4;
    if(!Number.isInteger(value)||value<1||value>count)return;
    const previous=selectedPeriods();
    const selected=previous===null?new Set(Array.from({length:count},(_,i)=>i+1)):new Set(previous);
    if(checked)selected.add(value);
    else selected.delete(value);
    const result=selected.size===count?null:selected;
    if(period.mode==='month')period.months=result;
    else if(period.mode==='quarter')period.quarters=result;
    refresh();
  };
  window.clearSalesTrackingPeriod=function(){
    period.mode='all';
    period.menuOpen=false;
    ui.salesDate='all';
    refresh();
  };

  window.salesTrackingPeriodControls=function(){
    const mode=period.mode;
    const allModes=[['all','No calendar period'],['month','By Month'],['quarter','By Quarter'],['year','By Year']];
    const yearSelect=mode==='all'?'':`<label class="flex items-center gap-2 text-xs text-gray-600">
      Year
      <select class="lr-select !w-auto min-w-[92px]" aria-label="Sales tracking year" onchange="setSalesTrackingPeriodYear(this.value)">
        ${availableYears().map(y=>`<option value="${y}" ${y===period.year?'selected':''}>${y}</option>`).join('')}
      </select>
    </label>`;
    const showPicker=mode==='month'||mode==='quarter';
    const values=showPicker?periodValues():[];
    const selected=showPicker?selectedPeriods():null;
    const picker=!showPicker?'':`<div class="relative">
      <button type="button" class="lr-select !w-auto min-w-[145px] text-left" aria-expanded="${period.menuOpen?'true':'false'}" onclick="toggleSalesTrackingPeriodMenu()">${periodLabel()} <span aria-hidden="true">⌄</span></button>
      ${period.menuOpen?`<div class="absolute left-0 top-full mt-1 z-[70] w-[220px] max-h-[360px] overflow-y-auto bg-white border rounded-xl shadow-xl p-2">
        <label class="flex items-center gap-2 px-2 py-2 cursor-pointer text-xs font-semibold">
          <input type="checkbox" ${selected===null?'checked':''} onchange="setSalesTrackingPeriodAll(this.checked)"> All ${mode==='month'?'Months':'Quarters'}
        </label>
        <div class="border-t my-1"></div>
        ${values.map(x=>`<label class="flex items-center gap-2 px-2 py-2 cursor-pointer text-xs">
          <input type="checkbox" ${selected===null||selected.has(x.value)?'checked':''} onchange="setSalesTrackingPeriodItem(${x.value},this.checked)"> ${x.label}
        </label>`).join('')}
      </div>`:''}
    </div>`;
    return `<div class="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-xl border border-[#eee9e0] bg-[#faf9f6]">
      <label class="text-[11px] font-bold text-gray-600" for="salesTrackingPeriodMode">Calendar Filter</label>
      <select id="salesTrackingPeriodMode" class="lr-select !w-auto min-w-[162px]" onchange="setSalesTrackingPeriodMode(this.value)">
        ${allModes.map(([value,label])=>`<option value="${value}" ${value===mode?'selected':''}>${label}</option>`).join('')}
      </select>
      ${yearSelect}
      ${picker}
      ${mode==='all'?'':`<button type="button" class="text-xs underline text-gray-600 px-2" onclick="clearSalesTrackingPeriod()">Clear</button>`}
      <span class="text-[10px] text-gray-400">Uses Sales Order date</span>
    </div>`;
  };
})();