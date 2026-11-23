package com.mcschool.flashcard.lessons;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import tools.jackson.databind.ObjectMapper;

/**
 * Deterministic MCH3 workbook authoring, shared with the existing PDF renderer.
 *
 * Luna chooses the mathematical content only. No model-supplied layout, metadata,
 * answer-key placement, student identifiers, or per-day PDF page count is trusted.
 * The school workbook validator and algebra/PDF QA still run before publication.
 */
final class PostLessonHomeworkMch3Template {
    private PostLessonHomeworkMch3Template() {}

    static String fromContent(ObjectMapper mapper, Map<String,Object> draft,
            int day, int totalDays, String studentName) throws Exception {
        if(draft == null) throw new IllegalArgumentException("HOMEWORK_CONTENT_MISSING");
        if(totalDays<1 || totalDays>7 || day<1 || day>totalDays)
            throw new IllegalArgumentException("HOMEWORK_DAY_INVALID");
        boolean independent = day==totalDays || day>=5;

        String topic = text(draft, "topic", 88, true);
        String subtitle = text(draft, "subtitle", 120, true);
        String hint = text(draft, "hint", 240, false);
        Object rawTasks = draft.get("tasks");
        if(!(rawTasks instanceof List<?> list) || list.isEmpty() || list.size()>2)
            throw new IllegalArgumentException("HOMEWORK_CONTENT_TASK_COUNT");

        List<Map<String,Object>> studentBlocks = new ArrayList<>();
        if(!independent) {
            if(hint.isBlank()) throw new IllegalArgumentException("HOMEWORK_CONTENT_HINT_MISSING");
            studentBlocks.add(Map.of(
                    "type","callout", "label","Merke", "text",hint));
        }

        List<Map<String,Object>> answers = new ArrayList<>();
        List<Map<String,Object>> assertions = new ArrayList<>();
        for(int i=0;i<list.size();i++) {
            if(!(list.get(i) instanceof Map<?,?> task))
                throw new IllegalArgumentException("HOMEWORK_CONTENT_TASK_INVALID");
            String title = text(task, "title", 145, true);
            String description = text(task, "description", 200, false);
            String kind = text(task, "kind", 20, true);
            String label = String.format("%02d",i+1);

            // Graph tasks use the SAME MCH3 visualTask renderer as teacher workbooks.
            // Only coefficient data enters the diagram. The model cannot inject
            // pixels, SVG, answers, a separate display expression or a fake QA result.
            if("graph".equals(kind)) {
                if(!text(task,"expression",200,false).isBlank()
                        || !text(task,"answer",130,false).isBlank()
                        || !text(task,"variable",8,false).isBlank())
                    throw new IllegalArgumentException("HOMEWORK_GRAPH_ALGEBRA_FIELDS");
                Map<String,Object> spec = graphSpec(task.get("visualGraph"),independent);
                studentBlocks.add(Map.of("type","visualTask","number",i+1,"spec",spec));
                studentBlocks.add(Map.of("type","answerLines","lines",6));
                assertions.add(Map.of("number",i+1,"kind","visualValue"));
                continue;
            }

            if(task.get("visualGraph")!=null)
                throw new IllegalArgumentException("HOMEWORK_ALGEBRA_VISUAL_UNEXPECTED");
            String expression = text(task, "expression", 200, true);
            String answer = text(task, "answer", 130, true);
            String variable = text(task, "variable", 8, false);
            // One authoritative expression feeds both the visible formula and
            // algebra QA. Old mathTokens are deliberately ignored, including
            // blanks, answers or a different problem the model supplied there.
            verifyPedagogicalTitle(title,expression);
            Object math = PostLessonHomeworkMath.student(expression,kind,variable);
            Map<String,Object> exercise = new LinkedHashMap<>();
            exercise.put("type","exercise");
            exercise.put("number",label);
            exercise.put("title",title);
            if(!description.isBlank())exercise.put("description",description);
            exercise.put("rows",List.of(Map.of("label","", "math",math, "work",true)));
            exercise.put("writeLines",6);
            studentBlocks.add(exercise);

            // Never trust a free-form explanation as an unchecked teacher answer.
            String checkedAnswer = kind.equals("solution")
                    ? expression + "  ->  " + variable + " = " + answer
                    : expression + " = " + answer;
            answers.add(Map.of("label",label,"text",checkedAnswer));
            Map<String,Object> assertion = new LinkedHashMap<>();
            assertion.put("number",i+1);
            assertion.put("restrictions",List.of());
            switch(kind) {
                case "equivalence" -> {
                    if(expression.contains("="))throw new IllegalArgumentException("HOMEWORK_CONTENT_EXPRESSION_EQUATION");
                    assertion.put("kind","equivalence");
                    assertion.put("expression",expression);
                    assertion.put("answer",answer);
                }
                case "solution" -> {
                    if(!expression.contains("=") || !variable.matches("[a-z]"))
                        throw new IllegalArgumentException("HOMEWORK_CONTENT_EQUATION_INVALID");
                    assertion.put("kind","linearSolution");
                    assertion.put("equation",expression);
                    assertion.put("solution",Map.of(variable,answer));
                }
                default -> throw new IllegalArgumentException("HOMEWORK_CONTENT_QA_KIND");
            }
            assertions.add(assertion);
        }

        int minutes = list.size()==1 ? 6 : 9;
        Map<String,Object> meta = new LinkedHashMap<>();
        meta.put("school","MINDCRAFTI SCHOOL");
        meta.put("subject","MATHEMATIK");
        meta.put("durationMinutes",30);
        meta.put("homeworkEstimatedMinutes",minutes);

        Map<String,Object> page = new LinkedHashMap<>();
        page.put("title",topic);
        page.put("subtitle",subtitle);
        page.put("blocks",studentBlocks);

        Map<String,Object> document = new LinkedHashMap<>();
        document.put("meta",meta);
        document.put("workbookPages",List.of(page));
        List<Map<String,Object>> teacherBlocks = new ArrayList<>();
        if(!answers.isEmpty())teacherBlocks.add(Map.of("type","solutions",
                "section",topic,"title","Antworten","items",answers));
        else teacherBlocks.add(Map.of("type","teacherNote","label","GRAFIK",
                "title","Grafiklösungen","paragraphs",List.of(
                "Die automatisch geprüften Grafiklösungen folgen auf den Referenzseiten.")));
        document.put("teacherPages",List.of(Map.of(
                "title","Lösungen","subtitle","Nur für Lehrkräfte","blocks",teacherBlocks)));
        document.put("qa",Map.of("algebra",assertions));

        // Same MCH3 school validation used for manually-authored homework.
        String source = mapper.writeValueAsString(document);
        return McpHomeworkDraftValidator.normalize(mapper,source,day,totalDays,studentName);
    }

