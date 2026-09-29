(function(){
  function n(v){return Number(v||0)}
  function periodKey(v){return String(v||'').slice(0,7)+'-01'}
  function periodEnd(v){const d=new Date(periodKey(v)+'T00:00:00');return new Date(d.getFullYear(),d.getMonth()+1,0)}
  function titleDate(v){return periodEnd(v).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'})}

  window.exportStockCountSummaryExcel=async function(periodMonth){
    if(typeof ExcelJS==='undefined')return showToast('Excel report library is still loading. Refresh once and try again.','err');
    try{
      const period=periodKey(periodMonth);
      const cached=window._stockCountSummaryReport;
      const data=cached&&cached.period===period?cached:await window.loadStockCountReportData(period);
      const counted=new Set(data.counts.map(x=>x.stock_locations?.code).filter(Boolean));
      const showSystem=!!window.stockCountReportShowSystem;
      const wb=new ExcelJS.Workbook();
      wb.creator="L'Imperial Stock & Inventory";
      wb.created=new Date();
      const ws=wb.addWorksheet('Stock Count');
      const dt=titleDate(period);

      const baseHeaders=['Items Code','Items Name','U/M','Category','Brand'];
      const systemHeaders=['Stock Opening','Stock In','Stock Out','Stock Ending on '+dt,'QB','Old Stock'];
      const tailHeaders=showSystem?['Total','Compare','Remark']:['Total','Remark'];
      const headers=[...baseHeaders,...(showSystem?systemHeaders:[]),...data.locations.map(l=>l.code),...tailHeaders];
      const last=headers.length;

      ws.mergeCells(1,1,1,last);
      ws.getCell(1,1).value='Stock Count on '+dt+' (ALL)';
      ws.getCell(1,1).font={size:13,color:{argb:'FFFF0000'}};
      ws.getCell(1,1).alignment={horizontal:'left',vertical:'middle'};
      ws.getRow(1).height=24;

      if(!showSystem){
        ws.mergeCells(2,1,2,last);
        ws.getCell(2,1).value='Physical Count by Location — System / Reconciliation columns hidden';
        ws.getCell(2,1).font={italic:true,size:9,color:{argb:'FF666666'}};
        ws.getCell(2,1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F2F2'}};
      }

      const headerRowNo=showSystem?2:3;
      const hr=ws.getRow(headerRowNo);hr.values=headers;hr.height=42;
      hr.eachCell(cell=>{
        cell.font={size:9,color:{argb:'FF000000'}};
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};
        cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};
        cell.border={top:{style:'thin',color:{argb:'FF000000'}},left:{style:'thin',color:{argb:'FF000000'}},bottom:{style:'thin',color:{argb:'FF000000'}},right:{style:'thin',color:{argb:'FF000000'}}};
      });

      const locStart=showSystem?12:6;
      const locEnd=locStart+data.locations.length-1;
      const totalCol=locEnd+1;
      const compareCol=showSystem?totalCol+1:null;
      const remarkCol=showSystem?totalCol+2:totalCol+1;
      let rn=headerRowNo+1;

      for(const r of data.rows){
        const lc=r.location_counts||{};
        const values=[
          r.code||'',r.item_name||'',r.uom||'Pcs',r.category||'',r.brand||'',
          ...(showSystem?[n(r.stock_opening),n(r.stock_in),n(r.stock_out),n(r.stock_ending),r.qb_qty==null?null:n(r.qb_qty),r.old_stock==null?null:n(r.old_stock)]:[]),
          ...data.locations.map(l=>Object.prototype.hasOwnProperty.call(lc,l.code)&&lc[l.code]!=null?n(lc[l.code]):null),
          null,
          ...(showSystem?[null]:[]),
          r.remark||''
        ];
        const row=ws.addRow(values);
        row.getCell(totalCol).value={formula:'SUM('+ws.getCell(rn,locStart).address+':'+ws.getCell(rn,locEnd).address+')',result:n(r.total_counted)};
        if(showSystem){
          row.getCell(compareCol).value={formula:ws.getCell(rn,totalCol).address+'-'+ws.getCell(rn,9).address,result:n(r.compare_qty)};
        }
        row.eachCell((cell,col)=>{
          cell.font={size:8.5};
          cell.alignment={vertical:'middle',wrapText:col===2||col===remarkCol};
          cell.border={top:{style:'thin',color:{argb:'FF808080'}},left:{style:'thin',color:{argb:'FF808080'}},bottom:{style:'thin',color:{argb:'FF808080'}},right:{style:'thin',color:{argb:'FF808080'}}};
          if(col>=locStart&&col<=totalCol)cell.numFmt='#,##0.##';
          if(showSystem&&col>=6&&col<=compareCol)cell.numFmt='#,##0.##';
        });
        data.locations.forEach((l,idx)=>{
          if(!counted.has(l.code))row.getCell(locStart+idx).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F2F2'}};
        });
        if(showSystem&&n(r.compare_qty)!==0)row.getCell(compareCol).font={size:8.5,bold:true,color:{argb:'FFFF0000'}};
        rn++;
      }

      ws.views=[{state:'frozen',ySplit:headerRowNo,xSplit:2}];
      ws.autoFilter={from:{row:headerRowNo,column:1},to:{row:headerRowNo,column:last}};
      ws.getColumn(1).width=27;ws.getColumn(2).width=48;ws.getColumn(3).width=8;ws.getColumn(4).width=14;ws.getColumn(5).width=18;
      if(showSystem)[6,7,8,9,10,11].forEach(i=>ws.getColumn(i).width=11);
      data.locations.forEach((_,idx)=>ws.getColumn(locStart+idx).width=7);
      ws.getColumn(totalCol).width=10;
      if(showSystem)ws.getColumn(compareCol).width=10;
      ws.getColumn(remarkCol).width=34;
      ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,paperSize:9,margins:{left:0.2,right:0.2,top:0.4,bottom:0.4,header:0.2,footer:0.2}};
      ws.headerFooter={oddFooter:'&LLocations counted: '+counted.size+'/'+data.locations.length+'&RPage &P of &N'};

      const buffer=await wb.xlsx.writeBuffer();
      const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='Stock_Count_'+period.slice(0,7)+'_ALL'+(showSystem?'_Reconciliation':'')+'.xlsx';
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
      showToast(showSystem?'ALL-location Stock Count reconciliation report exported.':'ALL-location physical Stock Count report exported.');
    }catch(err){showToast(err.message,'err')}
  };
})();