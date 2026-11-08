package com.mcschool.flashcard.lessons;

import java.util.*;

/** Closed data contract. The model supplies parameters, never SVG, HTML or executable code. */
public final class KolinVisualSchema {
    private KolinVisualSchema() {}
    private static Map<String,Object> choice(String... values) { return Map.of("type","string","enum",List.of(values)); }
    private static Map<String,Object> numbers() { return Map.of("type","array","items",Map.of("type","number")); }
    private static Map<String,Object> object(Object... pairs) {
        var fields=new LinkedHashMap<String,Object>();
        for(int i=0;i<pairs.length;i+=2) fields.put((String)pairs[i],pairs[i+1]);
        return Map.of("type","object","properties",fields,"required",List.copyOf(fields.keySet()),"additionalProperties",false);
    }
    public static Map<String,Object> schema() {
        var language=choice("ru","de");
        var series=object("kind",choice("constant","linear","quadratic","polynomial","sine","cosine","absolute","reciprocal","sqrt","exponential","logarithmic","rational"),
                "parameters",numbers(),"denominator",numbers());
        return Map.of("anyOf",List.of(
                object("type",choice("graph"),"language",language,"objective",choice("value","zeros","intersections","draw"),
                        "series",Map.of("type","array","items",series),"at",Map.of("type","number"),"xRange",numbers(),"yRange",numbers()),
                object("type",choice("geometry"),"language",language,
                        "figure",choice("triangle","rectangle","quadrilateral","polygon"),
                        "objective",choice("area","perimeter","side","angle"),
                        "vertices",Map.of("type","array","items",numbers()),"parameters",numbers(),"index",Map.of("type","integer")),
                object("type",choice("geometry"),"language",language,"figure",choice("circle"),
                        "objective",choice("area","perimeter"),"vertices",Map.of("type","array","items",numbers(),"maxItems",0),
                        "parameters",numbers(),"index",Map.of("type","integer","enum",List.of(0))),
                object("type",choice("geometry"),"language",language,"figure",choice("cube","cuboid","cylinder","cone","sphere"),
                        "objective",choice("volume","surface"),"vertices",Map.of("type","array","items",numbers(),"maxItems",0),
                        "parameters",numbers(),"index",Map.of("type","integer","enum",List.of(0))),
                object("type",choice("fractionCircle"),"language",language,"parts",Map.of("type","integer"),"selected",Map.of("type","integer"))));
    }
    public static final String INSTRUCTIONS="""
            Для задания с чертежом kind=visual, visual содержит данные рисунка; instruction, expression, variable="", restrictions=[].
            Для expression/equation visual=null. Не передавай SVG, HTML, URL, код или готовый ответ.
            visual.language=ru или de по языку запроса. Сервер сам составляет точное условие из параметров и вычисляет ответ.
            Graph: objective=value (найти f(at)), zeros (нули в показанном диапазоне), intersections (две функции), draw (построить по формуле на пустой сетке).
            series: constant parameters=[c]; linear=[m,b]; quadratic=[a,b,c]; polynomial=[c0,c1,...] до степени четыре;
            sine/cosine=[amplitude,frequency,phase,offset]; absolute/reciprocal/sqrt=[a,h,k]; exponential/logarithmic=[a,h,k,base];
            rational parameters=[числитель c0,c1,...], denominator=[знаменатель c0,c1,...]. Для остальных denominator=[].
            xRange/yRange имеют два значения min<max, ширина от одного до двадцати; at лежит в xRange.
            value и draw используют одну функцию. zeros/intersections поддерживают только polynomial, constant, linear, quadratic, rational.
            Подбирай диапазон так, чтобы нужные значения/точки были видны. Не ставь at в полюс или вне области определения.
            Geometry: triangle/rectangle/quadrilateral/polygon заданы vertices=[[x,y],...] по порядку обхода выпуклой фигуры; parameters=[].
            Для них objective=area/perimeter/side/angle; index задаёт сторону от вершины index к следующей или угол в вершине index, начиная с нуля.
            Вершины автоматически называются A,B,C,...; условие даст их координаты, единица длины сантиметр. Это задачи на координатную геометрию.
            circle parameters=[radius], objective=area/perimeter; cube=[side], cuboid=[width,depth,height], cylinder/cone=[radius,height], sphere=[radius], objective=volume/surface.
            Для кругов и тел vertices=[], index=0. Все размеры положительные. Рисунки тел схематические.
            fractionCircle: равные доли круга, parts от двух до двадцати четырёх, selected от нуля до parts; задача назвать и сократить закрашенную долю.
            Для теорем, доказательств, произвольных построений или текстовых задач вне этого контракта ответь текстом и объясни доступный вариант; не подменяй задачу.
            """;
}
