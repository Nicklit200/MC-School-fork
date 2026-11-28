package com.mcschool.flashcard.lessons;

import java.util.*;
import tools.jackson.databind.ObjectMapper;

/** Model selects the actual exercises; the trusted server owns the entire worksheet. */
final class PostLessonHomeworkTaskPlan {
    private PostLessonHomeworkTaskPlan() {}

    private static Map<String,Object> str(){return Map.of("type","string");}
    private static Map<String,Object> enumeration(String... values){return Map.of("type","string","enum",List.of(values));}
    private static Map<String,Object> number(){return Map.of("type","number");}
    private static Map<String,Object> integer(){return Map.of("type","integer");}
    private static Map<String,Object> array(Object items,int min,int max){
        return Map.of("type","array","items",items,"minItems",min,"maxItems",max);
    }
    private static Map<String,Object> object(Map<String,Object> fields){
        return Map.of("type","object","properties",fields,"required",new ArrayList<>(fields.keySet()),"additionalProperties",false);
    }

    static Map<String,Object> schema(int days){
        var series=object(Map.of("kind",enumeration("constant","linear","quadratic","polynomial","sine","cosine","absolute","reciprocal","sqrt","exponential","logarithmic","rational"),
                "parameters",array(number(),1,5),"denominator",array(number(),0,5)));
        var graph=object(Map.of("type",enumeration("graph"),"objective",enumeration("zeros","value","aboveBelow","draw","intersections"),
                "series",array(series,1,2),"xRange",array(number(),2,2),"yRange",array(number(),2,2),
                "at",Map.of("type",List.of("number","null")),"level",Map.of("type",List.of("number","null"))));
        var geometry=object(Map.of("type",enumeration("geometry"),
                "figure",enumeration("triangle","rectangle","quadrilateral","polygon","circle","cube","cuboid","cylinder","cone","sphere"),
                "objective",enumeration("area","perimeter","side","angle","volume","surface"),
                "vertices",array(array(number(),2,2),0,8),"parameters",array(number(),0,3),"index",integer()));
        var fraction=object(Map.of("type",enumeration("fractionCircle"),"parts",integer(),"selected",integer()));
        var task=object(Map.of("kind",enumeration("expression","equation","visual"),"title",str(),
                "description",str(),"expression",str(),"variable",enumeration("","x","y","z","a","b","c","m","n"),
                "restrictions",array(str(),0,8),"visual",Map.of("anyOf",List.of(graph,geometry,fraction,Map.of("type","null"))),
                "sourceReference",str(),"evidenceStatus",enumeration("SOLVED_INDEPENDENT","SOLVED_WITH_HELP","STARTED","UNCLEAR")));
        var day=object(Map.of("day",integer(),"topic",str(),"subtitle",str(),"hint",str(),
                "tasks",array(task,1,2)));
        return object(Map.of("days",array(day,days,days)));
    }

    private static IllegalArgumentException invalid(String code){
        return new IllegalArgumentException("HOMEWORK_TASK_PLAN_"+code);
    }
    private static String text(Map<?,?> obj,String key,int max,boolean required){
        Object raw=obj.get(key);
        if(!(raw instanceof String s))throw invalid("TEXT");
        s=s.strip();
        if(s.length()>max || (required&&s.isBlank()) || s.codePoints().anyMatch(Character::isISOControl))
            throw invalid("TEXT_"+key.toUpperCase(Locale.ROOT));
        return s;
    }
    private static Map<String,Object> map(Object raw){
        if(!(raw instanceof Map<?,?> m))throw invalid("OBJECT");
        Map<String,Object> result=new LinkedHashMap<>();
        m.forEach((key,value)->result.put(String.valueOf(key),value));
        return result;
    }
    private static List<?> list(Object raw){
        if(!(raw instanceof List<?> items))throw invalid("ARRAY");
        return items;
    }

