import {readFileSync} from 'node:fs';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {compileMath} from './mathExpression';
import {parseMathScene,sceneValue,scenePoint,sceneProjection,setSceneParameter,checkSceneAnswer,renderMathScene,type MathScene} from './mathScene';
import {InteractiveTemplate} from './InteractiveTemplate';
const examples=JSON.parse(readFileSync('e2e/math-scenes.json','utf8')) as MathScene[];
describe('general mathematical scenes',()=>{
  it('uses mathematical precedence and rejects code, unknown symbols and unbounded syntax',()=>{
    const calc=(s:string)=>compileMath(s,new Set(['a']))({a:3});
    expect(calc('-2^2')).toBe(-4);expect(calc('2^3^2')).toBe(512);expect(calc('sqrt(a^2+16)')).toBe(5);
    expect(calc('sin(pi/2)')).toBeCloseTo(1);expect(calc('2^-2')).toBe(.25);expect(calc('ln(exp(1))')).toBeCloseTo(1);
    for(const expression of ['window.alert(1)','a=3','Math.sin(1)','constructor','x','sin(1,2)','2a','1;2','1e999','('.repeat(30)+'1'+')'.repeat(30)])
      expect(()=>calc(expression)).toThrow();
  });
  it('links geometric objects, functions and data to the same parameters',()=>{
    for(const example of examples)expect(parseMathScene(example)).toEqual(example);
    const rect=examples[0];expect(scenePoint(rect,rect.points[2])).toEqual([4,3]);expect(sceneValue(rect,'sqrt(a^2+b^2)')).toBe(5);
    const changed=setSceneParameter(rect,'a',6);expect(scenePoint(changed,changed.points[2])).toEqual([6,3]);expect(sceneValue(changed,'a*b')).toBe(18);
    expect(sceneValue(examples[1],'sin(a*x)+b',Math.PI/2)).toBeCloseTo(1);
    expect(checkSceneAnswer(examples[2],'4')).toBe('correct');expect(checkSceneAnswer(setSceneParameter(examples[2],'a',5),'4')).toBe('incorrect');
    expect(checkSceneAnswer(rect,'')).toBe('invalid');expect(checkSceneAnswer(rect,'1/0')).toBe('invalid');
    expect(checkSceneAnswer({...rect,answer:'1/3'},'0,333')).toBe('correct');
    expect(checkSceneAnswer({...rect,answer:'1000000'},'1000001')).toBe('incorrect');
    const bars={...setSceneParameter(examples[2],'a',10),bounds:{xMin:0,xMax:4,yMin:0,yMax:7}};
    expect(sceneProjection(bars).toPixel(1,10)[1]).toBeGreaterThan(100);
    expect(renderMathScene(rect).some(p=>p.kind==='path'&&p.d.includes(' a '))).toBe(true);
  });
  it('fails closed on unknown data and renders undefined domains without a false answer',()=>{
    const rect=examples[0];
    for(const scene of [{...rect,html:'<script/>'},{...rect,answer:'fetch(1)'},
      {...rect,points:[{...rect.points[0],dragX:'a'}]},
      {...rect,objects:[{kind:'segment',a:'A',b:'UNKNOWN'}]},
      {...rect,parameters:[{...rect.parameters[0],value:999}]},
      {...rect,bounds:{...rect.bounds,xMax:-1}},
      {...rect,objects:[{kind:'function',expression:'a.__proto__'}]}])expect(parseMathScene(scene)).toBeUndefined();
    expect(checkSceneAnswer({...rect,answer:'sqrt(-1)'},'0')).toBe('invalid');
    expect(renderMathScene({...rect,objects:[{kind:'function',expression:'1/x'}]}).every(p=>p.kind!=='path'||!p.d.includes('NaN'))).toBe(true);
  });
  it('updates a linked point, commits once, and checks the current numerical answer locally',async()=>{
    const commit=vi.fn().mockResolvedValue('r2');render(<InteractiveTemplate spec={examples[0]} revision="r1" onCommit={commit}/>);
    fireEvent.change(screen.getByRole('slider',{name:'Ширина'}),{target:{value:'6'}});
    expect(commit).not.toHaveBeenCalled();fireEvent.pointerUp(screen.getByRole('slider',{name:'Ширина'}));
    await waitFor(()=>expect(commit).toHaveBeenCalledTimes(1));expect(commit.mock.calls[0][0].parameters[0].value).toBe(6);
    fireEvent.change(screen.getByLabelText('Ваш числовой ответ'),{target:{value:'18'}});fireEvent.click(screen.getByRole('button',{name:'Проверить'}));
    expect(await screen.findByText('Верно')).toBeInTheDocument();expect(commit).toHaveBeenCalledTimes(1);
  });
});
