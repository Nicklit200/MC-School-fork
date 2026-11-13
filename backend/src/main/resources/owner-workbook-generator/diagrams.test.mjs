import assert from 'node:assert/strict';
import { functionAt, functionLabel, graphWarnings, computeIntersections, coordinateGridSvg, graphSvg, geometrySvg, renderDiagram } from './diagrams.mjs';

assert.equal(functionAt({kind:'linear',m:2,b:1},3),7);
assert.equal(functionAt({kind:'quadratic',a:1,b:0,c:-4},2),0);
assert.equal(functionAt({kind:'polynomial',coefficients:[1,2,3]},2),17);
assert.ok(Math.abs(functionAt({kind:'sine',amplitude:2,frequency:1},Math.PI/2)-2)<1e-10);
assert.ok(Math.abs(functionAt({kind:'cosine',amplitude:3,frequency:1},0)-3)<1e-10);
const line={type:'graph',label:'LINEAR',xRange:[-5,5],yRange:[-5,5],series:[{kind:'linear',m:1,b:0,label:'f(x) = x'}],points:[{x:2,y:2,label:'P'}]};
const grid=graphSvg(line);
assert.ok(graphSvg({...line,layoutAlignment:'left'}).includes('preserveAspectRatio="xMinYMid meet"'), 'left option anchors the SVG plot, not only its container');
assert.ok(graphSvg({...line,layoutAlignment:'center'}).includes('preserveAspectRatio="xMidYMid meet"'), 'center option remains available');
assert.ok(grid.includes('clipPath'));
assert.ok(grid.includes('polyline'));
assert.ok(grid.includes('graph-legend'));
assert.ok(grid.includes('P'));
assert.throws(()=>graphSvg({...line,points:[{x:2,y:3,seriesIndex:0}]}),/not on/);
assert.throws(()=>graphSvg({...line,xRange:[-1000,1000]}),/bounds/);
assert.throws(()=>graphSvg({...line,series:[{kind:'javascript',body:'alert(1)'}]}),/Unsupported/);
assert.ok(!renderDiagram({...line,label:'<script>bad</script>'}).includes('<script>'));
const triangle={type:'geometry',figure:'triangle',vertices:[{label:'A',x:0,y:0},{label:'B',x:6,y:0},{label:'C',x:0,y:8}],showSides:true,showAngles:true,unit:'cm'};
const svg=geometrySvg(triangle);
assert.ok(svg.includes('polygon'));
assert.ok(svg.includes('90°'));
assert.ok(svg.includes('10 cm'));
assert.throws(()=>geometrySvg({...triangle,vertices:[{x:0,y:0},{x:1,y:1},{x:2,y:2}]}),/Degenerate/);
assert.throws(()=>geometrySvg({type:'geometry',figure:'rectangle',vertices:[{x:0,y:0},{x:8,y:0},{x:7,y:4},{x:0,y:4}]}),/not perpendicular/);
assert.ok(geometrySvg({type:'geometry',figure:'circle',center:{x:0,y:0},radius:3,unit:'cm'}).includes('>r</text>')); 
assert.ok(geometrySvg({type:'geometry',figure:'rectangle',vertices:[{x:0,y:0},{x:8,y:0},{x:8,y:4},{x:0,y:4}],showSides:true}).includes('8'));
const rectErr={type:'geometry',figure:'rectangle',vertices:[{x:0,y:0},{x:8,y:0},{x:7,y:4},{x:0,y:4}]};
assert.throws(()=>geometrySvg(rectErr));

