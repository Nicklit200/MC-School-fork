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
    case 'visualTask': return 104; // Includes its own checked vector graph / geometric figure.
    case 'diagram': return 90;
    case 'fractionStrips': return 40;
    case 'numberLine': return 38;
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

// A plot or solid drawing introduces the immediately following task.
// Treat that visual + task (including a two-column exercise grid) as one unit:
// never leave the drawing alone at the bottom of an A4 page.
const visualTypes = new Set(['graph','coordinateGrid','geometry','visualTask','strips']);
const instructionTypes = new Set(['text','explanation','richText']);
function pageUnits(blocks) {
  const units=[];
  for(let i=0;i<blocks.length;i++){
    const current=blocks[i], next=blocks[i+1], after=blocks[i+2];
    if(instructionTypes.has(current?.type) && visualTypes.has(next?.type)){
      // Compiled visual tasks are [instruction, graph]. Keep both on ONE A4.
      // If the graph is followed by exactly one related exercise, keep that too.
      const unit=[current,next];
      if(after?.type==='exercise' && !visualTypes.has(blocks[i+3]?.type)){
        unit.push(after);
        i+=2;
      }else i++;
      units.push(unit);
    }else if(current?.type==='exercise' && visualTypes.has(next?.type) &&
             !(after?.type==='exercise' && !visualTypes.has(blocks[i+3]?.type))){
      // Some lessons put the instruction/exercise BEFORE the coordinate grid.
      units.push([current,next]);
      i++;
    }else if(visualTypes.has(current?.type) && independentTaskCount(next)===1){
      // Never pull a whole grid containing multiple unrelated tasks beside a graph.
      units.push([current,next]);
      i++;
    }else if(visualTypes.has(current?.type) &&
      instructionTypes.has(next?.type) && blockHeightMm(next)<=16 &&
      independentTaskCount(after)===1){
      units.push([current,next,after]);
      i+=2;
    }else{
      units.push([current]);
    }
  }
  return units;
}

/**
 * Adjacent workbook sections may arrive as one exercise per logical page.
 * Recombine only physically compatible pages: never cross chapter/month,
 * lesson time, section heading or other metadata boundaries.
 */
function compatibleStudentSections(a,b) {
  const withoutBlocks=p=>Object.fromEntries(Object.entries(p).filter(([key])=>key!=='blocks'));
  return JSON.stringify(withoutBlocks(a))===JSON.stringify(withoutBlocks(b));
}
function compactStudentSections(pages) {
  const runs=[];
  for(const p of pages) {
    const previous=runs.at(-1);
    if(previous && compatibleStudentSections(previous,p))previous.blocks.push(...p.blocks);
    else runs.push({...p,blocks:[...p.blocks]});
  }
  return runs;
}
const majorVisualTypes=new Set([
  'graph','coordinateGrid','geometry','visualTask','diagram','fractionStrips','numberLine','strips'
]);
function hasMajorVisual(block,depth=0) {
  if(!block || depth>12)return false;
  if(majorVisualTypes.has(block.type))return true;
  const children=block.type==='split'
    ? [...(block.left||[]),...(block.right||[])]
    : block.children||[];
  return children.some(item=>hasMajorVisual(item,depth+1));
}
function independentTaskCount(block,depth=0) {
  if(!block || depth>12)return 0;
  if(block.type==='exercise'||block.type==='taskCard')return 1;
  const children=block.type==='split'
    ? [...(block.left||[]),...(block.right||[])]
    : block.children||[];
  return children.reduce((sum,child)=>sum+independentTaskCount(child,depth+1),0);
}

