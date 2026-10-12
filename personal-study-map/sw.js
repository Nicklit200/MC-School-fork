/* Mindcrafti personal study reminders. No content cache: always load fresh cards. */
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("push",event=>{
  let data={};
  try {data=event.data?.json()||{};}catch{data={body:event.data?.text()||""};}
  const title=typeof data.title==="string"?data.title:"Мои навыки · Повторение";
  const body=typeof data.body==="string"?data.body:"Время повторить карточки.";
  const url=typeof data.url==="string"?data.url:"/#cards";
  event.waitUntil(self.registration.showNotification(title,{
    body,icon:"/study-icon.svg",badge:"/study-icon.svg",
    tag:"study-review-morning",renotify:false,
    data:{url}
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  let target=new URL("/#cards",self.location.origin);
  try{
    const requested=new URL(event.notification.data?.url||"/#cards",self.location.origin);
    if(requested.origin===self.location.origin) target=requested;
  }catch{}
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(async windows=>{
    const windowClient=windows.find(client=>client.url.startsWith(self.location.origin));
    if(windowClient){
      await windowClient.focus();
      if(windowClient.navigate) return windowClient.navigate(target.href);
    }
    return self.clients.openWindow(target.href);
  }));
});
