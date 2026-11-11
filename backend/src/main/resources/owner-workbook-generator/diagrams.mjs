/**
 * Mindcrafti mathematical diagram components, rendered as resolution-independent SVG.
 * This is a deliberately constrained data-to-graphics engine, not arbitrary user SVG/JS.
 * No browser calls, npm packages, network access, or eval() required.
 * Coordinate geometry is drawn to scale; graph axes use the same physical scale for x/y.
 */
const NAVY = '#070a20';
const ORANGE = '#ff6a00';
const GREEN = '#007e86';
const GRID = '#dce3ed';
const FAINT = '#f8fafc';
const MUTED = '#697488';
let plotId = 0;

const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fmt = n => (Math.abs(n) < 1e-8 ? '0' : Number(n.toFixed(3)).toString());
function finite(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10000) {
    throw new Error(`${field} must be a finite, bounded number`);
  }
  return value;
}
function point(p, field) {
  if (Array.isArray(p) && p.length === 2) {
    return [finite(p[0], `${field}.x`), finite(p[1], `${field}.y`)];
  }
  if (p && typeof p === 'object') {
    return [finite(p.x, `${field}.x`), finite(p.y, `${field}.y`)];
  }
  throw new Error(`${field}: expected [x,y] or {x,y}`);
}
function range(input, field) {
  if (!Array.isArray(input) || input.length !== 2) throw new Error(`${field} must be [min,max]`);
  const [lo,hi] = input.map((v,i) => finite(v, `${field}.${i}`));
  if (!(lo < hi) || hi - lo > 50 || hi - lo < 0.5) throw new Error(`${field}: invalid bounds`);
  return [lo,hi];
}
function banner(label, svg, caption = '', kind = '') {
  const cls=kind==='graph' ? ' diagram-block--graph' : '';
  return `<section class="block diagram-block${cls}"><div class="diagram-eyebrow">${esc(label ?? 'ABBILDUNG')}</div>${svg}${caption ? `<div class="diagram-caption">${esc(caption)}</div>` : ''}</section>`;
}
const vec = (x,y) => `${fmt(x)},${fmt(y)}`;
const len = v => Math.hypot(v[0],v[1]);
const sub = (a,b) => [a[0]-b[0],a[1]-b[1]];
const add = (a,b) => [a[0]+b[0],a[1]+b[1]];
const mul = (v,k) => [v[0]*k,v[1]*k];
function unit(v) { const d=len(v);return d < 1e-8 ? [0,0] : mul(v,1/d); }

const coefficientList = (value, field) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5)
    throw new Error(`${field} coefficients must have length 1-5`);
  return value.map(c => finite(c, `${field}.coefficient`));
};
const polynomialAt = (coefficients, x) => coefficients.reduceRight((sum,c) => sum*x+c,0);
const polynomialScale = (coefficients,x) => Math.max(Number.MIN_VALUE,coefficients.reduce((sum,c,i)=>sum+Math.abs(c)*Math.pow(Math.abs(x),i),0));
function rationalParts(series) {
  const numerator = coefficientList(series.numerator ?? series.numeratorCoefficients, 'numerator');
  const denominator = coefficientList(series.denominator ?? series.denominatorCoefficients, 'denominator');
  if (denominator.every(c => c === 0)) throw new Error('rational denominator must not be zero');
  return { numerator, denominator };
}
function piecesOf(series) {
  if (!Array.isArray(series.pieces) || !series.pieces.length || series.pieces.length > 16)
    throw new Error('piecewise requires 1-16 pieces');
  const pieces = series.pieces.map(p => {
    const domain = p.domain ?? [p.from, p.to];
    if (!Array.isArray(domain) || domain.length !== 2) throw new Error('piecewise domain must be [min,max]');
    const min = finite(domain[0], 'piecewise.min'), max = finite(domain[1], 'piecewise.max');
    if (!(min < max)) throw new Error('piecewise domain must increase');
    const fn = p.function ?? p.series;
    if (!fn || typeof fn !== 'object') throw new Error('piecewise piece requires function');
    return { min, max, includeStart: p.includeStart !== false, includeEnd: p.includeEnd === true, fn };
  }).sort((a,b) => a.min-b.min);
  for (let i=1;i<pieces.length;i++) {
    if (pieces[i].min < pieces[i-1].max ||
      (pieces[i].min === pieces[i-1].max && pieces[i].includeStart && pieces[i-1].includeEnd))
      throw new Error('piecewise domains overlap');
  }
  return pieces;
}

/** Typed, safely evaluated functions. Polynomial coefficients are constant-first.
 * Returns null outside a real-valued domain or at a pole, never evals input text.
 */
