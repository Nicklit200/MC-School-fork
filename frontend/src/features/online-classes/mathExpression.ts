/** Bounded mathematical grammar. No JavaScript evaluation, properties or assignments. */
export function compileMath(source:string,names:ReadonlySet<string>): (values:Record<string,number>)=>number {
  if(typeof source!=='string'||source.length<1||source.length>160) throw Error('Invalid expression');
  const tokens=source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-z][a-z0-9_]*|\S/g)??[];
  if(tokens.length>96) throw Error('Expression too complex');
  let pos=0;
  type Fn=(v:Record<string,number>)=>number;
  const unary:Record<string,(x:number)=>number>={sin:Math.sin,cos:Math.cos,tan:Math.tan,sqrt:Math.sqrt,abs:Math.abs,ln:Math.log,exp:Math.exp};
  function parse(min=0,depth=0):Fn {
    if(depth>20) throw Error('Expression too deep');
    const token=tokens[pos++];let left:Fn;
    if(token==='+'||token==='-') {const next=parse(3,depth+1);left=v=>token==='-'?-next(v):next(v);}
    else if(token==='(') {left=parse(0,depth+1);if(tokens[pos++]!==')')throw Error('Missing parenthesis');}
    else if(token && /^(?:\d|\.)/.test(token)) {const n=Number(token);if(!Number.isFinite(n)||Math.abs(n)>1e9)throw Error('Invalid number');left=()=>n;}
    else if(token && Object.prototype.hasOwnProperty.call(unary,token)) {if(tokens[pos++]!=='(')throw Error('Function needs parentheses');const arg=parse(0,depth+1);if(tokens[pos++]!==')')throw Error('Missing parenthesis');left=v=>unary[token](arg(v));}
    else if(token==='pi') left=()=>Math.PI;
    else if(token && names.has(token)) left=v=>v[token];
    else throw Error('Unknown symbol');
    const precedence:Record<string,number>={'+':1,'-':1,'*':2,'/':2,'^':3};
    while(pos<tokens.length && Object.prototype.hasOwnProperty.call(precedence,tokens[pos]) && precedence[tokens[pos]]>=min) {
      const op=tokens[pos++],a=left,b=parse(precedence[op]+(op==='^'?0:1),depth+1);
      left=v=>{const x=a(v),y=b(v);return op==='+'?x+y:op==='-'?x-y:op==='*'?x*y:op==='/'?x/y:Math.pow(x,y);};
    }
    return left;
  }
  const result=parse();if(pos!==tokens.length)throw Error('Unexpected expression token');return result;
}
export const mathReserved=new Set(['x','pi','sin','cos','tan','sqrt','abs','ln','exp']);