// Pilot v3: geometry labels are letters and angle symbols, never numeric by default.
const cleanTriangle={type:'geometry',figure:'triangle',vertices:[
  {label:'A',x:0,y:0},{label:'B',x:7,y:0},{label:'C',x:2,y:5}
],unit:'cm'};
const cleanSvg=geometrySvg(cleanTriangle);
for(const vertex of ['A','B','C']) assert.ok(cleanSvg.includes(`>${vertex}</text>`),`missing vertex ${vertex}`);
for(const side of ['a','b','c']) assert.ok(cleanSvg.includes(`>${side}</text>`),`missing side ${side}`);
for(const angle of ['α','β','γ']) assert.ok(cleanSvg.includes(`>${angle}</text>`),`missing angle ${angle}`);
assert.ok(!cleanSvg.includes('paint-order'), 'no unsupported white-stroke text paint order');
assert.ok(!cleanSvg.includes('cm</text>'), 'no numeric sides by default');
const visible=geometrySvg({...cleanTriangle,showSideLabels:false,showAngleLabels:false});
assert.ok(!visible.includes('>α</text>') && !visible.includes('>a</text>'));
// Regression: cuboid dimensions must follow the correct three projected
// edge directions (never cross a face or use the diagonal of the top).
const measuredCuboid=geometrySvg({type:'geometry',figure:'cuboid',width:5,depth:3,height:4,unit:'cm',showMeasuresOnFigure:true});
assert.ok(measuredCuboid.includes('x1="105" y1="134" x2="277" y2="134"'), '5 cm must be horizontal and parallel to AB');
assert.ok(measuredCuboid.includes('x1="289" y1="110" x2="332.68" y2="79.2"'), '3 cm must be parallel to BF (depth)');
assert.ok(measuredCuboid.includes('x1="355" y1="118" x2="355" y2="194"'), '4 cm must be vertical and parallel to BC');
for(const measure of ['5 cm','3 cm','4 cm']) assert.ok(measuredCuboid.includes(measure), `Missing dimension ${measure}`); 
const cube=geometrySvg({type:'geometry',figure:'cube',unit:'cm',side:4});
assert.ok(cube.includes('Würfel') && !cube.includes('4 cm</text>'));
const circleClean=geometrySvg({type:'geometry',figure:'circle',center:{x:0,y:0},radius:3,unit:'cm'});
assert.ok(circleClean.includes('>r</text>') && !circleClean.includes('r = 3 cm'));
assert.ok(geometrySvg({type:'geometry',figure:'circle',center:{x:0,y:0},radius:3,unit:'cm',showRadiusMeasureOnFigure:true}).includes('r = 3 cm'));

// Extended structured graph functions use real domains and coefficient-derived labels.
assert.equal(functionAt({kind:'constant',value:3},-7),3);
assert.equal(functionAt({kind:'absolute',a:2,h:1,k:-3},-2),3);
assert.equal(functionAt({kind:'sqrt',a:2,h:1,k:3},5),7);
assert.equal(functionAt({kind:'sqrt',h:1},0),null);
assert.equal(functionAt({kind:'reciprocal',a:4,h:2,k:1},4),3);
assert.equal(functionAt({kind:'reciprocal',h:2},2),null);
assert.equal(functionAt({kind:'exponential',a:2,base:3,h:1,k:-1},3),17);
assert.equal(functionAt({kind:'logarithmic',base:2,a:3,h:1,k:-2},5),4);
assert.equal(functionAt({kind:'logarithmic',h:1},1),null);
assert.throws(()=>functionAt({kind:'logarithmic',base:1},2),/base/);
assert.throws(()=>functionAt({kind:'exponential',base:0},2),/base/);
const rational={kind:'rational',numerator:[-9,0,1],denominator:[-3,1]};
assert.equal(functionAt(rational,4),7);
assert.equal(functionAt(rational,3),null,'a removable hole remains outside the domain');
assert.equal(functionAt({kind:'rational',numeratorCoefficients:[1],denominatorCoefficients:[1,1]},1),0.5);
assert.throws(()=>functionAt({kind:'rational',numerator:[1],denominator:[0]},1),/denominator/);
assert.throws(()=>functionAt({kind:'rational',numerator:[1],denominator:[1,2,3,4,5,6]},1),/length/);
const piecewise={kind:'piecewise',pieces:[
  {domain:[-5,0],function:{kind:'linear',m:1,b:0}},
  {domain:[0,5],includeEnd:true,function:{kind:'constant',value:2}}
]};
assert.equal(functionAt(piecewise,-1),-1);
assert.equal(functionAt(piecewise,0),2);
assert.equal(functionAt(piecewise,5),2);
assert.equal(functionAt(piecewise,6),null);
assert.throws(()=>functionAt({...piecewise,pieces:[
  {domain:[-1,1],function:{kind:'constant',value:0}},
  {domain:[0,2],function:{kind:'constant',value:1}}
]},0),/overlap/);
assert.throws(()=>functionAt({...piecewise,pieces:[
  {domain:[0,1],includeEnd:true,function:{kind:'constant',value:0}},
  {domain:[1,2],function:{kind:'constant',value:1}}
]},0),/overlap/);
assert.equal(functionLabel({kind:'linear',m:2,b:-1}),'f(x) = 2x - 1');
assert.equal(functionLabel({kind:'quadratic',a:1,b:0,c:-4},1),'g(x) = x^2 - 4');
assert.equal(functionLabel({kind:'constant',value:0}),'f(x) = 0');
assert.equal(functionLabel({kind:'linear',m:0.123456,b:0}),'f(x) = 0.123456x','legend coefficients are not rounded to a different function');
assert.equal(functionLabel({kind:'exponential'}),'f(x) = e^(x)');
assert.equal(graphWarnings({series:[{kind:'linear',m:1,b:0,label:'f(x) = x'}]}).length,0);
assert.equal(graphWarnings({series:[{kind:'linear',m:2,b:0,label:'f(x) = x'}]}).length,1);
assert.ok(graphSvg({...line,series:[{kind:'linear',m:2,b:-1}]}).includes('f(x) = 2x - 1'));
assert.ok(graphSvg({...line,series:[{kind:'linear',m:2,b:0,label:'y = x'}]}).includes('data-graph-warnings'));

