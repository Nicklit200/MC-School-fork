/**
 * Physical A4 page packing for the canonical Mindcrafti renderer.
 * Heights are conservative estimates in millimetres, matched to styles.css.
 * WeasyPrint geometry QA remains authoritative and can request a repack.
 */
const mm = (value, fallback='4mm') => {
  const v = String(value ?? fallback);
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) throw new TypeError('Invalid layout length');
  return n * (v.endsWith('mm') ? 1 : v.endsWith('px') ? 25.4/96 : v.endsWith('em') ? 16*25.4/96 : 1);
};
const wrapped = (value, chars=84) => Math.max(1, Math.ceil(String(value ?? '').length / chars));
const childrenHeight = (items, teacher=false, gap=3.6) =>
  (items || []).reduce((sum,block)=>sum+blockHeightMm(block,teacher),0) + Math.max(0,(items || []).length-1)*gap;
const checkInt = (value, fallback, min, max) => {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n<min || n>max) throw new TypeError('Expected integer '+min+'..'+max);
  return n;
};

/** A visible response line is 2.4 mm high with 7.2 mm between lines. */
export function handwritingHeightMm(lines) {
  const n = checkInt(lines,0,0,30);
  return n ? 4 + 2.4*n + 7.2*(n-1) + 1 : 0;
}

export function blockHeightMm(b, teacher=false) {
  switch (String(b?.type ?? '')) {
    case 'exercise': {
      const title = b.title ? 7 + 4.5*(wrapped(b.title,50)-1) : 0;
      const subtitle = b.subtitle ? 3 + 4.5*wrapped(b.subtitle,78) : 0;
      const description = b.description ? 4 + 5*wrapped(b.description,76) : 0;
      const rows = (b.rows || []).length * (b.variant==='exit' ? 27 : b.size==='relaxed' ? 25 : 14);
      return 10 + title + subtitle + description + rows + handwritingHeightMm(b.writeLines ?? 0)
        + (b.extra ? 13 : 0) + (b.selfRating ? 10 : 0) + (b.explanation ? 7*wrapped(b.explanation,88) : 0);
    }
    case 'callout': return 15 + 5*wrapped(b.text,100);
    case 'example': return b.text ? 34 + 5*(wrapped(b.text,85)-1) : 27;
    case 'strips': return 40;
    case 'graph': case 'coordinateGrid': return 85;
    case 'geometry': return 78;
    case 'facts': return 35 + 6*(((b.given||[]).length+(b.find||[]).length)/2);
    case 'teacherNote': {
      const paragraphs = Array.isArray(b.paragraphs) ? b.paragraphs : [b.text || ''];
      return 19 + paragraphs.reduce((s,p)=>s+5.1*wrapped(p,85),0);
    }
    case 'schedule': return 23 + (b.rows||[]).length*10;
    case 'solutions': return 17 + (b.items||[]).reduce((s,item)=>s+8+(item.note ? 4*wrapped(item.note,95) : 0)+(item.text ? 4*wrapped(item.text,95) : 0),0);
    case 'row': return Math.max(0,...(b.children||[]).map(c=>blockHeightMm(c,teacher)));
    case 'grid': {
      const items=b.children||[], n=checkInt(b.columns,2,1,4), parts=[];
      for(let i=0;i<items.length;i+=n)parts.push(Math.max(...items.slice(i,i+n).map(c=>blockHeightMm(c,teacher))));
      return parts.reduce((s,h)=>s+h,0)+Math.max(0,parts.length-1)*mm(b.gap,'4mm');
    }
    case 'split': return Math.max(childrenHeight(b.left,teacher,3),childrenHeight(b.right,teacher,3));
    case 'column': case 'stack': return childrenHeight(b.children,teacher,mm(b.gap,'4mm'));
    case 'taskCard': return 13+(b.title ? 7 : 0)+(b.subtitle ? 5*wrapped(b.subtitle,82) : 0)+(b.description ? 6*wrapped(b.description,76) : 0)+childrenHeight(b.children,teacher);
    case 'answerLines': return handwritingHeightMm(checkInt(b.lines ?? b.count,3,1,15));
    case 'answerBox': return mm(b.height,'24mm')+5;
    case 'studentHeader': return 14;
    case 'matching': return 14*Math.max((b.left||[]).length,(b.right||[]).length)+14;
    case 'conclusionBox': return 14+(b.text ? 6*wrapped(b.text,80) : 0)+(b.children ? childrenHeight(b.children,teacher) : handwritingHeightMm(b.lines??2));
    case 'spacer': return mm(b.height,'4mm');
    case 'divider': return 2;
    case 'richText': case 'text': case 'explanation': case 'intersectionResult': return 7*wrapped(b.text??b.content,85);
    case 'math': return 16;
    default: throw new TypeError('Unknown pagination block: '+b?.type);
  }
}
const contentHeightMm = (blocks, teacher=false) => childrenHeight(blocks,teacher,3.6);