    /** Validate all pending days together, including against durable prior worksheets. */
    static List<Map<String,Object>> compileSeries(ObjectMapper json,Map<String,Object> response,
            List<Integer> pending,int totalDays,String studentName,Map<String,Object> evidence,
            boolean graphLesson)throws Exception {
        if(pending.isEmpty())return List.of();
        List<?> proposed=list(response.get("days"));
        if(proposed.size()!=pending.size())throw invalid("DAY_COUNT");
        Map<Integer,Map<String,Object>> byDay=new HashMap<>();
        for(Object raw:proposed){
            Map<String,Object> day=map(raw);
            if(!(day.get("day") instanceof Number n)||n.doubleValue()!=n.intValue()
                    ||!pending.contains(n.intValue())||byDay.put(n.intValue(),day)!=null)
                throw invalid("DAY_ID");
        }
        List<Object> history=new ArrayList<>();
        if(evidence.get("previousGeneratedHomework") instanceof List<?> prior)history.addAll(prior);
        Set<Map<String,Object>> seenVisual=new HashSet<>();
        List<Map<String,Object>> result=new ArrayList<>();
        for(int day:pending.stream().sorted().toList()){
            Map<String,Object> content=byDay.get(day);
            List<?> tasks=list(content.get("tasks"));
            if(tasks.isEmpty()||tasks.size()>2)throw invalid("TASK_COUNT");
            boolean needsGraph=graphLesson&&day%2==1;
            boolean hasGraph=false;
            for(Object raw:tasks){
                Map<String,Object> task=map(raw);
                if("visual".equals(task.get("kind"))){
                    if(tasks.size()!=1)throw invalid("ONE_VISUAL_PER_PAGE");
                    Map<String,Object> visual=map(task.get("visual"));
                    Map<String,Object> fingerprint=new LinkedHashMap<>(visual);
                    fingerprint.remove("xRange");fingerprint.remove("yRange");
                    if(!seenVisual.add(fingerprint))throw invalid("REPEATED_VISUAL");
                    hasGraph|="graph".equals(visual.get("type"));
                }
            }
            if(needsGraph&&!hasGraph)throw invalid("GRAPH_REQUIRED");
            Map<String,Object> primary=compileDay(json,content,tasks,day,totalDays,studentName,evidence);
            @SuppressWarnings("unchecked") Map<String,Object> summary=(Map<String,Object>)primary.get("review");
            PostLessonHomeworkSeriesDiversity.validate(summary,history,day);
            history.add(Map.of("day",day,"tasks",summary.get("tasks")));
            Map<String,Object> entry=new LinkedHashMap<>();
            entry.put("day",day);
            entry.put("primary",primary);
            // Two pre-approved independent exercises can be rendered individually
            // if the measured A4 or math check rejects the combined worksheet.
            // No new model request, new topic, or fabricated exercise is needed.
            if(tasks.size()==2){
                entry.put("alternatives",List.of(
                        compileDay(json,content,List.of(tasks.get(0)),day,totalDays,studentName,evidence),
                        compileDay(json,content,List.of(tasks.get(1)),day,totalDays,studentName,evidence)));
            }else entry.put("alternatives",List.of());
            result.add(entry);
        }
        return result;
    }

