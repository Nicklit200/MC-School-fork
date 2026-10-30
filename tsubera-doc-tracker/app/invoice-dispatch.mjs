import {normalizeDocumentsReceivedDate,berlinCivilDate} from './payment-deadline.mjs';

export const dispatchFields={
  statusDate:'status_date',statusUpdatedAt:'status_updated_at',invoiceSentVia:'invoice_sent_via',
  invoiceEmailSentDate:'invoice_email_sent_date',invoicePostSentDate:'invoice_post_sent_date',
  invoiceEmailUrl:'invoice_email_url',invoiceRecipientEmail:'invoice_recipient_email',
  invoicePostalTracking:'invoice_postal_tracking',invoicePostalTrackingUrl:'invoice_postal_tracking_url',invoiceDispatchNote:'invoice_dispatch_note'
};
export const invoiceSendMethods=['','email','post','email_and_post'];
const error=message=>Object.assign(new Error(message),{status:400});
export function normalizeDispatchUrl(value){
  if(value==null||value==='')return '';
  if(typeof value!=='string'||value.length>2048||/[\u0000-\u001f\u007f]/.test(value))throw error('Ссылка должна быть HTTPS-адресом длиной до 2048 символов');
  let url;try{url=new URL(value.trim());}catch{throw error('Некорректная ссылка');}
  if(url.protocol!=='https:'||url.username||url.password||!url.hostname)throw error('Нужна HTTPS-ссылка без имени пользователя и пароля');
  return url.toString();
}
function optionalText(value,max,label){
  if(value==null)return '';
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw error(label+': недопустимый текст или превышена длина '+max);
  return value.trim();
}
export function normalizeInvoiceDispatch(old={},changes={},clock=new Date()){
  const next={};
  for(const key of Object.keys(dispatchFields))next[key]=old[key]||'';
  if(changes.invoiceSentVia!==undefined){
    if(!invoiceSendMethods.includes(changes.invoiceSentVia))throw error('Способ отправки: email, post, email_and_post или пусто');
    next.invoiceSentVia=changes.invoiceSentVia;
  }
  for(const key of ['invoiceEmailSentDate','invoicePostSentDate'])if(changes[key]!==undefined)next[key]=normalizeDocumentsReceivedDate(changes[key]);
  for(const key of ['invoiceEmailUrl','invoicePostalTrackingUrl'])if(changes[key]!==undefined)next[key]=normalizeDispatchUrl(changes[key]);
  for(const key of ['invoiceRecipientEmail','invoicePostalTracking','invoiceDispatchNote'])if(changes[key]!==undefined)next[key]=optionalText(changes[key],key==='invoiceDispatchNote'?4000:500,key);
  if(changes.invoiceSentVia!==undefined){
    if(!['email','email_and_post'].includes(next.invoiceSentVia))next.invoiceEmailSentDate='';
    if(!['post','email_and_post'].includes(next.invoiceSentVia))next.invoicePostSentDate='';
  }
  const explicitStatus=changes.statusOverride!==undefined;
  const changedStatus=explicitStatus&&changes.statusOverride!==(old.statusOverride||'');
  if(changes.statusDate!==undefined)next.statusDate=normalizeDocumentsReceivedDate(changes.statusDate);
  else if(changedStatus)next.statusDate=changes.statusOverride==='documents_received'?(changes.documentsReceivedDate||''):changes.statusOverride?berlinCivilDate(clock):'';
  if(changedStatus||next.statusDate!==(old.statusDate||''))next.statusUpdatedAt=clock.toISOString();
  return next;
}
export function dispatchFromMcp(args){
  const result={};
  for(const [camel,snake] of Object.entries(dispatchFields))if(camel!=='statusUpdatedAt'&&Object.hasOwn(args,snake))result[camel]=args[snake];
  return result;
}
export const dispatchMcpProperties={
  status_date:{type:'string',description:'Effective date of the current status, YYYY-MM-DD; empty means unknown. Changes default to today, or confirmed receipt date for documents_received.'},
  invoice_sent_via:{type:'string',enum:invoiceSendMethods,description:'Actual invoice dispatch method; does not send mail or infer a date.'},
  invoice_email_sent_date:{type:'string',description:'Actual email dispatch date YYYY-MM-DD, or empty if unknown.'},
  invoice_post_sent_date:{type:'string',description:'Actual paper post dispatch date YYYY-MM-DD, or empty if unknown.'},
  invoice_email_url:{type:'string',maxLength:2048,description:'HTTPS link to the actual email message, or empty.'},
  invoice_recipient_email:{type:'string',maxLength:500},
  invoice_postal_tracking:{type:'string',maxLength:500},
  invoice_postal_tracking_url:{type:'string',maxLength:2048,description:'HTTPS tracking link, or empty.'},
  invoice_dispatch_note:{type:'string',maxLength:4000}
};
