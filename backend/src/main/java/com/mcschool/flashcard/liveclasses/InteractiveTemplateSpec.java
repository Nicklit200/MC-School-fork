package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.common.ConflictException;
import java.util.*;
import tools.jackson.databind.ObjectMapper;

/** Closed numeric templates shared by model drafts and untrusted board updates. No executable content. */
public final class InteractiveTemplateSpec {
    private InteractiveTemplateSpec() {}
    private static Map<String,Object> object(Object... entries) {
        var fields=new LinkedHashMap<String,Object>();
        for(int i=0;i<entries.length;i+=2) fields.put((String)entries[i],entries[i+1]);
        return Map.of("type","object","properties",fields,"required",List.copyOf(fields.keySet()),"additionalProperties",false);
    }
    private static Map<String,Object> choice(String... values) { return Map.of("type","string","enum",List.of(values)); }
    private static Map<String,Object> numbers() { return Map.of("type","array","items",Map.of("type","number")); }
    public static Map<String,Object> schema() {
        var language=choice("ru","de");
        return Map.of("anyOf",List.of(
            object("template",choice("graph"),"language",language,"function",choice("linear","quadratic"),"coefficients",numbers()),
            object("template",choice("triangle"),"language",language,"vertices",Map.of("type","array","items",numbers())),
            object("template",choice("fractionCircle"),"language",language,"parts",Map.of("type","integer"),
                "selected",Map.of("type","array","items",Map.of("type","integer")))));
    }
    public static final String INSTRUCTIONS="""
        Интерактивный режим: создай готовый шаблон для исследования, kind=worksheet, все tasks имеют kind=visual.
        visual содержит ТОЛЬКО параметры выбранного интерактивного шаблона. instruction, expression, variable="", restrictions=[].
        template=graph: function=linear, coefficients=[m,b] для y=mx+b; либо quadratic, coefficients=[a,b,c]. Коэффициенты от -10 до 10.
        template=triangle: vertices=[[x,y],[x,y],[x,y]], координаты от -5 до 5, площадь не меньше 0.05.
        template=fractionCircle: parts от 2 до 24; selected содержит номера закрашенных долей от 0 до parts-1 без повторов.
        language=ru или de. Интерфейс сам рисует фигуру, вычисляет значения и даёт управление.
        По умолчанию один интерактивный объект. requestedTaskCount имеет приоритет, максимум пять.
        Не обещай произвольные конструкции, доказательства, автоматическую проверку ответа ученицы или доступ к её рукописи.
        Для неподдерживаемого интерактива дай короткий ответ kind=text, tasks=[], studentId=null.
        """;

    public static Map<String,Object> validate(Map<String,Object> spec) {
        if(spec==null || !("ru".equals(spec.get("language")) || "de".equals(spec.get("language")))) throw invalid();
        String type=Objects.toString(spec.get("template"),"");
        switch(type) {
            case "graph" -> {
                keys(spec,"template","language","function","coefficients");
                if(!("linear".equals(spec.get("function")) || "quadratic".equals(spec.get("function")))) throw invalid();
                var values=list(spec.get("coefficients"),"linear".equals(spec.get("function"))?2:3);
                values.forEach(value -> number(value,-10,10));
            }
            case "triangle" -> {
                keys(spec,"template","language","vertices");
                var vertices=list(spec.get("vertices"),3);
                double[][] p=new double[3][2];
                for(int i=0;i<3;i++) { var pair=list(vertices.get(i),2); p[i][0]=number(pair.get(0),-5,5); p[i][1]=number(pair.get(1),-5,5); }
                double area=Math.abs((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[2][0]-p[0][0])*(p[1][1]-p[0][1]))/2;
                if(area<0.05) throw invalid();
            }
            case "fractionCircle" -> {
                keys(spec,"template","language","parts","selected");
                int parts=integer(spec.get("parts"),2,24);
                if(!(spec.get("selected") instanceof List<?> selected) || selected.size()>parts) throw invalid();
                var seen=new HashSet<Integer>();
                for(var value:selected) if(!seen.add(integer(value,0,parts-1))) throw invalid();
            }
            default -> throw invalid();
        }
        return spec;
    }
    @SuppressWarnings("unchecked")
    public static Map<String,Object> read(Object value) {
        if(!(value instanceof Map<?,?>)) throw invalid();
        return validate((Map<String,Object>)value);
    }
    public static Map<String,Object> shape(Map<String,Object> spec) {
        return Map.of("kind","interactive","x",0.08,"y",0.06,"w",0.84,"h",0.55,"interactive",validate(spec));
    }
    public static void validateShape(Map<String,Object> shape) {
        var allowed=Set.of("kind","x","y","w","h","interactive","targetOperationId","baseOperationId");
        if(!allowed.containsAll(shape.keySet()) || !"interactive".equals(shape.get("kind"))) throw invalid();
        // Fixed frame: interactions may change mathematics, never cover another page or change its ownership.
        for(var e:Map.of("x",0.08,"y",0.06,"w",0.84,"h",0.55).entrySet())
            if(number(shape.get(e.getKey()),0,1)!=e.getValue()) throw invalid();
        read(shape.get("interactive"));
    }
    public static void sameTemplate(Map<String,Object> original,Map<String,Object> next) {
        if(!Objects.equals(original.get("template"),next.get("template")) || !Objects.equals(original.get("language"),next.get("language"))
                || !Objects.equals(original.get("function"),next.get("function"))) throw invalid();
    }
    public static Map<String,Object> payload(String json) { return new ObjectMapper().readValue(json,Map.class); }
    private static void keys(Map<String,Object> spec,String... keys) { if(!spec.keySet().equals(Set.of(keys))) throw invalid(); }
    private static List<?> list(Object value,int size) { if(!(value instanceof List<?> values) || values.size()!=size) throw invalid(); return values; }
    private static double number(Object value,double min,double max) {
        if(!(value instanceof Number n) || !Double.isFinite(n.doubleValue()) || n.doubleValue()<min || n.doubleValue()>max) throw invalid(); return n.doubleValue();
    }
    private static int integer(Object value,int min,int max) { double n=number(value,min,max); if(n!=Math.rint(n)) throw invalid(); return (int)n; }
    private static ConflictException invalid() { return new ConflictException("Invalid interactive template parameters"); }
}
