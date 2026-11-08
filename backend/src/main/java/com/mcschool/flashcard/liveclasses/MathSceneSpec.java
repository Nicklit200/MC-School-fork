package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.common.ConflictException;
import java.util.*;
import java.util.regex.Pattern;

/** Declarative scenes, with immutable construction and bounded mutable slider values. */
public final class MathSceneSpec {
    private MathSceneSpec() {}
    private static final Set<String> FUNCTIONS=Set.of("sin","cos","tan","sqrt","abs","ln","exp");
    static Map<String,Object> obj(Object... fields) {
        var p=new LinkedHashMap<String,Object>();for(int i=0;i<fields.length;i+=2)p.put((String)fields[i],fields[i+1]);
        return Map.of("type","object","properties",p,"required",List.copyOf(p.keySet()),"additionalProperties",false);
    }
    static Map<String,Object> str(){return Map.of("type","string");}
    static Map<String,Object> str(int max){return Map.of("type","string","maxLength",max);}
    static Map<String,Object> nullable(){return Map.of("type",List.of("string","null"));}
    static Map<String,Object> num(){return Map.of("type","number");}
    static Map<String,Object> choice(String... values){return Map.of("type","string","enum",List.of(values));}
    static Map<String,Object> arr(Object items){return Map.of("type","array","items",items);}
    public static Map<String,Object> schema(){
        var scene=obj("template",choice("scene"),"language",choice("ru","de"),"title",str(48),"prompt",str(120),
            "bounds",obj("xMin",num(),"xMax",num(),"yMin",num(),"yMax",num()),
            "parameters",arr(obj("name",Map.of("type","string","pattern","^[a-z][a-z0-9_]{0,11}$"),"label",str(32),"min",num(),"max",num(),"step",num(),"value",num())),
            "points",arr(obj("id",str(),"x",str(),"y",str(),"dragX",nullable(),"dragY",nullable())),
            "objects",arr(Map.of("anyOf",List.of(
                obj("kind",choice("segment"),"a",str(),"b",str()),
                obj("kind",choice("polygon"),"points",arr(str())),
                obj("kind",choice("circle"),"center",str(),"radius",str()),
                obj("kind",choice("function"),"expression",str()),
                obj("kind",choice("bars"),"values",arr(obj("label",str(),"expression",str())))))),
            "metrics",arr(obj("label",str(),"expression",str())),"answer",nullable());
        @SuppressWarnings("unchecked") var fields=(Map<String,Object>)scene.get("properties");
        var explanation=new LinkedHashMap<>(fields);explanation.put("answer",Map.of("type","null"));
        var exercise=new LinkedHashMap<>(fields);exercise.put("answer",str());
        exercise.put("metrics",Map.of("type","array","items",obj("label",str(),"expression",str()),"maxItems",0));
        return Map.of("anyOf",List.of(
            Map.of("type","object","properties",explanation,"required",scene.get("required"),"additionalProperties",false),
            Map.of("type","object","properties",exercise,"required",scene.get("required"),"additionalProperties",false)));
    }
    public static final String INSTRUCTIONS="""
        По умолчанию для геометрии, функций и данных используй template=scene. Это общий конструктор, а не готовая картинка.
        Для sin, cos, степеней, произвольных формул и связанных точек ОБЯЗАТЕЛЬНО scene, НЕ graph.
        Например sin(a*x)+b: objects=[{kind:"function",expression:"sin(a*x)+b"}],
        parameters=[{name:"a",label:"Частота",min:0.1,max:3,step:0.1,value:1},
        {name:"b",label:"Сдвиг",min:-2,max:2,step:0.1,value:0},
        {name:"t",label:"Координата точки",min:-6,max:6,step:0.1,value:0}],
        points=[{id:"P",x:"t",y:"sin(a*t)+b",dragX:"t",dragY:null}]. Не заменяй функцию прямой y=x.
        Каждая переменная, включая t для точки, ОБЯЗАТЕЛЬНО объявлена в parameters. Проверь это перед ответом.
        Для столбцов со значениями 2,4,6 используй параметры a,b,c (строчные) и expressions "a","b","c".
        Если нужно найти среднее, answer="(a+b+c)/3", metrics=[]: ответ до решения не показывается.
        title до 48 символов; prompt до 120 символов. language=ru/de. Все поля обязательны.
        bounds={xMin,xMax,yMin,yMax}, значения от -1000 до 1000, размах каждой оси >=0.1. Масштаб осей одинаковый.
        parameters: максимум 6 ползунков {name,label,min,max,step,value}. name: латинская строчная буква и до 11 букв/цифр/_,
        кроме x,pi,sin,cos,tan,sqrt,abs,ln,exp. label до 32 символов. min<max, оба в [-1000,1000], step от 0.001 до max-min.
        points: максимум 12 {id,x,y,dragX,dragY}. id: A,B,C или до 4 заглавных букв/цифр. x,y - выражения строками.
        dragX/dragY=null для фиксированной координаты; для подвижной это имя параметра, и соответствующая x/y равна этому имени.
        objects: максимум 12, можно смешивать любые поддержанные элементы:
        segment {kind,a,b} связывает две разные точки по id;
        polygon {kind,points:[id,...]} минимум 3 разных точки;
        circle {kind,center:id,radius:выражение} радиус положительный;
        function {kind,expression:выражение от x и параметров};
        bars {kind,values:[{label,expression},...]} максимум одна диаграмма, до 8 значений, label до 12 символов,
        столбцы стоят в x=1,2,..., база y=0. Выбери bounds так, чтобы значения и подписи помещались.
        metrics: до 3 {label,expression}, label до 32 символов. Пример площади прямоугольника expression="a*b".
        answer=null без проверки, либо выражение ожидаемого ЧИСЛОВОГО ответа на prompt, зависящее от текущих параметров.
        Если просят поле проверки, answer ОБЯЗАТЕЛЬНО содержит выражение, например "a*b". Пустая строка недопустима.
        Внешние task.instruction, task.expression и task.variable всегда пустые. Условие и ответ находятся внутри visual.
        Не выдавай формальное доказательство или проверку рисунка за проверку числового ответа.
        Выражения до 160 символов: числа, параметры, pi, + - * / ^, скобки, sin(),cos(),tan(),sqrt(),abs(),ln(),exp().
        Тригонометрия в радианах. Умножение пиши явно: 2*a, не 2a. x разрешён только в function.expression.
        Не используй JS, LaTeX, функции нескольких аргументов, ссылки на координаты точек или неизвестные переменные.
        Производные координаты задавай через параметры, например x="r*cos(t)",y="r*sin(t)".
        На странице должна быть хотя бы одна точка или объект. Не добавляй ответ или его формулу в prompt или metrics, если ученица должна найти его сама.
        Для редакции верни всю сцену; для неподдерживаемого построения честно уточни или объясни ограничение текстом.
        """;
    public static void validate(Map<String,Object> scene){
        keys(scene,"template","language","title","prompt","bounds","parameters","points","objects","metrics","answer");
        if(!"scene".equals(scene.get("template"))||!Set.of("ru","de").contains(Objects.toString(scene.get("language"))))throw invalid();
        text(scene.get("title"),48);if(((String)scene.get("title")).isEmpty())throw invalid();text(scene.get("prompt"),120);
        var b=map(scene.get("bounds"));keys(b,"xMin","xMax","yMin","yMax");
        double xmin=number(b.get("xMin"),-1000,1000),xmax=number(b.get("xMax"),-1000,1000),
            ymin=number(b.get("yMin"),-1000,1000),ymax=number(b.get("yMax"),-1000,1000);
        if(xmax-xmin<.1||ymax-ymin<.1)throw invalid();
        var names=new HashSet<String>();
        for(var item:list(scene.get("parameters"),6)){
            var p=map(item);keys(p,"name","label","min","max","step","value");String name=Objects.toString(p.get("name"),"");
            if(!name.matches("[a-z][a-z0-9_]{0,11}")||name.equals("x")||name.equals("pi")||FUNCTIONS.contains(name)||!names.add(name))throw invalid();
            text(p.get("label"),32);double min=number(p.get("min"),-1000,1000),max=number(p.get("max"),-1000,1000);
            if(max<=min)throw invalid();number(p.get("value"),min,max);number(p.get("step"),.001,max-min);
        }
        var points=list(scene.get("points"),12);var ids=new HashSet<String>();
        for(var item:points){
            var p=map(item);keys(p,"id","x","y","dragX","dragY");String id=Objects.toString(p.get("id"),"");
            if(!id.matches("[A-Z][A-Z0-9]{0,3}")||!ids.add(id))throw invalid();
            expression(p.get("x"),names);expression(p.get("y"),names);
            for(var axis:List.of("x","y")){var drag=p.get(axis.equals("x")?"dragX":"dragY");
                if(drag!=null&&(!names.contains(drag)||!Objects.equals(drag,p.get(axis))))throw invalid();}
        }
        var objects=list(scene.get("objects"),12);int bars=0;
        for(var item:objects){var o=map(item);switch(Objects.toString(o.get("kind"),"")){
            case "segment"->{keys(o,"kind","a","b");if(!ids.contains(o.get("a"))||!ids.contains(o.get("b"))||Objects.equals(o.get("a"),o.get("b")))throw invalid();}
            case "polygon"->{keys(o,"kind","points");var refs=list(o.get("points"),12);if(refs.size()<3||new HashSet<>(refs).size()!=refs.size()||!ids.containsAll(refs))throw invalid();}
            case "circle"->{keys(o,"kind","center","radius");if(!ids.contains(o.get("center")))throw invalid();expression(o.get("radius"),names);}
            case "function"->{keys(o,"kind","expression");var graphNames=new HashSet<>(names);graphNames.add("x");expression(o.get("expression"),graphNames);}
            case "bars"->{keys(o,"kind","values");var values=list(o.get("values"),8);if(++bars>1||values.isEmpty())throw invalid();
                for(var v:values){var entry=map(v);keys(entry,"label","expression");text(entry.get("label"),12);expression(entry.get("expression"),names);}}
            default->throw invalid();
        }}
        if(points.isEmpty()&&objects.isEmpty())throw invalid();
        for(var item:list(scene.get("metrics"),3)){var m=map(item);keys(m,"label","expression");text(m.get("label"),32);expression(m.get("expression"),names);}
        if(scene.get("answer")!=null){
            expression(scene.get("answer"),names);if(((String)scene.get("prompt")).isEmpty())throw invalid();
            String answer=((String)scene.get("answer")).replaceAll("\\s","");
            for(var item:list(scene.get("metrics"),3))
                if(answer.equals(((String)map(item).get("expression")).replaceAll("\\s","")))throw invalid();
        }
    }
    /** Only values change during a lesson. A pupil cannot replace the task, its answer or recipient. */
    public static void sameConstruction(Map<String,Object> before,Map<String,Object> after){
        var a=new LinkedHashMap<>(before);var b=new LinkedHashMap<>(after);
        a.put("parameters",withoutValues(before));b.put("parameters",withoutValues(after));
        if(!equivalent(a,b))throw invalid();
    }
    private static List<Object> withoutValues(Map<String,Object> scene){
        var result=new ArrayList<Object>();for(var p:list(scene.get("parameters"),6)){var copy=new LinkedHashMap<>(map(p));copy.remove("value");result.add(copy);}return result;
    }
    private static boolean equivalent(Object a,Object b){
        if(a instanceof Number x&&b instanceof Number y)return x.doubleValue()==y.doubleValue();
        if(a instanceof Map<?,?> x&&b instanceof Map<?,?> y)return x.keySet().equals(y.keySet())&&x.keySet().stream().allMatch(k->equivalent(x.get(k),y.get(k)));
        if(a instanceof List<?> x&&b instanceof List<?> y){if(x.size()!=y.size())return false;for(int i=0;i<x.size();i++)if(!equivalent(x.get(i),y.get(i)))return false;return true;}
        return Objects.equals(a,b);
    }
    static void expression(Object raw,Set<String> names){
        var values=new HashMap<String,Double>();names.forEach(name->values.put(name,1d));evaluate(raw,values);
    }
    static double evaluate(Object raw,Map<String,Double> values){
        if(!(raw instanceof String source)||source.isEmpty()||source.length()>160)throw invalid();
        var matcher=Pattern.compile("(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|[a-z][a-z0-9_]*|\\S").matcher(source);
        var tokens=new ArrayList<String>();while(matcher.find())tokens.add(matcher.group());if(tokens.size()>96)throw invalid();
        class Parser{
            int pos=0;
            String next(){if(pos>=tokens.size())throw invalid();return tokens.get(pos++);}
            int precedence(String s){return switch(s){case "+","-"->1;case "*","/"->2;case "^"->3;default->-1;};}
            double parse(int min,int depth){
                if(depth>20)throw invalid();String token=next();double result;
                if(token.equals("+")||token.equals("-")){result=parse(3,depth+1);if(token.equals("-"))result=-result;}
                else if(token.equals("(")){result=parse(0,depth+1);if(!next().equals(")"))throw invalid();}
                else if(token.matches("[0-9.].*")){try{result=Double.parseDouble(token);if(!Double.isFinite(result)||Math.abs(result)>1e9)throw invalid();}catch(NumberFormatException ex){throw invalid();}}
                else if(FUNCTIONS.contains(token)){if(!next().equals("("))throw invalid();double arg=parse(0,depth+1);if(!next().equals(")"))throw invalid();
                    result=switch(token){case "sin"->Math.sin(arg);case "cos"->Math.cos(arg);case "tan"->Math.tan(arg);case "sqrt"->Math.sqrt(arg);case "abs"->Math.abs(arg);case "ln"->Math.log(arg);default->Math.exp(arg);};}
                else if(token.equals("pi"))result=Math.PI;
                else if(values.containsKey(token))result=values.get(token);else throw invalid();
                while(pos<tokens.size()&&precedence(tokens.get(pos))>=min){String op=next();double b=parse(precedence(op)+(op.equals("^")?0:1),depth+1);
                    result=switch(op){case "+"->result+b;case "-"->result-b;case "*"->result*b;case "/"->result/b;default->Math.pow(result,b);};}
                return result;
            }
        }
        var parser=new Parser();double result=parser.parse(0,0);if(parser.pos!=tokens.size())throw invalid();return result;
    }
    @SuppressWarnings("unchecked") static Map<String,Object> map(Object v){if(!(v instanceof Map<?,?>))throw invalid();return (Map<String,Object>)v;}
    static List<?> list(Object v,int max){if(!(v instanceof List<?> l)||l.size()>max)throw invalid();return l;}
    static void keys(Map<String,Object> v,String... fields){if(!v.keySet().equals(Set.of(fields)))throw invalid();}
    static void text(Object v,int max){if(!(v instanceof String s)||s.length()>max||s.matches("(?s).*[\\x00-\\x1f<>].*"))throw invalid();}
    static double number(Object v,double min,double max){if(!(v instanceof Number n)||!Double.isFinite(n.doubleValue())||n.doubleValue()<min||n.doubleValue()>max)throw invalid();return n.doubleValue();}
    static ConflictException invalid(){return new ConflictException("Invalid mathematical scene");}
}
