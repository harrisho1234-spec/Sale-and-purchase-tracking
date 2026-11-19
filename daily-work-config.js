// L'Imperial cross-department daily-work taxonomy.
// This is a presentation-only, shared library: it never changes permissions,
// Google Sheets records, or the existing daily-report API contract.
(function(){
'use strict';
const DEPARTMENTS={
 Sales:{name:'Sales',categories:['Customer Follow-up','Showroom / Page','Online Inquiries','Product Content','Quotation / SR','Other'],examples:['Follow up customer and record outcome','Prepare quotation or sales order','Coordinate showroom / online inquiry','Request project mock-up or proposal']},
 Marketing:{name:'Marketing',categories:['Artwork / Poster','Video','Photo','Content Writing','Social Media','Promotion','Event','Catalog','Other'],examples:['Prepare campaign artwork','Shoot or edit product media','Publish planned social content','Support Sales with presentation materials']},
 Stock:{name:'Stock',categories:['Stock Receiving','Stock Count','Stock Transfer','Delivery Preparation','DO Release','Stock Adjustment','Other'],examples:['Receive and check incoming items','Prepare delivery order','Verify stock and location','Investigate stock discrepancy']},
 Project:{name:'Project',categories:['Mock-up','Proposal','3D Rendering','Drawing Revision','Site Measurement','Installation Coordination','Other'],examples:['Prepare mock-up requested by Sales','Revise project proposal','Complete site measurement','Return approved drawings to Sales']},
 'Product Assistant':{name:'Product Assistant',categories:['Product Code Verification','Catalog Update','Product Photo','Price Verification','Product Selection','Quotation Support','Other'],examples:['Verify codes with supplier catalog','Update a product photograph','Check dimensions or finishes','Support Sales with product information']}
};
function options(department,selected){
 const d=DEPARTMENTS[department]||DEPARTMENTS.Sales;
 const list=[...d.categories];
 if(selected&&!list.includes(selected))list.push(selected);
 return list;
}
function suggestions(department){return [...(DEPARTMENTS[department]?.examples||[])];}
function profiles(){return Object.keys(DEPARTMENTS);}
window.LIDailyWorkConfig=Object.freeze({DEPARTMENTS,options,suggestions,profiles});
})();