export function functionAt(series, x, depth = 0) {
  finite(x,'x');
  if (!series || typeof series !== 'object' || depth > 8) throw new Error('Invalid or excessively nested function');
  let y;
  switch (series.kind) {
    case 'constant': y=finite(series.value ?? series.c ?? series.k ?? 0,'value');break;
    case 'linear': y=finite(series.m,'m')*x+finite(series.b,'b');break;
    case 'quadratic': y=finite(series.a,'a')*x*x+finite(series.b,'b')*x+finite(series.c,'c');break;
    case 'polynomial': y=polynomialAt(coefficientList(series.coefficients,'polynomial'),x);break;
    case 'sine':
    case 'cosine': {
      const a=finite(series.amplitude,'amplitude'), freq=finite(series.frequency,'frequency');
      const phase=finite(series.phase ?? 0,'phase'), shift=finite(series.offset ?? 0,'offset');
      y=a*(series.kind==='sine'?Math.sin(freq*x+phase):Math.cos(freq*x+phase))+shift;break;
    }
    case 'absolute':
    case 'reciprocal':
    case 'sqrt':
    case 'exponential':
    case 'log':
    case 'logarithmic': {
      const a=finite(series.a ?? 1,'a'), h=finite(series.h ?? 0,'h'), k=finite(series.k ?? 0,'k');
      const t=x-h;
      if (series.kind==='absolute') y=a*Math.abs(t)+k;
      else if (series.kind==='reciprocal') y=t===0?null:a/t+k;
      else if (series.kind==='sqrt') y=t<0?null:a*Math.sqrt(t)+k;
      else {
        const base=finite(series.base ?? (series.kind==='exponential'?Math.E:10),'base');
        if (base<=0 || base===1) throw new Error('exponential/logarithmic base must be positive and not 1');
        y=series.kind==='exponential'?a*Math.pow(base,t)+k:t<=0?null:a*Math.log(t)/Math.log(base)+k;
      }
      break;
    }
    case 'rational': {
      const {numerator,denominator}=rationalParts(series), d=polynomialAt(denominator,x);
      y=Math.abs(d)<=1e-12*polynomialScale(denominator,x)?null:polynomialAt(numerator,x)/d;break;
    }
    case 'piecewise': {
      const pieces=piecesOf(series);
      // Validate every branch, including branches outside the visible range.
      for (const p of pieces) functionAt(p.fn,(p.min+p.max)/2,depth+1);
      const p=pieces.find(p => (x>p.min || (x===p.min && p.includeStart)) &&
        (x<p.max || (x===p.max && p.includeEnd)));
      y=p?functionAt(p.fn,x,depth+1):null;break;
    }
    default: throw new Error(`Unsupported plot function: ${esc(series.kind)}`);
  }
  return typeof y==='number' && Number.isFinite(y)?y:null;
}

const numberText = n => String(Object.is(n,-0)?0:n);
function polynomialText(coefficients) {
  const terms=[];
  for (let power=coefficients.length-1;power>=0;power--) {
    const c=coefficients[power];if(c===0)continue;
    const magnitude=Math.abs(c), term=power===0?numberText(magnitude):
      `${magnitude===1?'':numberText(magnitude)}x${power===1?'':`^${power}`}`;
    terms.push(`${terms.length?(c<0?' - ':' + '):(c<0?'-':'')}${term}`);
  }
  return terms.join('') || '0';
}
const shiftedX = h => h===0?'x':`x ${h<0?'+':'-'} ${numberText(Math.abs(h))}`;
const scaled = (a,value) => a===1?value:a===-1?`-${value}`:`${numberText(a)}${value}`;
const shiftedY = (value,k) => k===0?value:`${value} ${k<0?'-':'+'} ${numberText(Math.abs(k))}`;
/** Canonical legend text is derived from the same coefficients used to plot. */
export function functionLabel(series, index = 0) {
  functionAt(series,0);
  let expression;
  switch(series.kind) {
    case 'constant':expression=numberText(series.value ?? series.c ?? series.k ?? 0);break;
    case 'linear':expression=polynomialText([series.b,series.m]);break;
    case 'quadratic':expression=polynomialText([series.c,series.b,series.a]);break;
    case 'polynomial':expression=polynomialText(series.coefficients);break;
    case 'sine':
    case 'cosine':expression=shiftedY(scaled(series.amplitude,`${series.kind==='sine'?'sin':'cos'}(${polynomialText([series.phase ?? 0,series.frequency])})`),series.offset ?? 0);break;
    case 'absolute':expression=shiftedY(scaled(series.a ?? 1,`|${shiftedX(series.h ?? 0)}|`),series.k ?? 0);break;
    case 'reciprocal':expression=shiftedY(`${numberText(series.a ?? 1)} / (${shiftedX(series.h ?? 0)})`,series.k ?? 0);break;
    case 'sqrt':expression=shiftedY(scaled(series.a ?? 1,`sqrt(${shiftedX(series.h ?? 0)})`),series.k ?? 0);break;
    case 'exponential':expression=shiftedY(scaled(series.a ?? 1,`${series.base===undefined?'e':numberText(series.base)}^(${shiftedX(series.h ?? 0)})`),series.k ?? 0);break;
    case 'log':
    case 'logarithmic':expression=shiftedY(scaled(series.a ?? 1,`log_${numberText(series.base ?? 10)}(${shiftedX(series.h ?? 0)})`),series.k ?? 0);break;
    case 'rational': {
      const {numerator,denominator}=rationalParts(series);
      expression=`(${polynomialText(numerator)}) / (${polynomialText(denominator)})`;break;
    }
    case 'piecewise':expression=piecesOf(series).map(p=>`${functionLabel(p.fn).split(' = ')[1]} for ${numberText(p.min)} ${p.includeStart?'≤':'<'} x ${p.includeEnd?'≤':'<'} ${numberText(p.max)}`).join('; ');break;
    default:throw Error('Unsupported plot function');
  }
  return `${['f','g','h'][index] ?? `f${index+1}`}(x) = ${expression}`;
}
export function graphWarnings(spec) {
  const normalized=s=>String(s).replace(/^[a-z][a-z0-9]*\(x\)\s*=/i,'').replaceAll('−','-').replace(/\s+/g,'');
  return (spec.series ?? []).flatMap((s,i)=>s.label && normalized(s.label)!==normalized(functionLabel(s,i))?
    [`Series ${i+1}: manual label was not verified against ${functionLabel(s,i)}`]:[]);
}

