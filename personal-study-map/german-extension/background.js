const API = "https://personal-life-api-production.up.railway.app/api/german-words";
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({id:"add-german-word",title:"Добавить «%s» в немецкий словарь",contexts:["selection"]});
});
chrome.contextMenus.onClicked.addListener(async info => {
  if(info.menuItemId!=="add-german-word")return;
  const word=String(info.selectionText||"").trim().slice(0,160);
  if(!word)return;
  try{
    const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({word,sourceUrl:info.pageUrl||""})});
    if(!res.ok)throw Error("HTTP "+res.status);
    console.log("Saved to German vocabulary:",word);
  }catch(error){console.error("Could not save German word:",error);}
});