// Preserve compact one-task graphic layouts, but expand a row/grid/split that
// combines MULTIPLE graphs or multiple independent tasks. Otherwise the renderer
// could place several graph assignments into one narrow A4 row. taskCard remains
// atomic so its statement, plot and answer area are never separated.
const graphTypes = new Set(['graph','coordinateGrid']);
const layoutTypes = new Set(['row','grid','split','column','stack']);
function graphCount(block,depth=0){
  if(!block||depth>12)return 0;
  if(graphTypes.has(block.type) ||
      (block.type==='visualTask' && block.spec?.type==='graph'))return 1;
  const children=block.type==='split'
    ? [...(block.left||[]),...(block.right||[])]
    : block.children||[];
  return children.reduce((total,child)=>total+graphCount(child,depth+1),0);
}
function separateGraphTasks(blocks,depth=0){
  if(depth>12)throw new TypeError('Graph layout nesting is too deep');
  return blocks.flatMap(block=>{
    if(!layoutTypes.has(block?.type) || graphCount(block)===0 ||
       (graphCount(block)===1 && independentTaskCount(block)<=1))return [block];
    const children=block.type==='split'
      ? [...(block.left||[]),...(block.right||[])]
      : block.children||[];
    return separateGraphTasks(children,depth+1);
  });
}

/** Prefer two short/medium exercises per A4, without shrinking their workspace.
 * Major diagrams/graphs reserve a dedicated A4 with their directly related task.
 * The measured WeasyPrint geometry QA still has the final say and can repack.
 */
export function autoPaginatePages(pages,teacher=false) {
  const target=teacher ? 167 : 158;
  const maximum=teacher ? 208 : 194;
  const output=[];
  const input=teacher?pages:compactStudentSections(pages);
  for(const [index,p] of input.entries()) {
    if(!p || !Array.isArray(p.blocks))throw new TypeError('Page '+(index+1)+' must contain blocks[]');
    if(!p.blocks.length){output.push(p);continue;}
    let group=[], taskCount=0;
    const flush=()=>{
      if(group.length){output.push({...p,blocks:group});group=[];taskCount=0;}
    };
    for(const unit of pageUnits(teacher ? p.blocks : separateGraphTasks(p.blocks))) {
      const visual=unit.some(b=>hasMajorVisual(b));
      const anchored=unit.length>1 && majorVisualTypes.has(unit[0]?.type);
      if(anchored && contentHeightMm(unit,teacher)>maximum)
        throw new Error('Page '+(index+1)+': diagram and its next task exceed one A4 page. Use a shorter task or a smaller graph.');
      if(!teacher && visual) {
        // Graphs and constructions cannot share with another independent task.
        flush();
        group.push(...unit);
        flush();
        continue;
      }
      const nextTasks=unit.reduce((sum,b)=>sum+independentTaskCount(b),0);
      // Page-count preference applies only to student worksheets (not compact
      // teacher solutions); no more than two independent exercises per A4.
      if(!teacher && group.length && taskCount+nextTasks>2)flush();
      const proposed=[...group,...unit];
      // For exactly two regular student tasks, allow up to the conservative
      // physical A4 limit. PDF geometry QA will reflow if a real font is taller.
      const limit=anchored || (!teacher && taskCount+nextTasks===2)
        ? maximum : target;
      if(group.length && contentHeightMm(proposed,teacher)>limit)flush();
      group.push(...unit);
      taskCount+=nextTasks;
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
    const units=pageUnits(blocks);
    // Measured reflow is only allowed between visual-task units, never between
    // a graph and its immediately following exercise.
    if(units.length<2 || (!structural && !suspects.has(index))) {
      output.push(p); continue;
    }
    const total=contentHeightMm(blocks,teacher);
    let accum=0,cut=1;
    for(let i=0;i<units.length-1;i++) {
      accum+=contentHeightMm(units[i],teacher)+(i ? 3.6 : 0);
      if(accum<=total/2)cut=i+1;
      else break;
    }
    cut=Math.max(1,Math.min(units.length-1,cut));
    const left=units.slice(0,cut).flat(),right=units.slice(cut).flat();
    output.push({...p,blocks:left}, {...p,blocks:right});
    changed=true;
  }
  return {pages:output,changed};
}