function trimPolynomial(coefficients) {
  const out=[...coefficients],scale=Math.max(...out.map(Math.abs));
  while(out.length>1 && Math.abs(out.at(-1))<=1e-13*scale)out.pop();return out;
}
// Derivative isolation catches even-multiplicity roots, including rational holes.
function polynomialRoots(coefficients,lo,hi) {
  const c=trimPolynomial(coefficients), degree=c.length-1;
  if(degree===0)return [];
  if(degree===1){const x=-c[0]/c[1];return x>=lo && x<=hi?[x]:[];}
  const critical=polynomialRoots(c.slice(1).map((v,i)=>v*(i+1)),lo,hi);
  const bounds=[lo,...critical,hi], roots=[];
  const nearZero=x=>Math.abs(polynomialAt(c,x))<=2e-14*polynomialScale(c,x);
  const addRoot=x=>{if(!roots.some(r=>Math.abs(r-x)<1e-7))roots.push(x);};
  for(const x of bounds)if(nearZero(x))addRoot(x);
  for(let i=1;i<bounds.length;i++){
    let a=bounds[i-1],b=bounds[i],fa=polynomialAt(c,a),fb=polynomialAt(c,b);
    if(fa*fb>=0)continue;
    for(let n=0;n<80 && b-a>1e-11;n++){
      const m=(a+b)/2,fm=polynomialAt(c,m);
      if(fm===0){a=b=m;break;}if((fa<0)===(fm<0)){a=m;fa=fm;}else{b=m;fb=fm;}
    }
    addRoot((a+b)/2);
  }
  return roots.sort((a,b)=>a-b);
}
function breakpoints(series,lo,hi,depth=0) {
  if(depth>8)throw Error('Excessively nested function');
  let cuts=[];
  if(['absolute','reciprocal','sqrt','log','logarithmic'].includes(series.kind)) cuts=[series.h ?? 0];
  if(series.kind==='rational') cuts=polynomialRoots(rationalParts(series).denominator,lo,hi);
  if(series.kind==='piecewise')for(const p of piecesOf(series))cuts.push(p.min,p.max,...breakpoints(p.fn,Math.max(lo,p.min),Math.min(hi,p.max),depth+1));
  return [...new Set(cuts.filter(x=>x>lo && x<hi))].sort((a,b)=>a-b);
}
function rationalHoles(series,lo,hi) {
  const {numerator,denominator}=rationalParts(series),holes=[];
  const derivative=c=>c.length===1?[0]:c.slice(1).map((v,i)=>v*(i+1));
  const nearZero=(c,x)=>Math.abs(polynomialAt(c,x))<=1e-9*polynomialScale(c,x);
  for(const x of polynomialRoots(denominator,lo,hi)){
    let n=numerator,d=denominator;
    for(let order=0;order<denominator.length;order++){
      if(!nearZero(d,x)){const y=polynomialAt(n,x)/polynomialAt(d,x);if(Number.isFinite(y))holes.push([x,y]);break;}
      if(!nearZero(n,x))break;
      n=derivative(n);d=derivative(d);
    }
  }
  return holes;
}
function ratioPolynomials(series) {
  switch(series.kind){
    case 'constant':return [[series.value ?? series.c ?? series.k ?? 0],[1]];
    case 'linear':return [[series.b,series.m],[1]];
    case 'quadratic':return [[series.c,series.b,series.a],[1]];
    case 'polynomial':return [series.coefficients,[1]];
    case 'reciprocal':return [[(series.a ?? 1)-(series.k ?? 0)*(series.h ?? 0),series.k ?? 0],[-(series.h ?? 0),1]];
    case 'rational':{const p=rationalParts(series);return [p.numerator,p.denominator];}
    default:return null;
  }
}
const multiplyPolynomial=(a,b)=>{
  const out=Array(a.length+b.length-1).fill(0);
  a.forEach((v,i)=>b.forEach((w,j)=>{out[i+j]+=v*w;}));return out;
};
function intersectionCandidates(a,b,lo,hi) {
  const ap=ratioPolynomials(a),bp=ratioPolynomials(b);
  if(ap && bp){
    const lhs=multiplyPolynomial(ap[0],bp[1]),rhs=multiplyPolynomial(bp[0],ap[1]);
    return polynomialRoots(Array.from({length:Math.max(lhs.length,rhs.length)},(_,i)=>(lhs[i] ?? 0)-(rhs[i] ?? 0)),lo,hi);
  }
  const cuts=[lo,...breakpoints(a,lo,hi),...breakpoints(b,lo,hi),hi].sort((x,y)=>x-y), roots=[];
  const difference=x=>{const ay=functionAt(a,x),by=functionAt(b,x);return ay===null || by===null?null:ay-by;};
  const addRoot=x=>{const d=difference(x);if(d!==null && Math.abs(d)<1e-7 && !roots.some(r=>Math.abs(r-x)<1e-5))roots.push(x);};
  for(let k=1;k<cuts.length;k++){
    const start=cuts[k-1],end=cuts[k];if(end<=start)continue;
    // Never bracket across a pole or a piecewise boundary.
    const n=512, samples=[];
    for(let j=0;j<=n;j++){
      const x=start+(end-start)*j/n,d=difference(x);samples.push({x,d});
    }
    for(let j=0;j<samples.length;j++){
      const {x,d}=samples[j],neighbors=[samples[j-1],samples[j+1]].filter(Boolean);
      // Coincident portions have infinitely many points, not isolated intersections.
      if(d!==null && Math.abs(d)<1e-9 && neighbors.every(p=>p.d===null || Math.abs(p.d)>1e-9))addRoot(x);
    }
    for(let j=1;j<samples.length;j++){
      const left=samples[j-1],right=samples[j];
      if(left.d===null || right.d===null || left.d*right.d>=0)continue;
      let l=left.x,r=right.x,dl=left.d;
      for(let n=0;n<70;n++){
        const m=(l+r)/2,dm=difference(m);if(dm===null)break;
        if((dm<0)===(dl<0)){l=m;dl=dm;}else r=m;
      }
      addRoot((l+r)/2);
    }
    // Local minima of |f-g| catch tangencies without a sign change.
    for(let j=1;j<samples.length-1;j++){
      const before=samples[j-1],mid=samples[j],after=samples[j+1];
      if(before.d===null || mid.d===null || after.d===null || Math.abs(mid.d)>=Math.abs(before.d) || Math.abs(mid.d)>=Math.abs(after.d))continue;
      let l=before.x,r=after.x;
      for(let n=0;n<65;n++){
        const u=l+(r-l)/3,v=r-(r-l)/3,du=difference(u),dv=difference(v);
        if(du===null || dv===null)break;
        if(Math.abs(du)<Math.abs(dv))r=v;else l=u;
      }
      addRoot((l+r)/2);
    }
  }
  return roots;
}
/** Reusable in teacher answers; only actual, finite intersections in both axes. */
export function computeIntersections(spec) {
  if(!spec || !Array.isArray(spec.series) || spec.series.length<1 || spec.series.length>3)
    throw Error('graph requires 1-3 function series');
  const [lo,hi]=range(spec.xRange ?? [-5,5],'xRange'),[y0,y1]=range(spec.yRange ?? [-5,5],'yRange');
  spec.series.forEach(s=>functionAt(s,(lo+hi)/2));
  const result=[];
  for(let i=0;i<spec.series.length;i++)for(let j=i+1;j<spec.series.length;j++){
    for(const x of intersectionCandidates(spec.series[i],spec.series[j],lo,hi)){
      const y=functionAt(spec.series[i],x),other=functionAt(spec.series[j],x);
      if(y===null || other===null || Math.abs(y-other)>1e-6 || y<y0-1e-8 || y>y1+1e-8)continue;
      if(result.length>=64)throw Error('Too many intersections; narrow the graph range');
      result.push({x:Math.abs(x)<1e-10?0:x,y:Math.abs(y)<1e-10?0:y,seriesIndices:[i,j]});
    }
  }
  return result.sort((a,b)=>a.x-b.x || a.seriesIndices[0]-b.seriesIndices[0]);
}

