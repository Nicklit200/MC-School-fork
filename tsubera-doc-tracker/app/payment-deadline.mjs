// Payment terms are counted in calendar days from the confirmed receipt date.
const DAY_MS=86400000;
const berlinDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
function inputError(message){const error=new Error(message);error.status=400;return error;}
export function normalizePaymentTermDays(value){
  if(value===null||value==='')return null;
  if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>3650){
    throw inputError('Срок оплаты должен быть целым числом от 0 до 3650 дней или пустым');
  }
  return value;
}
export function normalizeDocumentsReceivedDate(value){
  if(value===null||value==='')return '';
  const text=typeof value==='string'?value.trim():'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||text<'1000-01-01'||!Number.isFinite(Date.parse(text+'T00:00:00.000Z'))||new Date(text+'T00:00:00.000Z').toISOString().slice(0,10)!==text){
    throw inputError('Дата получения документов должна быть действительной датой YYYY-MM-DD');
  }
  return text;
}
export function berlinCivilDate(clock=new Date()){
  const parts=Object.fromEntries(berlinDateFormatter.formatToParts(clock).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
export function paymentDeadline({documentsReceivedDate='',paymentTermDays=null,companyPaymentTermDays=null,statusOverride=''},clock=new Date()){
  const effectivePaymentTermDays=paymentTermDays??companyPaymentTermDays??null;
  if(!documentsReceivedDate||effectivePaymentTermDays===null){
    return {effectivePaymentTermDays,paymentDueDate:'',paymentDaysRemaining:null,paymentOverdue:false};
  }
  const receipt=Date.parse(documentsReceivedDate+'T00:00:00.000Z');
  const due=receipt+effectivePaymentTermDays*DAY_MS;
  if(!Number.isFinite(due)||due>Date.parse('9999-12-31T00:00:00.000Z')){
    throw inputError('Дата оплаты выходит за допустимый диапазон до 9999-12-31. Проверь дату получения и срок оплаты');
  }
  const paymentDueDate=new Date(due).toISOString().slice(0,10);
  const today=Date.parse(berlinCivilDate(clock)+'T00:00:00.000Z');
  const paymentDaysRemaining=Math.round((due-today)/DAY_MS);
  return {effectivePaymentTermDays,paymentDueDate,paymentDaysRemaining,paymentOverdue:statusOverride!=='payment_received'&&paymentDaysRemaining<0};
}