    private static Map<String,Object> compileDay(ObjectMapper json,Map<String,Object> content,List<?> tasks,
            int day,int totalDays,String studentName,Map<String,Object> evidence)throws Exception {
        boolean independent=day==totalDays||day>=5;
        String topic=text(content,"topic",88,true),subtitle=text(content,"subtitle",120,false);
        String hint=text(content,"hint",200,!independent);
        List<Map<String,Object>> blocks=new ArrayList<>(),checks=new ArrayList<>();
        List<String> sources=new ArrayList<>();
        if(!independent)blocks.add(Map.of("type","callout","label","Merke","text",hint));
        for(int i=0;i<tasks.size();i++){
            Map<String,Object> task=map(tasks.get(i));
            int n=i+1;
            String kind=text(task,"kind",20,true),title=text(task,"title",100,true);
            String description=text(task,"description",160,false);
            String expression=text(task,"expression",200,false),variable=text(task,"variable",8,false);
            String source=text(task,"sourceReference",160,false),status=text(task,"evidenceStatus",30,true);
            if(!Set.of("SOLVED_INDEPENDENT","SOLVED_WITH_HELP","STARTED","UNCLEAR").contains(status))
                throw invalid("EVIDENCE");
            if(!source.isBlank())sources.add(source+" ("+status+")");
            List<String> restrictions=new ArrayList<>();
            for(Object restriction:list(task.get("restrictions"))){
                if(!(restriction instanceof String s)||s.isBlank()||s.length()>80||
                        !s.matches("[a-z]\\s*!=\\s*[-+0-9a-z*/(). ^]+"))
                    throw invalid("RESTRICTION");
                restrictions.add(s);
            }
            if(restrictions.size()>8)throw invalid("RESTRICTION");
            if("visual".equals(kind)){
                if(!expression.isBlank()||!variable.isBlank()||!restrictions.isEmpty())throw invalid("VISUAL_FIELDS");
                Map<String,Object> spec=map(task.get("visual"));
                if(!Set.of("graph","geometry","fractionCircle").contains(spec.get("type")))throw invalid("VISUAL_TYPE");
                spec.values().removeIf(Objects::isNull);
                String language=Objects.toString(evidence.get("preferredLanguage"),"").toUpperCase(Locale.ROOT);
                String notes=(Objects.toString(evidence.get("teacherNotes"),"")+" "+Objects.toString(evidence.get("personalTeacherNotes"),"")).toLowerCase(Locale.ROOT);
                boolean german=independent||Set.of("DE","GERMAN","DEUTSCH","DE_DE").contains(language)
                        ||notes.matches("(?s).*(?:nur deutsch|auf deutsch|на немецком|немецком языке).*");
                spec.put("language",german?"de":"ru");
                blocks.add(Map.of("type","visualTask","number",n,"title",title,"spec",spec));
                blocks.add(Map.of("type","answerLines","lines",6,"spacing","8mm"));
                checks.add(Map.of("number",n,"kind","visualValue"));
                continue;
            }
            if(task.get("visual")!=null||expression.isBlank())throw invalid("EXPRESSION");
            String displayKind=switch(kind){
                case "expression" -> "equivalence";
                case "equation" -> "solution";
                default -> throw invalid("KIND");
            };
            PostLessonHomeworkMch3Template.verifyPedagogicalTitle(title,expression);
            Map<String,Object> math=PostLessonHomeworkMath.student(expression,displayKind,variable);
            if(!restrictions.isEmpty()){
                String printed=String.join("; ",restrictions).replace("!=","≠");
                description=(description.isBlank()?"":description+" ")+"("+printed+")";
            }
            Map<String,Object> exercise=new LinkedHashMap<>();
            exercise.put("type","exercise");exercise.put("number",n);exercise.put("title",title);
            if(!description.isBlank())exercise.put("description",description);
            exercise.put("rows",List.of(Map.of("label","","math",math,"work",false)));
            exercise.put("writeLines",6);
            blocks.add(exercise);
            if("expression".equals(kind))
                checks.add(Map.of("number",n,"kind","expressionValue","expression",expression,"restrictions",restrictions));
            else
                checks.add(Map.of("number",n,"kind","equationValue","equation",expression,"variable",variable,"restrictions",restrictions));
        }
        Map<String,Object> meta=Map.of("school","MINDCRAFTI SCHOOL","subject","MATHEMATIK","durationMinutes",30,
                "homeworkEstimatedMinutes",tasks.size()==1?6:9,"homeworkMode",true,"homeworkStudentOnly",true);
        Map<String,Object> document=Map.of("meta",meta,"workbookPages",List.of(Map.of("title",topic,"subtitle",subtitle,"blocks",blocks)),
                "teacherPages",List.of(),"qa",Map.of("algebra",checks));
        String checked=McpHomeworkDraftValidator.normalize(json,json.writeValueAsString(document),day,totalDays,studentName);
        OwnerWorkbookPdfRenderService.validateDocument(json.readValue(checked,Map.class));
        var authored=new WorkbookContentService.Content(checked,String.join("; ",sources),"");
        var review=PostLessonHomeworkCanonicalAdapter.inspect(json,authored,evidence);
        Map<String,Object> metadata=new LinkedHashMap<>(review.review());
        metadata.put("generator","SERVER_TASK_PLAN_V1");
        return Map.of("lessonJson",checked,"review",metadata);
    }
}
