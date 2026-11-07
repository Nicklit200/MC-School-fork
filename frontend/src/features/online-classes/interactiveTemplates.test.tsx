import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fractionLabel, graphValue, parseInteractiveSpec, templateScene, triangleMeasures, type InteractiveSpec } from './interactiveTemplates';
import { InteractiveTemplate } from './InteractiveTemplate';
import { foldOperations, undoableOperations, type Operation } from './annotations';
import { parseKolinWorksheet } from '../../api/kolin';

const graph:InteractiveSpec={template:'graph',language:'ru',function:'quadratic',coefficients:[1,-4,3]};
const triangle:InteractiveSpec={template:'triangle',language:'ru',vertices:[[0,0],[3,0],[0,4]]};
const fractions:InteractiveSpec={template:'fractionCircle',language:'ru',parts:12,selected:[0,1,2,3,4,5]};
describe('interactive templates',()=>{
  it('uses independent known mathematical results and a bounded scene',()=>{
    expect(graphValue(graph,1)).toBe(0);expect(graphValue(graph,3)).toBe(0);expect(graphValue(graph,2)).toBe(-1);
    const m=triangleMeasures(triangle.vertices);expect(m.area).toBe(6);expect(m.perimeter).toBe(12);expect(m.angles[0]).toBeCloseTo(90);
    expect(m.angles.reduce((a,b)=>a+b)).toBeCloseTo(180);
    expect(fractionLabel(fractions)).toBe('6/12 = 1/2');expect(fractionLabel({...fractions,selected:[]})).toBe('0/12 = 0/1');
    expect(templateScene(graph).filter(p=>p.kind==='path'&&p.clip)).toHaveLength(1);
  });
  it('rejects scripts, unknown fields, nonfinite values and degenerate triangles',()=>{
    for(const value of [{...graph,html:'<script/>'},{...graph,coefficients:[Infinity,1,2]},
      {...triangle,vertices:[[0,0],[1,1],[2,2]]},{...fractions,selected:[0,0]},{...fractions,parts:25},
      {...fractions,selected:[12]},{...graph,coefficients:['1',2,3]}]) expect(parseInteractiveSpec(value)).toBeUndefined();
    [graph,triangle,fractions].forEach(spec=>expect(parseInteractiveSpec(spec)).toEqual(spec));
  });
  it('makes no requests while dragging coefficients and commits once on release',async()=>{
    const commit=vi.fn().mockResolvedValue('r2');render(<InteractiveTemplate spec={graph} revision="r1" onCommit={commit}/>);
    const slider=screen.getByRole('slider',{name:'a'});
    fireEvent.change(slider,{target:{value:'2'}});fireEvent.change(slider,{target:{value:'3'}});
    expect(commit).not.toHaveBeenCalled();fireEvent.pointerUp(slider);
    await waitFor(()=>expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith({...graph,coefficients:[3,-4,3]},'r1');
    fireEvent.blur(slider);expect(commit).toHaveBeenCalledTimes(1);
  });
  it('keeps the original revision during a competing edit and reports failure',async()=>{
    const commit=vi.fn().mockResolvedValue(undefined);
    const view=render(<InteractiveTemplate spec={graph} revision="r1" onCommit={commit}/>);
    fireEvent.change(screen.getByRole('slider',{name:'a'}),{target:{value:'2'}});
    view.rerender(<InteractiveTemplate spec={{...graph,coefficients:[3,0,1]}} revision="peer-r2" onCommit={commit}/>);
    fireEvent.pointerUp(screen.getByRole('slider',{name:'a'}));
    await screen.findByRole('alert');expect(commit.mock.calls[0][1]).toBe('r1');
    expect(screen.getByRole('slider',{name:'a'})).toBeDisabled();
  });
  it('toggles one sector and has no edit controls in the private preview',async()=>{
    const commit=vi.fn().mockResolvedValue('r2');const view=render(<InteractiveTemplate spec={fractions} revision="r1" onCommit={commit}/>);
    fireEvent.click(screen.getByRole('button',{name:'Доля 1'}));
    await waitFor(()=>expect(commit).toHaveBeenCalledTimes(1));expect(commit.mock.calls[0][0].selected).toEqual([1,2,3,4,5]);
    view.unmount();render(<InteractiveTemplate spec={triangle} disabled/>);expect(screen.queryByRole('button')).toBeNull();
  });
  it('replays teacher creation and pupil interaction consistently, including deletion and restore',()=>{
    const shape={kind:'interactive',x:.08,y:.06,w:.84,h:.55,interactive:graph};
    const op=(id:string,seq:number,actor:string,type:Operation['operationType'],payload:unknown):Operation=>({operationId:id,sequence:seq,actorId:actor,layerOwnerId:actor,operationType:type,payload:JSON.stringify(payload)});
    const added=op('a',1,'teacher','ADD',shape);
    const updated=op('b',2,'student','UPDATE',{...shape,interactive:{...graph,coefficients:[2,0,1]},targetOperationId:'a',baseOperationId:'a'});
    const stale=op('c',3,'teacher','UPDATE',{...shape,targetOperationId:'a',baseOperationId:'a'});
    const operations=[added,updated,stale];
    expect(foldOperations(operations)[0].shape.interactive).toEqual({...graph,coefficients:[2,0,1]});
    expect(undoableOperations(operations,'student')).toEqual([]);
    operations.push(op('d',4,'teacher','UNDO',{targetOperationId:'a'}));expect(foldOperations(operations)).toEqual([]);
    operations.push(op('e',5,'teacher','REDO',{targetOperationId:'a'}));expect(foldOperations(operations)[0].interactionRevision).toBe('b');
    operations.push(op('f',6,'student','CLEAR_LAYER',{}));expect(foldOperations(operations)).toHaveLength(1);
  });
  it('checks draft metadata before displaying an interactive card',()=>{
    const metadata={id:'id',studentId:'pupil',studentName:'Test',state:'READY',taskCount:1,pageCount:1,interactive:[graph]};
    expect(parseKolinWorksheet(metadata)?.interactive).toEqual([graph]);
    expect(parseKolinWorksheet({...metadata,interactive:[{...graph,script:'alert(1)'}]})).toBeUndefined();
    expect(parseKolinWorksheet({...metadata,taskCount:2})).toBeUndefined();
  });
});