function curveSegments(series,x0,x1,y0,y1) {
  const cuts=[x0,...breakpoints(series,x0,x1),x1], segments=[];
  for(let k=1;k<cuts.length;k++){
    const lo=cuts[k-1],hi=cuts[k];if(hi<=lo)continue;
    const epsilon=Math.max(1e-10,(hi-lo)*1e-8), n=Math.max(12,Math.ceil(420*(hi-lo)/(x1-x0)));
    let current=[],previous=null;
    const flush=()=>{if(current.length>1)segments.push(current);current=[];};
    for(let j=0;j<=n;j++){
      // One-sided samples at internal boundaries prevent any connecting jump.
      const x=j===0 && k>1?lo+epsilon:j===n && k<cuts.length-1?hi-epsilon:lo+(hi-lo)*j/n;
      const y=functionAt(series,x),next=y===null?null:[x,y];
      if(previous && next){
        let a=previous,b=next;
        if((a[1]<y0 && b[1]<y0) || (a[1]>y1 && b[1]>y1)){flush();}
        else{
          const interpolate=y=>[a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]),y];
          const start=a[1]<y0?interpolate(y0):a[1]>y1?interpolate(y1):a;
          const end=b[1]<y0?interpolate(y0):b[1]>y1?interpolate(y1):b;
          if(!current.length)current.push(start);current.push(end);
          if(b[1]<y0 || b[1]>y1)flush();
        }
      }else flush();
      previous=next;
    }
    flush();
  }
  return segments;
}

