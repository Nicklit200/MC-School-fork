import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import examples from '../../../e2e/math-solids.json';
import {parseMathSolid,solidGeometry,renderMathSolid,checkSolidAnswer} from './mathSolid';
import {setSceneParameter} from './mathScene';
import {InteractiveTemplate} from './InteractiveTemplate';
const sample=()=>parseMathSolid(structuredClone(examples[0]))!;
describe('general convex solids',()=>{
  it('uses geometry for pyramid, prism, tetrahedron and pentagonal pyramid volumes',()=>{
    const expected=[16,30,12,10*Math.sin(2*Math.PI/5)];
    examples.forEach((raw,i)=>{const s=parseMathSolid(raw);expect(s).toBeDefined();expect(solidGeometry(s!).volume).toBeCloseTo(expected[i],8);});
    expect(solidGeometry(sample()).surfaceArea).toBeCloseTo(16+8*Math.sqrt(13),8);
    expect(solidGeometry(parseMathSolid(examples[1])!).surfaceArea).toBeCloseTo(72,8);
    expect(solidGeometry(sample()).vertexCount).toBe(5); // Auxiliary height foot is not a polyhedron vertex.
  });
  it('updates dimensions and measurements without changing vertex formulas',()=>{
    const s=sample(),next=setSceneParameter(s,'h',6);
    expect(solidGeometry(next).volume).toBeCloseTo(32,8);expect(next.vertices).toEqual(s.vertices);
    expect(parseMathSolid({...s,parameters:s.parameters.map(p=>({...p,value:10000}))})).toBeUndefined();
  });
  it('rejects open, nonplanar and self-intersecting meshes, unknown symbols and executable source',()=>{
    const s=sample();
    expect(parseMathSolid({...s,faces:s.faces.slice(1)})).toBeUndefined();
    expect(parseMathSolid({...s,faces:[['A','C','B','D'],...s.faces.slice(1)]})).toBeUndefined();
    expect(parseMathSolid({...s,vertices:s.vertices.map(v=>v.id==='A'?{...v,z:'.5'}:v)})).toBeUndefined();
    for(const x of ['unknown','window.location','sin(1,2)','1/0'])expect(parseMathSolid({...s,vertices:s.vertices.map(v=>({...v,x}))})).toBeUndefined();
    expect(parseMathSolid({...s,html:'<script>alert(1)</script>'})).toBeUndefined();
  });
  it('preserves measurements through rotations and produces finite drawing primitives',()=>{
    for(const yaw of [-180,-30,0,90,180])for(const pitch of [-90,0,25,90]){
      const s={...sample(),yaw,pitch};expect(parseMathSolid(s)).toBeDefined();
      expect(JSON.stringify(renderMathSolid(s))).not.toMatch(/NaN|Infinity|undefined/);
      expect(solidGeometry(s).volume).toBeCloseTo(16,8);
    }
  });
  it('checks volume using the actual mesh without revealing the answer in measurements',()=>{
    const s={...sample(),answer:'volume' as const,measurements:[],prompt:'Найдите объём.'};
    expect(parseMathSolid(s)).toBeDefined();expect(checkSolidAnswer(s,'16')).toBe('correct');
    expect(checkSolidAnswer(s,'12')).toBe('incorrect');expect(checkSolidAnswer(s,'')).toBe('invalid');
    expect(checkSolidAnswer(setSceneParameter(s,'h',6),'16')).toBe('incorrect');
    expect(parseMathSolid({...s,measurements:['volume']})).toBeUndefined();
  });
  it('commits teacher/pupil dimension and camera changes through the existing revision callback',async()=>{
    const onCommit=vi.fn().mockResolvedValue('r2');render(<InteractiveTemplate spec={sample()} revision="r1" onCommit={onCommit}/>);
    const height=screen.getByRole('slider',{name:'Высота'});fireEvent.change(height,{target:{value:'6'}});fireEvent.pointerUp(height);
    await waitFor(()=>expect(onCommit).toHaveBeenCalledOnce());
    expect(onCommit.mock.calls[0][0].parameters.find((p:{name:string})=>p.name==='h').value).toBe(6);
    expect(onCommit.mock.calls[0][1]).toBe('r1');
    await waitFor(()=>expect(height).toBeEnabled());
    const rotation=screen.getByRole('slider',{name:'Поворот / Drehen'});fireEvent.change(rotation,{target:{value:'45'}});fireEvent.pointerUp(rotation);
    await waitFor(()=>expect(onCommit).toHaveBeenCalledTimes(2));expect(onCommit.mock.calls[1][0].yaw).toBe(45);expect(onCommit.mock.calls[1][1]).toBe('r2');
  });
  it('keeps the unconfirmed preview read-only',()=>{
    render(<InteractiveTemplate spec={sample()} disabled/>);expect(screen.getByRole('img',{name:'Пирамида с высотой'})).toBeInTheDocument();expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
