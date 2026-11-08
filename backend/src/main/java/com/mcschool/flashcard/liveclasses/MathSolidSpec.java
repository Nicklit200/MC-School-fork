package com.mcschool.flashcard.liveclasses;

import java.util.*;
import static com.mcschool.flashcard.liveclasses.MathSceneSpec.*;

/** A bounded convex mesh, not executable model code or a catalogue of named solids. */
public final class MathSolidSpec {
    private MathSolidSpec() {}
    public static Map<String,Object> schema(){
        return Map.of("anyOf",List.of(schema(false),schema(true)));
    }
    private static Map<String,Object> schema(boolean quiz){
        return obj("template",choice("solid"),"language",choice("ru","de"),"title",str(48),"prompt",str(160),
            "parameters",arr(obj("name",str(),"label",str(32),"min",num(),"max",num(),"step",num(),"value",num())),
            "vertices",arr(obj("id",str(),"x",str(),"y",str(),"z",str())),"faces",arr(arr(str())),
            "segments",arr(obj("a",str(),"b",str(),"label",str(24))),
            "measurements",quiz?Map.of("type","array","items",choice("volume","surfaceArea"),"maxItems",0):arr(choice("volume","surfaceArea")),
            "answer",quiz?choice("volume","surfaceArea"):Map.of("type","null"),"yaw",num(),"pitch",num());
    }
    public static final String INSTRUCTIONS="""
        Для пирамид, призм и других выпуклых многогранников используй template=solid, а не куб и не плоский рисунок.
        Это общий 3D-конструктор: vertices задают вершины {id,x,y,z}, x,y,z - выражения от parameters.
        Плоскость основания обычно xy, высота вдоль z. faces - массивы id вершин каждой грани в обходном порядке.
        Все грани плоские выпуклые, замкнутая оболочка, каждое ребро принадлежит ровно двум граням.
        Не добавляй внутренние грани или незамкнутую поверхность. Дополнительные точки внутри тела допустимы для высот.
        parameters - до 6 ползунков, правила имён и выражений те же, что у scene. Координаты в [-1000,1000].
        vertices: 4-24 точки, faces: 4-24 грани, 3-8 разных вершин на грань. title до 48, prompt до 160 символов.
        segments: до 6 вспомогательных отрезков {a:id,b:id,label}, например высота от вершины к центру основания.
        yaw=-30,pitch=25 по умолчанию; пределы [-180,180],[-90,90]. Пользователь сможет вращать тело.
        measurements=[] или ["volume","surfaceArea"] для показа вычисленных по вершинам объёма/площади поверхности.
        answer=null или "volume"/"surfaceArea" для поля проверки числового ответа, тогда prompt содержит вопрос,
        а measurements НЕ содержит искомую величину. Не включай искомый ответ в title, prompt или подпись ползунка.
        Для квадратной пирамиды со стороной a и высотой h: параметры a,h с min>0;
        vertices=[{id:"A",x:"-a/2",y:"-a/2",z:"0"},{id:"B",x:"a/2",y:"-a/2",z:"0"},
        {id:"C",x:"a/2",y:"a/2",z:"0"},{id:"D",x:"-a/2",y:"a/2",z:"0"},
        {id:"S",x:"0",y:"0",z:"h"},{id:"O",x:"0",y:"0",z:"0"}],
        faces=[["A","B","C","D"],["A","B","S"],["B","C","S"],["C","D","S"],["D","A","S"]],
        segments=[{a:"S",b:"O",label:"h"}]. Объём вычисляет программа, не записывай V в JSON.
        Для треугольной призмы создай 6 вершин, 2 треугольные и 3 четырёхугольные грани с общими рёбрами.
        Не заменяй запрошенную фигуру квадратной пирамидой: создай соответствующие вершины и грани.
        Диапазоны параметров должны сохранять корректное невырожденное тело. Точки граней не перетаскиваются свободно.
        Общие развёртки, кривые поверхности, вогнутые тела и автоматические сечения пока не поддержаны.
        Если запрос требует их, ответь text с точным ограничением. Развёртка готового cube остаётся доступной.
        """;
    public static void validate(Map<String,Object> s){
        keys(s,"template","language","title","prompt","parameters","vertices","faces","segments","measurements","answer","yaw","pitch");
        if(!"solid".equals(s.get("template"))||!Set.of("ru","de").contains(Objects.toString(s.get("language"))))throw invalid();
        text(s.get("title"),48);if(((String)s.get("title")).isEmpty())throw invalid();text(s.get("prompt"),160);
        number(s.get("yaw"),-180,180);number(s.get("pitch"),-90,90);
        var values=new LinkedHashMap<String,Double>();
        for(var item:list(s.get("parameters"),6)){
            var p=map(item);keys(p,"name","label","min","max","step","value");String name=Objects.toString(p.get("name"),"");
            if(!name.matches("[a-z][a-z0-9_]{0,11}")||Set.of("x","pi","sin","cos","tan","sqrt","abs","ln","exp").contains(name)||values.containsKey(name))throw invalid();
            text(p.get("label"),32);double min=number(p.get("min"),-1000,1000),max=number(p.get("max"),-1000,1000);
            if(max<=min)throw invalid();number(p.get("step"),.001,max-min);values.put(name,number(p.get("value"),min,max));
        }
        var points=new LinkedHashMap<String,double[]>();var vertices=list(s.get("vertices"),24);if(vertices.size()<4)throw invalid();
        for(var item:vertices){var v=map(item);keys(v,"id","x","y","z");String id=Objects.toString(v.get("id"),"");
            if(!id.matches("[A-Z][A-Z0-9]{0,3}")||points.containsKey(id))throw invalid();double[] p=new double[3];
            for(int i=0;i<3;i++)p[i]=number(evaluate(v.get(List.of("x","y","z").get(i)),values),-1000,1000);points.put(id,p);
        }
        var faces=new ArrayList<List<String>>();for(var raw:list(s.get("faces"),24)){
            var ids=list(raw,8);if(ids.size()<3||new HashSet<>(ids).size()!=ids.size()||!points.keySet().containsAll(ids))throw invalid();
            faces.add(ids.stream().map(String.class::cast).toList());
        }if(faces.size()<4)throw invalid();
        for(var item:list(s.get("segments"),6)){var e=map(item);keys(e,"a","b","label");text(e.get("label"),24);
            if(!points.containsKey(e.get("a"))||!points.containsKey(e.get("b"))||Objects.equals(e.get("a"),e.get("b")))throw invalid();}
        var measures=list(s.get("measurements"),2);if(new HashSet<>(measures).size()!=measures.size()||!Set.of("volume","surfaceArea").containsAll(measures))throw invalid();
        if(s.get("answer")!=null&&(!Set.of("volume","surfaceArea").contains(s.get("answer"))||measures.contains(s.get("answer"))||((String)s.get("prompt")).isEmpty()))throw invalid();
        geometry(points,faces);
    }
    public static void sameConstruction(Map<String,Object> a,Map<String,Object> b){
        var x=new LinkedHashMap<>(a);var y=new LinkedHashMap<>(b);for(var field:List.of("yaw","pitch")){x.remove(field);y.remove(field);}MathSceneSpec.sameConstruction(x,y);
    }
    static double[] geometry(Map<String,double[]> points,List<List<String>> faces){
        var hull=new LinkedHashSet<String>();faces.forEach(hull::addAll);double[] center=new double[3];
        for(var id:hull)for(int i=0;i<3;i++)center[i]+=points.get(id)[i]/hull.size();
        double size=1;for(var v:points.values())size=Math.max(size,norm(sub(v,center)));double epsilon=size*1e-7;
        var edges=new HashMap<String,Integer>();double area=0,volume=0;
        for(var ids:faces){var vs=ids.stream().map(points::get).toList();double[] n=cross(sub(vs.get(1),vs.get(0)),sub(vs.get(2),vs.get(0)));double len=norm(n);if(len<1e-8)throw invalid();for(int k=0;k<3;k++)n[k]/=len;
            for(var v:vs)if(Math.abs(dot(n,sub(v,vs.get(0))))>epsilon)throw invalid();
            for(int i=0;i<vs.size();i++){var a=vs.get(i);var e=sub(vs.get((i+1)%vs.size()),a);if(norm(e)<epsilon)throw invalid();
                for(var v:vs)if(dot(cross(e,sub(v,a)),n)<-epsilon)throw invalid();
                String x=ids.get(i),y=ids.get((i+1)%vs.size());String edge=x.compareTo(y)<0?x+":"+y:y+":"+x;edges.merge(edge,1,Integer::sum);
            }
            if(dot(n,sub(vs.get(0),center))<0)for(int k=0;k<3;k++)n[k]=-n[k];
            for(var v:points.values())if(dot(n,sub(v,vs.get(0)))>epsilon)throw invalid();
            for(int i=1;i<vs.size()-1;i++){double part=norm(cross(sub(vs.get(i),vs.get(0)),sub(vs.get(i+1),vs.get(0))))/2;area+=part;volume+=part*Math.abs(dot(n,sub(vs.get(0),center)))/3;}
        }
        if(edges.values().stream().anyMatch(n->n!=2)||hull.size()-edges.size()+faces.size()!=2||volume<1e-8)throw invalid();
        return new double[]{volume,area};
    }
    private static double[] sub(double[] a,double[] b){return new double[]{a[0]-b[0],a[1]-b[1],a[2]-b[2]};}
    private static double[] cross(double[] a,double[] b){return new double[]{a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]};}
    private static double dot(double[] a,double[] b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
    private static double norm(double[] a){return Math.sqrt(dot(a,a));}
}