// Empty grids share the equal physical axis scale and never contain a curve/legend.
const emptyGrid=coordinateGridSvg({xRange:[-5,5],yRange:[-5,5]});
assert.ok(emptyGrid.includes('clipPath'));
assert.ok(!emptyGrid.includes('polyline') && !emptyGrid.includes('graph-legend'));
assert.ok(renderDiagram({type:'coordinateGrid'}).includes('KOORDINATENSYSTEM'));
assert.ok(!coordinateGridSvg({showAxisLabels:false}).includes('<text'));
const plotRect=emptyGrid.match(/<clipPath[^>]*><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
assert.equal(Number(plotRect[3]),Number(plotRect[4]),'equal x/y world units use equal physical scale');

// Every reciprocal branch is a separate, bounded polyline, even off the sampling grid.
const reciprocalSvg=graphSvg({...line,points:[],series:[{kind:'reciprocal',h:0.013}]});
const polylines=[...reciprocalSvg.matchAll(/<polyline[^>]*points="([^"]+)"/g)].map(m=>m[1].split(' ').map(p=>p.split(',').map(Number)));
assert.equal(polylines.length,2,'vertical asymptote splits the curve');
const [plotLeft,plotTop,plotWidth,plotHeight]=plotRect.slice(1).map(Number);
const poleX=plotLeft+(0.013+5)*plotWidth/10;
for(const points of polylines){
  assert.ok(points.every(p=>p[0]<poleX) || points.every(p=>p[0]>poleX),'no polyline may cross an asymptote');
  assert.ok(points.every(p=>p[0]>=plotLeft-0.001 && p[0]<=plotLeft+plotWidth+0.001 && p[1]>=plotTop-0.001 && p[1]<=plotTop+plotHeight+0.001),'curve coordinates stay inside the axes');
}
const doublePoleSvg=graphSvg({...line,points:[],series:[{kind:'rational',numerator:[1],denominator:[0.000169,-0.026,1]}]});
assert.ok(!doublePoleSvg.includes('NaN') && !doublePoleSvg.includes('Infinity'));
assert.equal([...doublePoleSvg.matchAll(/<polyline /g)].length,2,'an even-order denominator root also splits the graph');
assert.ok(!doublePoleSvg.includes('rational-hole'),'a pole is never marked as a removable hole');
assert.ok(graphSvg({...line,points:[],series:[{kind:'rational',numerator:[-1,0,1],denominator:[-1,1]}]}).includes('rational-hole'));
const piecewiseSvg=graphSvg({...line,points:[],series:[piecewise]});
assert.equal([...piecewiseSvg.matchAll(/<polyline /g)].length,2,'a discontinuous piecewise function has separate paths');
assert.equal([...piecewiseSvg.matchAll(/class="piecewise-endpoint"/g)].length,4,'both open and closed branch endpoints are visible');
assert.throws(()=>graphSvg({...line,series:[{kind:'sqrt'}],points:[{x:-1,y:0,seriesIndex:0}]}),/not on/);
for(const s of [{kind:'absolute'},{kind:'sqrt'},{kind:'exponential',base:2},{kind:'logarithmic',base:2},{kind:'constant',value:1}]){
  const rendered=graphSvg({...line,points:[],series:[s]});
  assert.ok(rendered.includes('polyline') && !rendered.includes('NaN') && !rendered.includes('Infinity'),`render ${s.kind}`);
}

// Intersections are reusable in teacher answers and cannot identify poles as roots.
const intersections=computeIntersections({...line,series:[{kind:'linear',m:2,b:-1},{kind:'linear',m:-1,b:5}]});
assert.equal(intersections.length,1);
assert.ok(Math.abs(intersections[0].x-2)<1e-8 && Math.abs(intersections[0].y-3)<1e-8);
assert.deepEqual(intersections[0].seriesIndices,[0,1]);
assert.equal(computeIntersections({...line,yRange:[-1,1],series:[{kind:'linear',m:2,b:-1},{kind:'linear',m:-1,b:5}]}).length,0);
assert.equal(computeIntersections({...line,series:[{kind:'reciprocal',h:0.013},{kind:'constant',value:0}]}).length,0);
const tangent=computeIntersections({...line,series:[{kind:'quadratic',a:1,b:-0.246,c:0.015129},{kind:'constant',value:0}]});
assert.equal(tangent.length,1,'a double root is an intersection without a sign change');
assert.ok(Math.abs(tangent[0].x-0.123)<1e-6);
assert.equal(computeIntersections({...line,series:[{kind:'quadratic',a:1,b:-0.246,c:0.015129000001},{kind:'constant',value:0}]}).length,0,'a nearby positive minimum must not be classified as a double root');
assert.equal(computeIntersections({...line,series:[rational,{kind:'linear',m:1,b:3}]}).length,0,'coincident curves have no isolated intersection; the hole is not a solution');
assert.equal(computeIntersections({...line,series:[{kind:'absolute'},{kind:'constant',value:2}]}).length,2);
assert.equal(computeIntersections({...line,series:[{kind:'sqrt'},{kind:'constant',value:2}]}).length,1);
const sqrtTangent=computeIntersections({...line,series:[{kind:'sqrt'},{kind:'linear',m:0.5,b:0.5}]});
assert.equal(sqrtTangent.length,1);
assert.ok(Math.abs(sqrtTangent[0].x-1)<1e-5,'numerical tangency without sign change is found');
assert.equal(computeIntersections({...line,series:[{kind:'sine',amplitude:1,frequency:1},{kind:'sine',amplitude:1,frequency:1}]}).length,0,'coincident nonpolynomial functions do not generate hundreds of false points');
const rationalCrossings=computeIntersections({...line,series:[{kind:'rational',numerator:[1],denominator:[0,1]},{kind:'linear',m:1,b:0}]});
assert.equal(rationalCrossings.length,2);
assert.ok(Math.abs(rationalCrossings[0].x+1)<1e-7 && Math.abs(rationalCrossings[1].x-1)<1e-7);
const marked=graphSvg({...line,points:[],showIntersections:true,series:[{kind:'linear',m:2,b:-1},{kind:'linear',m:-1,b:5}]});
assert.ok(marked.includes('graph-intersection') && marked.includes('S(2 | 3)'));

console.log('PASS diagrams: extended functions, domains, discontinuities, intersections, coordinate grid, labels, geometry and v3 compatibility');