export function preflightPages(pages, teacher=false) {
  const maximum=teacher ? 208 : 194;
  for(const [index,p] of pages.entries()) {
    if(!p || !Array.isArray(p.blocks))throw new TypeError('Page '+(index+1)+' must contain blocks[]');
    if(p.blocks.length>80)throw new TypeError('Page '+(index+1)+' has too many blocks');
    const h=contentHeightMm(p.blocks,teacher);
    if(h>maximum)throw new Error('Page '+(index+1)+' is likely to overflow A4 ('+Math.ceil(h)+' mm > '+maximum+' mm)');
  }
}

export function autoPaginatePages(pages,teacher=false) {
  // Keeps approx. 35 mm headroom against heading wraps, fonts and page chrome.
  const target=teacher ? 167 : 158;
  const output=[];
  for(const [index,p] of pages.entries()) {
    if(!p || !Array.isArray(p.blocks))throw new TypeError('Page '+(index+1)+' must contain blocks[]');
    if(!p.blocks.length){output.push(p);continue;}
    let group=[];
    const flush=()=>{if(group.length){output.push({...p,blocks:group});group=[];}};
    for(const b of p.blocks) {
      const proposed=[...group,b];
      if(group.length && contentHeightMm(proposed,teacher)>target)flush();
      group.push(b);
    }
    flush();
  }
  return output;
}

/** Recover once the real renderer reports a vertical overflow. Never shrink work areas. */
export function repackOverflowPages(pages,report,teacher=false) {
  const issues=Array.isArray(report?.issues)?report.issues:[];
  const vertical=issues.filter(x=>/content overlaps footer|task overlaps footer|missing or fragmented page structure/i.test(String(x)));
  if(!vertical.length && !(Number(report?.pageCount)>pages.length))return {pages,changed:false};
  const suspects=new Set();
  for(const issue of vertical) {
    const match=String(issue).match(/Page\s+(\d+)/i);
    if(match)suspects.add(Math.min(pages.length-1,Number(match[1])-1));
  }
  const structural=Number(report?.pageCount)>pages.length || vertical.some(x=>/fragmented/.test(x));
  const output=[];
  let changed=false;
  for(const [index,p] of pages.entries()) {
    const blocks=p.blocks||[];
    if(blocks.length<2 || (!structural && !suspects.has(index))) {
      output.push(p); continue;
    }
    const total=contentHeightMm(blocks,teacher);
    let accum=0, cut=1;
    for(let i=0;i<blocks.length-1;i++) {
      accum+=blockHeightMm(blocks[i],teacher)+(i ? 3.6 : 0);
      if(accum<=total/2)cut=i+1;
      else break;
    }
    cut=Math.max(1,Math.min(blocks.length-1,cut));
    output.push({...p,blocks:blocks.slice(0,cut)}, {...p,blocks:blocks.slice(cut)});
    changed=true;
  }
  return {pages:output,changed};
}