    private static Map<String,Object> graphSpec(Object raw, boolean independent) {
        if(!(raw instanceof Map<?,?> graph))
            throw new IllegalArgumentException("HOMEWORK_GRAPH_SPEC_REQUIRED");
        String objective = String.valueOf(graph.get("objective"));
        if(!java.util.Set.of("zeros","value","aboveBelow").contains(objective))
            throw new IllegalArgumentException("HOMEWORK_GRAPH_OBJECTIVE");
        String family=String.valueOf(graph.get("family"));
        if(!java.util.Set.of("quadratic","linear").contains(family))
            throw new IllegalArgumentException("HOMEWORK_GRAPH_FAMILY");
        if(!graph.keySet().stream().allMatch(key ->
                java.util.Set.of("family","objective","coefficients","xRange","yRange","at","level").contains(key)))
            throw new IllegalArgumentException("HOMEWORK_GRAPH_UNKNOWN_PROPERTY");
        List<Double> coefficients = boundedNumbers(graph.get("coefficients"),
                "quadratic".equals(family)?3:2,false);
        if(Math.abs(coefficients.get(0))<1e-9)
            throw new IllegalArgumentException("HOMEWORK_GRAPH_DEGENERATE");
        List<Double> xRange = boundedNumbers(graph.get("xRange"),2,true);
        List<Double> yRange = boundedNumbers(graph.get("yRange"),2,true);
        Map<String,Object> spec = new LinkedHashMap<>();
        spec.put("type","graph");
        spec.put("language",independent?"de":"ru");
        spec.put("objective",objective);
        spec.put("series",List.of(Map.of("kind",family,"parameters",coefficients)));
        spec.put("xRange",xRange);
        spec.put("yRange",yRange);
        switch(objective) {
            case "value" -> {
                double at = finiteNumber(graph.get("at"));
                if(at<xRange.get(0)||at>xRange.get(1))
                    throw new IllegalArgumentException("HOMEWORK_GRAPH_AT_OUTSIDE_RANGE");
                spec.put("at",at);
            }
            case "aboveBelow" -> {
                double level = finiteNumber(graph.get("level"));
                if(level<yRange.get(0)||level>yRange.get(1))
                    throw new IllegalArgumentException("HOMEWORK_GRAPH_LEVEL_OUTSIDE_RANGE");
                spec.put("level",level);
            }
            default -> { }
        }
        return spec;
    }

