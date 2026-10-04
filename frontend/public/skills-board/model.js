export const colors={orange:"#ef7946",blue:"#648bd3",violet:"#9980cf",teal:"#55a7a7",green:"#81a46c"};
export const kindLabels={root:"ПРОГРАММА",topic:"РАЗДЕЛ",skill:"НАВЫК",note:"ЗАМЕТКА"};
export const clone=value=>JSON.parse(JSON.stringify(value));
export function descendants(data,id){
  const seen=new Set(),queue=[id];
  while(queue.length){const current=queue.shift();for(const e of data.edges){if(e.kind==="contains"&&e.source===current&&!seen.has(e.target)){seen.add(e.target);queue.push(e.target)}}}
  return seen;
}
export function validateBoard(data){
  if(!data||data.schemaVersion!==1||!Array.isArray(data.nodes)||!Array.isArray(data.edges))throw Error("Неверная структура карты");
  if(!data.title?.trim()||data.title.length>200||!Number.isInteger(data.grade)||data.grade<1||data.grade>13)throw Error("Проверьте название и класс");
  if(data.nodes.length>1000||data.edges.length>3000)throw Error("Лимит: 1000 карточек и 3000 связей");
  const ids=new Set(),edgeIds=new Set(),pairs=new Set(),parents=new Set();
  const idOk=id=>typeof id==="string"&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
  for(const n of data.nodes){
    if(!n||!idOk(n.id)||ids.has(n.id))throw Error("Неверный или повторяющийся ID карточки");
    ids.add(n.id);
    if(!Object.hasOwn(kindLabels,n.kind)||!Object.hasOwn(colors,n.color))throw Error("Неверный тип или цвет карточки");
    if(typeof n.title!=="string"||!n.title.trim()||n.title.length>200)throw Error("Введите название до 200 символов");
    for(const key of ["de","description","example","source"])if(n[key]!=null&&(typeof n[key]!=="string"||n[key].length>(key==="de"?300:4000)))throw Error("Слишком длинный текст");
    if(n.core!=null&&typeof n.core!=="boolean")throw Error("Неверная метка CORE");
    const allowedSchoolTypes=new Set(["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE","GESAMTSCHULE","WERKREALSCHULE","OTHER"]);
    if(n.schoolTypes!=null&&(!Array.isArray(n.schoolTypes)||n.schoolTypes.some(type=>!allowedSchoolTypes.has(type))))throw Error("Неверная школьная программа");
    if(!Number.isFinite(n.x)||!Number.isFinite(n.y)||Math.abs(n.x)>100000||Math.abs(n.y)>100000)throw Error("Недопустимые координаты");
  }
  for(const e of data.edges){
    if(!e||!idOk(e.id)||edgeIds.has(e.id))throw Error("Неверный или повторяющийся ID связи");
    edgeIds.add(e.id);
    if(!ids.has(e.source)||!ids.has(e.target)||e.source===e.target)throw Error("Выберите две разные существующие карточки");
    if(!["contains","prerequisite"].includes(e.kind))throw Error("Неизвестный тип связи");
    const pair=[e.kind,e.source,e.target].join("|");
    if(pairs.has(pair))throw Error("Такая связь уже существует");pairs.add(pair);
    if(e.kind==="contains"){if(parents.has(e.target))throw Error("Родитель уже задан. Измените раздел в свойствах карточки");parents.add(e.target);}
  }
  for(const kind of ["contains","prerequisite"]){
    const incoming=new Map([...ids].map(id=>[id,0])),outgoing=new Map();
    for(const e of data.edges)if(e.kind===kind){incoming.set(e.target,incoming.get(e.target)+1);outgoing.set(e.source,[...(outgoing.get(e.source)||[]),e.target]);}
    const queue=[...ids].filter(id=>incoming.get(id)===0);let visited=0;
    while(queue.length){const id=queue.shift();visited++;for(const next of outgoing.get(id)||[]){incoming.set(next,incoming.get(next)-1);if(incoming.get(next)===0)queue.push(next);}}
    if(visited!==ids.size)throw Error("Получился цикл. Проверьте направление стрелки");
  }
  return true;
}
