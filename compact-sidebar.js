// Compact grouped sidebar navigation.
(function(){
  var storageKey='limperial_sidebar_groups_v1';
  var groupDefs=[
    {key:'sales',label:'Sales & Customers',icon:'▤',ids:['customers','showroom-visit','online','sales-orders','tracking','rep-workspace']},
    {key:'finance',label:'Finance & Control',icon:'$',ids:['approvals','payments','returns']},
    {key:'operations',label:'Products & Procurement',icon:'◇',ids:['products','procurement','supplier-pos']},
    {key:'management',label:'Management',icon:'▥',ids:['sales-access','users']}
  ];

  function readState(){
    try{return JSON.parse(sessionStorage.getItem(storageKey)||'{}')||{}}
    catch(_){return {}}
  }
  function writeState(v){
    try{sessionStorage.setItem(storageKey,JSON.stringify(v))}catch(_){}
  }
  function groupForPage(page){
    var g=groupDefs.find(function(x){return x.ids.indexOf(page)>=0});
    return g?g.key:null;
  }
  function currentOpenMap(){
    var saved=readState();
    var active=groupForPage(state.page);
    var map={
      sales:saved.sales!==false,
      finance:!!saved.finance,
      operations:!!saved.operations,
      management:!!saved.management
    };
    if(active)map[active]=true;
    return map;
  }

  window.toggleSidebarGroup=function(key){
    var saved=readState();
    var panel=document.getElementById('sidebar-group-'+key);
    var chevron=document.getElementById('sidebar-chevron-'+key);
    var opening=panel?panel.classList.contains('hidden'):false;
    if(panel)panel.classList.toggle('hidden',!opening);
    if(chevron)chevron.textContent=opening?'⌄':'›';
    saved[key]=opening;
    writeState(saved);
  };

  function approvalBadge(id){
    return id==='approvals'
      ? '<span class="approval-count-badge ml-auto min-w-[20px] h-[20px] px-1.5 rounded-full bg-red-500 text-white text-[9px] font-bold items-center justify-center" style="display:none"></span>'
      : '';
  }

  function navButton(item){
    var id=item[0],label=item[1],icon=item[2]||'·';
    var active=state.page===id;
    return '<button onclick="go(\''+id+'\')" class="sidebar-btn '+(active?'active ':'')+'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] '+(active?'font-semibold':'text-gray-600')+' hover:bg-gray-100">'
      +'<span class="nav-icon w-4 text-center text-[12px]">'+icon+'</span>'
      +'<span class="truncate">'+label+'</span>'
      +approvalBadge(id)
      +'</button>';
  }

  function sectionHtml(group,items,open){
    if(!items.length)return '';
    return '<div class="sidebar-group">'
      +'<button type="button" onclick="toggleSidebarGroup(\''+group.key+'\')" class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[10px] uppercase tracking-[.08em] font-bold text-gray-400 hover:bg-gray-50">'
      +'<span class="w-4 text-center text-[11px]">'+group.icon+'</span>'
      + '<span class="flex-1 text-left">'+group.label+'</span>'
      +(group.key==='finance'?'<span id="sidebar-finance-approval-badge" class="min-w-[19px] h-[19px] px-1 rounded-full bg-red-500 text-white text-[9px] items-center justify-center" style="display:none"></span>':'')
      +'<span id="sidebar-chevron-'+group.key+'" class="text-gray-400 text-sm">'+(open?'⌄':'›')+'</span>'
      +'</button>'
      +'<div id="sidebar-group-'+group.key+'" class="'+(open?'':'hidden ')+'ml-2 pl-2 border-l border-gray-100 space-y-0.5">'
      +items.map(navButton).join('')
      +'</div></div>';
  }

  function renderMobile(items){
    var root=document.getElementById('mobileNav');
    if(!root)return;
    var byId=new Map(items.map(function(x){return [x[0],x]}));
    var used=new Set(['dashboard','reports']);
    var html='<div class="space-y-3">';
    var dashboard=byId.get('dashboard');
    if(dashboard){
      html+='<button onclick="go(\'dashboard\');document.getElementById(\'mobileNav\').classList.add(\'hidden\')" class="w-full text-left px-3 py-2.5 border rounded-lg text-xs font-semibold">Dashboard</button>';
    }
    groupDefs.forEach(function(g){
      var groupItems=g.ids.map(function(id){return byId.get(id)}).filter(Boolean);
      groupItems.forEach(function(x){used.add(x[0])});
      if(!groupItems.length)return;
      html+='<div><div class="px-1 mb-1 text-[9px] uppercase tracking-wide font-bold text-gray-400">'+g.label+'</div><div class="grid grid-cols-2 gap-2">';
      html+=groupItems.map(function(x){
        return '<button onclick="go(\''+x[0]+'\');document.getElementById(\'mobileNav\').classList.add(\'hidden\')" class="text-left px-3 py-2 border rounded-lg text-xs">'+x[1]+'</button>';
      }).join('');
      html+='</div></div>';
    });
    var reportItem=byId.get('reports');
    if(reportItem){
      html+='<div><div class="px-1 mb-1 text-[9px] uppercase tracking-wide font-bold text-gray-400">Report</div><button onclick="go(\'reports\');document.getElementById(\'mobileNav\').classList.add(\'hidden\')" class="w-full text-left px-3 py-2.5 border rounded-lg text-xs font-semibold">'+reportItem[1]+'</button></div>';
    }
    var extra=items.filter(function(x){return !used.has(x[0])});
    if(extra.length){
      html+='<div><div class="px-1 mb-1 text-[9px] uppercase tracking-wide font-bold text-gray-400">More</div><div class="grid grid-cols-2 gap-2">';
      html+=extra.map(function(x){
        return '<button onclick="go(\''+x[0]+'\');document.getElementById(\'mobileNav\').classList.add(\'hidden\')" class="text-left px-3 py-2 border rounded-lg text-xs">'+x[1]+'</button>';
      }).join('');
      html+='</div></div>';
    }
    html+='</div>';
    root.innerHTML=html;
  }

  window.renderNav=function(){
    var items=(typeof navItems==='function'?navItems():[])||[];
    var byId=new Map(items.map(function(x){return [x[0],x]}));
    var used=new Set();
    var openMap=currentOpenMap();
    var parts=[];

    var dashboard=byId.get('dashboard');
    if(dashboard){
      used.add('dashboard');
      parts.push('<div class="mb-1">'+navButton(dashboard)+'</div>');
    }

    groupDefs.forEach(function(g){
      var groupItems=g.ids.map(function(id){return byId.get(id)}).filter(Boolean);
      groupItems.forEach(function(x){used.add(x[0])});
      if(groupItems.length)parts.push(sectionHtml(g,groupItems,openMap[g.key]));
    });

    var reportItem=byId.get('reports');
    if(reportItem){
      used.add('reports');
      parts.push('<div class="mt-2 pt-2 border-t border-gray-100">'+navButton(reportItem)+'</div>');
    }

    var extra=items.filter(function(x){return !used.has(x[0])});
    if(extra.length){
      var saved=readState();
      var activeExtra=extra.some(function(x){return x[0]===state.page});
      parts.push(sectionHtml({key:'more',label:'More',icon:'⋯'},extra,activeExtra||!!saved.more));
    }

    var root=document.getElementById('sidebarNav');
    if(root){
      root.innerHTML='<div class="space-y-1">'+parts.join('')+'</div>';
      root.classList.add('text-sm');
    }
    renderMobile(items);

    if(typeof refreshApprovalNotifications==='function'&&['manager','admin','super_admin'].indexOf(state.profile&&state.profile.role||'')>=0){
      setTimeout(function(){refreshApprovalNotifications()},20);
    }
  };

  try{if(state&&state.profile)renderNav()}catch(_){}
})();