export function graphSvg(spec) {
  const empty=spec?.type==='coordinateGrid';
  if (!spec || (!empty && (!Array.isArray(spec.series) || spec.series.length < 1 || spec.series.length > 3)))
    throw new Error('graph requires 1-3 function series');
  const series=empty?[]:spec.series;
  const [x0,x1]=range(spec.xRange ?? [-5,5],'xRange');
  const [y0,y1]=range(spec.yRange ?? [-5,5],'yRange');
  const step=finite(spec.gridStep ?? 1,'gridStep');
  if(step < 0.25 || step > 10 || (x1-x0)/step > 35 || (y1-y0)/step > 35)throw Error('Unsupported gridStep');
  const W=560,H=258;
  const layoutScale=spec.layoutPlotScalePercent ?? 100;
  if (!Number.isInteger(layoutScale) || layoutScale < 90 || layoutScale > 110) throw Error('Unsupported graph layout scale');
  const scale=Math.min(455/(x1-x0),207/(y1-y0)) * (layoutScale / 100);
  const plotW=scale*(x1-x0), plotH=scale*(y1-y0);
  const centeredLeft=(W-plotW)/2;
  const left=spec.layoutAlignment==='left' ? Math.max(26, centeredLeft-Math.min(70,centeredLeft/2)) : centeredLeft;
  const top=(H-plotH)/2-2;
  const right=left+plotW, bottom=top+plotH;
  const X=x => left + (x-x0)*scale;
  const Y=y => bottom - (y-y0)*scale;
  const inside=(x,y)=>x>=x0-1e-9 && x<=x1+1e-9 && y>=y0-1e-9 && y<=y1+1e-9;
  const id=`mc-graph-clip-${++plotId}`;
  const grid=[];
  const xlabelY=Math.min(H-3,bottom+14);
  const ylabelX=Math.max(7,left-10);
  for(let k=Math.ceil(x0/step);k<=Math.floor(x1/step);k++){
    const x=k*step;const px=X(x);
    grid.push(`<line x1="${fmt(px)}" y1="${fmt(top)}" x2="${fmt(px)}" y2="${fmt(bottom)}" stroke="${GRID}" stroke-width="0.8"/>`);
    if (spec.showAxisLabels!==false && Number.isInteger(x) && (Math.abs(x)<1e-9 || Math.round(x)%2===0 || (x1-x0)<=9)) {
      grid.push(`<text x="${fmt(px)}" y="${fmt(xlabelY)}" text-anchor="middle" font-size="9.5" fill="${MUTED}">${fmt(x)}</text>`);
    }
  }
  for(let k=Math.ceil(y0/step);k<=Math.floor(y1/step);k++){
    const y=k*step,py=Y(y);
    grid.push(`<line x1="${fmt(left)}" y1="${fmt(py)}" x2="${fmt(right)}" y2="${fmt(py)}" stroke="${GRID}" stroke-width="0.8"/>`);
    if(spec.showAxisLabels!==false && Number.isInteger(y) && (Math.abs(y)<1e-9 || Math.round(y)%2===0 || (y1-y0)<=9)){
      grid.push(`<text x="${fmt(ylabelX)}" y="${fmt(py+3)}" text-anchor="end" font-size="9.5" fill="${MUTED}">${fmt(y)}</text>`);
    }
  }
  const axes=[];
  if(x0<=0&&x1>=0)axes.push(`<line x1="${fmt(X(0))}" y1="${fmt(top-1)}" x2="${fmt(X(0))}" y2="${fmt(bottom+1)}" stroke="${NAVY}" stroke-width="1.6"/>`);
  if(y0<=0&&y1>=0)axes.push(`<line x1="${fmt(left-1)}" y1="${fmt(Y(0))}" x2="${fmt(right+1)}" y2="${fmt(Y(0))}" stroke="${NAVY}" stroke-width="1.6"/>`);
  const curves=[];
  series.forEach((s,i)=>{
    const color=i===0?ORANGE:i===1?GREEN:NAVY;
    functionAt(s,(x0+x1)/2);
    for(const pts of curveSegments(s,x0,x1,y0,y1))
      curves.push(`<polyline data-series-index="${i}" points="${pts.map(([x,y])=>vec(X(x),Y(y))).join(' ')}" stroke="${color}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  });
  const markers=[];
  series.forEach((s,i)=>{
    const color=i===0?ORANGE:i===1?GREEN:NAVY;
    if(s.kind==='piecewise'){
      for(const p of piecesOf(s))for(const [x,included] of [[p.min,p.includeStart],[p.max,p.includeEnd]]){
        const y=functionAt(p.fn,x);
        if(y!==null && inside(x,y))markers.push(`<circle class="piecewise-endpoint" cx="${fmt(X(x))}" cy="${fmt(Y(y))}" r="3" fill="${included?color:'white'}" stroke="${color}" stroke-width="1.5"/>`);
      }
    }
    if(s.kind==='rational')for(const [x,y] of rationalHoles(s,x0,x1))
      if(inside(x,y))markers.push(`<circle class="rational-hole" cx="${fmt(X(x))}" cy="${fmt(Y(y))}" r="3" fill="white" stroke="${color}" stroke-width="1.5"/>`);
  });
  if(spec.points!==undefined){
    if(!Array.isArray(spec.points) || spec.points.length>12)throw Error('Max 12 graph points');
    spec.points.forEach((p,i)=>{
      const coord=point(p,'graph.point'); const [x,y]=coord;
      if(!inside(x,y))throw Error(`graph point ${i} outside axes`);
      if(p.seriesIndex!==undefined){
        if(!Number.isInteger(p.seriesIndex)||p.seriesIndex<0||p.seriesIndex>=series.length)throw Error('Invalid seriesIndex');
        const actual=functionAt(series[p.seriesIndex],x);
        if(actual===null || Math.abs(actual-y)>1e-5)throw Error('Graph marker not on selected function');
      }
      const px=X(x),py=Y(y);
      markers.push(`<circle cx="${fmt(px)}" cy="${fmt(py)}" r="3.4" fill="${NAVY}" stroke="white" stroke-width="1"/>`);
      if(p.label)markers.push(`<text x="${fmt(px+7)}" y="${fmt(py-6)}" font-size="11" fill="${NAVY}">${esc(p.label)}</text>`);
    });
  }
  if(spec.showIntersections && !empty){
    const intersections=computeIntersections(spec);
    intersections.forEach((p,i)=>{
      const px=X(p.x),py=Y(p.y);
      markers.push(`<circle class="graph-intersection" data-x="${fmt(p.x)}" data-y="${fmt(p.y)}" cx="${fmt(px)}" cy="${fmt(py)}" r="3.8" fill="${NAVY}" stroke="white" stroke-width="1"/>`);
      if(spec.showIntersectionLabels!==false){
        const label=`S${intersections.length>1?i+1:''}(${fmt(p.x)} | ${fmt(p.y)})`;
        const anchor=px>W/2?'end':'start',labelX=px+(anchor==='end'?-7:7);
        markers.push(`<text x="${fmt(labelX)}" y="${fmt(Math.max(top+11,py-7))}" text-anchor="${anchor}" font-size="10" fill="${NAVY}">${esc(label)}</text>`);
      }
    });
  }
  const legend=series.map((s,i)=>{
    const color=i===0?ORANGE:i===1?GREEN:NAVY;
    return `<span class="graph-legend-item"><i class="graph-legend-swatch" style="background:${color}"></i>${esc(s.label??functionLabel(s,i))}</span>`;
  }).join('');
  const warnings=graphWarnings({series});
  return `${legend?`<div class="graph-legend"${warnings.length?` data-graph-warnings="${esc(JSON.stringify(warnings))}"`:''}>${legend}</div>`:''}<svg class="diagram-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.alt || (empty?'Leeres Koordinatensystem':'Koordinatensystem mit Funktionsgraphen'))}">
<defs><clipPath id="${id}"><rect x="${fmt(left)}" y="${fmt(top)}" width="${fmt(plotW)}" height="${fmt(plotH)}"/></clipPath></defs>
<rect x="${fmt(left)}" y="${fmt(top)}" width="${fmt(plotW)}" height="${fmt(plotH)}" fill="${FAINT}" stroke="${GRID}" stroke-width="1"/>
${grid.join('')}${axes.join('')}<g clip-path="url(#${id})">${curves.join('')}</g>${markers.join('')}
${spec.showAxisLabels===false?'':`<text x="${fmt(Math.min(W-5,right+12))}" y="${fmt(y0<=0&&y1>=0?Y(0)-5:bottom+10)}" font-size="11" fill="${NAVY}">x</text>
<text x="${fmt(x0<=0&&x1>=0?X(0)+6:left+6)}" y="${fmt(top+12)}" font-size="11" fill="${NAVY}">y</text>`}
</svg>`;
}

export function coordinateGridSvg(spec = {}) {
  return graphSvg({...spec,type:'coordinateGrid'});
}

/** geometry figures are built from measured coordinates, not hand-drawn paths. */
export function geometrySvg(spec) {
  if(spec && ['cylinder','cone','sphere','fractionCircle'].includes(spec.figure))return roundFigureSvg(spec);
  if(!spec || !['triangle','rectangle','circle','quadrilateral','polygon','cube','cuboid'].includes(spec.figure))
    throw new Error(`Unsupported geometry figure: ${esc(spec?.figure)}`);
  const W=560,H=258;
  let world=[], entries=[];
  const circle = spec.figure==='circle';
  const is3d = spec.figure==='cube' || spec.figure==='cuboid';
  let center,radius;
  if(is3d){
    world=[[0,0],[1,1]];
  } else if(circle){
    center=point(spec.center,'center');radius=finite(spec.radius,'radius');
    if(radius<=0)throw Error('Circle radius must be positive');
    world=[add(center,[-radius,-radius]),add(center,[radius,radius])];
  }else{
    if(!Array.isArray(spec.vertices) || (spec.figure==='polygon' ? spec.vertices.length<3 || spec.vertices.length>8 : spec.vertices.length!==(spec.figure==='triangle'?3:4)))throw Error(`Invalid ${spec.figure} vertices`);
    entries=spec.vertices.map((p,i)=>({name: String(p.label || 'ABCDEFGH'[i]), p:point(p,`vertex${i}`)}));
    world=entries.map(x=>x.p);
    const area=Math.abs(world.reduce((sum,p,i)=>sum+p[0]*world[(i+1)%world.length][1]-p[1]*world[(i+1)%world.length][0],0))/2;
    if(area<1e-5)throw Error('Degenerate polygon: area must be nonzero');
    const names=entries.map(e=>e.name);
    if(new Set(names).size!==names.length||names.some(x=>x.length>5))throw Error('Duplicate or invalid vertex labels');
    if(spec.figure==='rectangle'){
      const E=world.map((p,i)=>sub(world[(i+1)%4],p));
      const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
      const tol=1e-7;
      for(let i=0;i<4;i++){
        if(Math.abs(dot(E[i],E[(i+1)%4]))>tol*len(E[i])*len(E[(i+1)%4]))
          throw Error('Rectangle vertices are not perpendicular');
      }
      if(Math.abs(len(E[0])-len(E[2]))>tol || Math.abs(len(E[1])-len(E[3]))>tol)
        throw Error('Rectangle opposite sides have different lengths');
    }
  }
  const xs=world.map(p=>p[0]),ys=world.map(p=>p[1]);
  let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
  let dx=xmax-xmin,dy=ymax-ymin;
  if(dx<0.001)dx=1;if(dy<0.001)dy=1;
  const s=Math.min(380/dx,172/dy);
  const cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
  const P=pt=>[W/2+(pt[0]-cx)*s,H/2-(pt[1]-cy)*s];
  const lab=(x,y,t,color=NAVY,anchor='middle')=>`<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}" font-size="15" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" fill="${color}">${esc(t)}</text>`;
  const unitSuffix=String(spec.unit??'');
  if(unitSuffix.length>8)throw Error('unit label too long');
  const shapes=[];
  if(is3d){
    const dimLine=(x1,y1,x2,y2,label,lx,ly,anchor='middle')=>`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${ORANGE}" stroke-width="2.1"/>
      <circle cx="${fmt(x1)}" cy="${fmt(y1)}" r="3" fill="${ORANGE}"/><circle cx="${fmt(x2)}" cy="${fmt(y2)}" r="3" fill="${ORANGE}"/>
      ${lab(lx,ly,label,ORANGE,anchor)}`;
    const drawBox=(opts)=>{
      const x=opts.x,y=opts.y,w=opts.w,h=opts.h,d=opts.d,name=opts.name;
      const dx=d*0.78, dy=-d*0.55;
      const A=[x,y],B=[x+w,y],C=[x+w,y+h],D=[x,y+h];
      const E=[x+dx,y+dy],F=[x+w+dx,y+dy],G=[x+w+dx,y+h+dy],H=[x+dx,y+h+dy];
      const q=(p)=>vec(...p);
      const out=[];
      out.push(`<polygon points="${q(A)} ${q(B)} ${q(C)} ${q(D)}" fill="#fff9f4" stroke="${NAVY}" stroke-width="2.4" stroke-linejoin="round"/>`);
      out.push(`<polygon points="${q(D)} ${q(C)} ${q(G)} ${q(H)}" fill="#fff6ee" stroke="${NAVY}" stroke-width="2.4" stroke-linejoin="round"/>`);
      out.push(`<polygon points="${q(B)} ${q(C)} ${q(G)} ${q(F)}" fill="#fff3ea" stroke="${NAVY}" stroke-width="2.4" stroke-linejoin="round"/>`);
      out.push(`<line x1="${fmt(A[0])}" y1="${fmt(A[1])}" x2="${fmt(E[0])}" y2="${fmt(E[1])}" stroke="${NAVY}" stroke-width="2.2"/>`);
      out.push(`<line x1="${fmt(E[0])}" y1="${fmt(E[1])}" x2="${fmt(F[0])}" y2="${fmt(F[1])}" stroke="${NAVY}" stroke-width="2.2"/>`);
      out.push(`<line x1="${fmt(F[0])}" y1="${fmt(F[1])}" x2="${fmt(G[0])}" y2="${fmt(G[1])}" stroke="${NAVY}" stroke-width="2.2"/>`);
      out.push(`<line x1="${fmt(E[0])}" y1="${fmt(E[1])}" x2="${fmt(H[0])}" y2="${fmt(H[1])}" stroke="${NAVY}" stroke-width="1.8" stroke-dasharray="7 5"/>`);
      out.push(`<line x1="${fmt(H[0])}" y1="${fmt(H[1])}" x2="${fmt(G[0])}" y2="${fmt(G[1])}" stroke="${NAVY}" stroke-width="1.8" stroke-dasharray="7 5"/>`);
      out.push(`<line x1="${fmt(H[0])}" y1="${fmt(H[1])}" x2="${fmt(D[0])}" y2="${fmt(D[1])}" stroke="${NAVY}" stroke-width="1.8" stroke-dasharray="7 5"/>`);
      if(opts.showMeasures === true){
        out.push(dimLine(A[0],A[1]+16,B[0],B[1]+16,`${fmt(opts.widthVal)}${unitSuffix?` ${unitSuffix}`:''}`,(A[0]+B[0])/2,A[1]+34));
        out.push(dimLine(B[0]+18,B[1]+10,E[0]+18,E[1]+10,`${fmt(opts.depthVal)}${unitSuffix?` ${unitSuffix}`:''}`,(B[0]+E[0])/2+28,(B[1]+E[1])/2+8));
        out.push(dimLine(C[0]+20,C[1],G[0]+20,G[1],`${fmt(opts.heightVal)}${unitSuffix?` ${unitSuffix}`:''}`,G[0]+42,(C[1]+G[1])/2+4,'start'));
      }
      out.push(lab((A[0]+B[0])/2,C[1]+40,name,NAVY));
      return out.join('');
    };
    if(spec.figure==='cube'){
      const side=finite(spec.side??4,'side');
      shapes.push(drawBox({x:150,y:120,w:92,h:92,d:42,name:spec.name??'Würfel',widthVal:side,depthVal:side,heightVal:side,showMeasures: spec.showMeasuresOnFigure}));
    } else {
      const widthVal=finite(spec.width??6,'width'), depthVal=finite(spec.depth??4,'depth'), heightVal=finite(spec.height??3,'height');
      shapes.push(drawBox({x:105,y:118,w:172,h:76,d:56,name:spec.name??'Quader',widthVal,depthVal,heightVal,showMeasures: spec.showMeasuresOnFigure}));
    }
  } else if(circle){
    const cp=P(center),rad=radius*s;
    shapes.push(`<circle cx="${fmt(cp[0])}" cy="${fmt(cp[1])}" r="${fmt(rad)}" fill="#fff8f2" stroke="${NAVY}" stroke-width="2.4"/>`);
    shapes.push(`<circle cx="${fmt(cp[0])}" cy="${fmt(cp[1])}" r="3.4" fill="${ORANGE}"/>`);
    const angle=(Math.PI/180)*finite(spec.radiusAngle??30,'radiusAngle');
    const rp=[cp[0]+rad*Math.cos(angle),cp[1]-rad*Math.sin(angle)];
    shapes.push(`<line x1="${fmt(cp[0])}" y1="${fmt(cp[1])}" x2="${fmt(rp[0])}" y2="${fmt(rp[1])}" stroke="${ORANGE}" stroke-width="2.2"/>`);
    shapes.push(lab(cp[0]-14,cp[1]+16,spec.centerLabel??'M'));
    const radiusLabel=spec.showRadiusMeasureOnFigure===true
      ? `r = ${fmt(radius)}${unitSuffix?` ${unitSuffix}`:''}` : 'r';
    shapes.push(lab((cp[0]+rp[0])/2+4,(cp[1]+rp[1])/2-12,radiusLabel,ORANGE));
  }else{
    const points=world.map(P);
    const centroid=points.reduce((acc,p)=>add(acc,p),[0,0]).map(x=>x/points.length);
    const showVertexLabels = spec.showVertexLabels !== false;
    const showSideLabels = spec.showSideLabels !== false;
    const showAngleLabels = spec.showAngleLabels !== false;
    const showSideMeasures = spec.showSides === true;
    const showAngleMeasures = spec.showAngles === true;
    const defaultSideLabels = points.length===3 ? ['c','a','b'] : ['a','b','c','d'];
    const defaultAngleLabels = points.length===3 ? ['α','β','γ'] : entries.map(e => `∠${e.name}`);
    const sideLabels = Array.isArray(spec.sideLabels) ? spec.sideLabels : defaultSideLabels;
    const angleLabels = Array.isArray(spec.angleLabels) ? spec.angleLabels : defaultAngleLabels;
    shapes.push(`<polygon points="${points.map(p=>vec(...p)).join(' ')}" fill="#fff9f4" stroke="${NAVY}" stroke-width="2.5" stroke-linejoin="round"/>`);
    entries.forEach((e,i)=>{
      const pt=points[i];const dir=unit(sub(pt,centroid));const offset=mul(dir,15);
      shapes.push(`<circle cx="${fmt(pt[0])}" cy="${fmt(pt[1])}" r="3.5" fill="${ORANGE}"/>`);
      if(showVertexLabels){
        shapes.push(lab(pt[0]+offset[0],pt[1]+offset[1]+2,e.name));
      }
    });
    if(showSideLabels || showSideMeasures){
      points.forEach((pt,i)=>{
        const next=points[(i+1)%points.length];
        const mid=mul(add(pt,next),0.5),normal=unit(sub(mid,centroid));
        const sidePos=add(mid,mul(normal,18));
        const measPos=add(mid,mul(normal,34));
        if(showSideLabels && sideLabels[i]){
          shapes.push(lab(sidePos[0],sidePos[1],String(sideLabels[i]),GREEN));
        }
        if(showSideMeasures){
          const d=len(sub(world[i],world[(i+1)%world.length]));
          shapes.push(lab(measPos[0],measPos[1],`${fmt(d)}${unitSuffix?` ${unitSuffix}`:''}`,GREEN));
        }
      });
    }
    if(showAngleLabels || showAngleMeasures){
      points.forEach((p,i)=>{
        const prev=points[(i+points.length-1)%points.length];
        const next=points[(i+1)%points.length];
        const a=unit(sub(prev,p)),b=unit(sub(next,p));
        const angle=Math.acos(Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1])));
        const bis=unit(add(a,b));
        if(len(bis)<1e-5)return;
        const arcR=20;
        const sweep=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
        const start=Math.atan2(a[1],a[0]);
        const arc=Array.from({length:17},(_,k)=>{
          const theta=start+sweep*k/16;return add(p,[arcR*Math.cos(theta),arcR*Math.sin(theta)]);
        });
        shapes.push(`<polyline points="${arc.map(pt=>vec(...pt)).join(' ')}" stroke="${ORANGE}" stroke-width="1.6" fill="none"/>`);
        const baseLbl=add(p,mul(bis,40));
        const measLbl=add(p,mul(bis,58));
        if(showAngleLabels && angleLabels[i]){
          shapes.push(lab(baseLbl[0],baseLbl[1]+3,String(angleLabels[i]),ORANGE));
        }
        if(showAngleMeasures){
          shapes.push(lab(measLbl[0],measLbl[1]+4,`${fmt(Math.round(angle*180/Math.PI*10)/10)}°`,ORANGE));
        }
      });
    }
  }
  return `<svg class="diagram-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.alt ?? `${spec.figure} drawing`)}">${shapes.join('')}</svg>`;
}

/** Equal circular sectors and schematic solids, with bounded dimensions and no external assets. */
function roundFigureSvg(spec) {
  const shapes=[], cx=280,cy=129,r=86;
  const line=(x1,y1,x2,y2,dashed=false)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${NAVY}" stroke-width="2"${dashed?' stroke-dasharray="6 4"':''}/>`;
  const label=(x,y,value)=>`<text x="${x}" y="${y}" font-size="15" fill="${NAVY}">${esc(value)}</text>`;
  if(spec.figure==='fractionCircle') {
    const n=spec.parts,k=spec.selected;
    if(!Number.isInteger(n)||n<2||n>24||!Number.isInteger(k)||k<0||k>n)throw Error('Invalid equal circle sectors');
    for(let i=0;i<n;i++) {
      const a=-Math.PI/2+2*Math.PI*i/n,b=-Math.PI/2+2*Math.PI*(i+1)/n;
      const x1=cx+r*Math.cos(a),y1=cy+r*Math.sin(a),x2=cx+r*Math.cos(b),y2=cy+r*Math.sin(b);
      shapes.push(`<path class="fraction-sector${i<k?' selected':''}" d="M ${cx} ${cy} L ${fmt(x1)} ${fmt(y1)} A ${r} ${r} 0 0 1 ${fmt(x2)} ${fmt(y2)} Z" fill="${i<k?'#b7dce2':'white'}" stroke="${NAVY}" stroke-width="1.4"/>`);
    }
  } else {
    const radius=finite(spec.radius,'radius');if(radius<=0)throw Error('Radius must be positive');
    if(spec.figure!=='sphere'&&finite(spec.height,'height')<=0)throw Error('Height must be positive');
    if(spec.figure==='sphere') {
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="${NAVY}" stroke-width="2.4"/>`,
        `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="25" fill="none" stroke="${NAVY}" stroke-dasharray="6 4"/>`,line(cx,cy,cx+r,cy),label(cx+40,cy-7,'r'));
    } else if(spec.figure==='cylinder') {
      shapes.push(`<path d="M 194 60 L 194 198 A 86 24 0 0 0 366 198 L 366 60" fill="#f8fafc" stroke="${NAVY}" stroke-width="2.4"/>`,
        `<ellipse cx="280" cy="60" rx="86" ry="24" fill="white" stroke="${NAVY}" stroke-width="2.4"/>`,
        `<path d="M 194 198 A 86 24 0 0 1 366 198" fill="none" stroke="${NAVY}" stroke-dasharray="6 4"/>`,
        line(280,60,366,60),label(320,53,'r'),line(384,60,384,198),label(390,132,'h'));
    } else {
      shapes.push(`<path d="M 194 198 L 280 34 L 366 198 A 86 24 0 0 1 194 198" fill="#f8fafc" stroke="${NAVY}" stroke-width="2.4"/>`,
        `<path d="M 194 198 A 86 24 0 0 1 366 198" fill="none" stroke="${NAVY}" stroke-dasharray="6 4"/>`,
        line(280,34,280,198,true),line(280,198,366,198),label(285,125,'h'),label(320,191,'r'));
    }
  }
  return `<svg class="diagram-svg" viewBox="0 0 560 258" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.figure)}">${shapes.join('')}</svg>`;
}

export function renderDiagram(block){
  switch(block.type){
    case 'graph':return banner(block.label??'FUNKTION & KOORDINATENSYSTEM',graphSvg(block),block.caption,'graph');
    case 'coordinateGrid':return banner(block.label??'KOORDINATENSYSTEM',coordinateGridSvg(block),block.caption,'graph');
    case 'geometry':return banner(block.label??'GEOMETRISCHE ZEICHNUNG',geometrySvg(block),block.caption);
    default:throw Error('Unsupported diagram block');
  }
}