    private static List<Double> boundedNumbers(Object raw,int size,boolean range) {
        if(!(raw instanceof List<?> values) || values.size()!=size)
            throw new IllegalArgumentException("HOMEWORK_GRAPH_NUMBERS");
        List<Double> out = new ArrayList<>();
        for(Object item:values)out.add(finiteNumber(item));
        if(range && (out.get(1)-out.get(0)<1 || out.get(1)-out.get(0)>20))
            throw new IllegalArgumentException("HOMEWORK_GRAPH_RANGE");
        return out;
    }

    private static double finiteNumber(Object raw) {
        if(!(raw instanceof Number n) || !Double.isFinite(n.doubleValue())
                || Math.abs(n.doubleValue())>20)
            throw new IllegalArgumentException("HOMEWORK_GRAPH_NUMBER_INVALID");
        return n.doubleValue();
    }

    /**
     * A simple "Bruch vereinfachen" assignment must actually be ONE numeric
     * fraction to shorten, not a division of algebraic expressions in disguise.
     * Algebraic fractions remain possible under an appropriate advanced title.
     */
    static void verifyPedagogicalTitle(String title,String expression) {
        String lower=title.toLowerCase(Locale.GERMAN);
        boolean simpleFraction=lower.contains("bruch vereinfach")
                || lower.contains("brüche vereinfach")
                || lower.contains("bruch kürz")
                || lower.contains("brüche kürz")
                || lower.contains("kürze den bruch")
                || lower.contains("kürze vollständig");
        if(!simpleFraction)return;
        String normalized=expression.replaceAll("\\s+","").replace('−','-');
        if(!normalized.matches("-?[0-9]+/[1-9][0-9]*"))
            throw new IllegalArgumentException("HOMEWORK_CONTENT_TITLE_MISMATCH_SIMPLE_FRACTION_REQUIRED");
    }

    private static String text(Map<?,?> values,String key,int max,boolean required) {
        Object raw=values.get(key);
        if(!(raw instanceof String s)) {
            if(!required && raw == null)return "";
            throw new IllegalArgumentException("HOMEWORK_CONTENT_"+key.toUpperCase(java.util.Locale.ROOT));
        }
        s=s.strip();
        if(s.length()>max || (required && s.isBlank()) ||
                s.codePoints().anyMatch(Character::isISOControl))
            throw new IllegalArgumentException("HOMEWORK_CONTENT_"+key.toUpperCase(java.util.Locale.ROOT));
        return s;
    }
}
