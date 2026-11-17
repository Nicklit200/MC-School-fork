package com.mcschool.flashcard.lessons;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
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
            String expression = text(task, "expression", 200, true);
            String answer = text(task, "answer", 130, true);
            String solution = text(task, "solutionText", 280, true);
            String kind = text(task, "kind", 20, true);
            String variable = text(task, "variable", 8, false);
            Object rawTokens = task.get("mathTokens");
            if(!(rawTokens instanceof List<?> tokens) || tokens.isEmpty() || tokens.size()>20)
                throw new IllegalArgumentException("HOMEWORK_CONTENT_MATH_TOKENS");
            List<String> display = new ArrayList<>();
            for(Object token:tokens) {
                if(!(token instanceof String t) || t.isBlank() || t.length()>60
                        || t.codePoints().anyMatch(Character::isISOControl))
                    throw new IllegalArgumentException("HOMEWORK_CONTENT_MATH_TOKEN_INVALID");
                display.add(t);
            }

            // The blank in the student expression is mandatory; the actual answer
            // must exist only in the teacher key and the server-side algebra QA.
            if(!display.contains("_____") || display.get(display.size()-1).equals(answer))
                throw new IllegalArgumentException("HOMEWORK_CONTENT_ANSWER_LEAKAGE");
            if(display.stream().noneMatch(t -> "=".equals(t)))
                throw new IllegalArgumentException("HOMEWORK_CONTENT_EQUALS_MISSING");
            verifyPedagogicalTitle(title,expression,display);
            Object math = displayMath(display);
            String label = String.format("%02d", i+1);
            Map<String,Object> exercise = new LinkedHashMap<>();
            exercise.put("type","exercise");
            exercise.put("number",label);
            exercise.put("title",title);
            if(!description.isBlank())exercise.put("description",description);
            exercise.put("rows",List.of(Map.of("label","", "math",math, "work",true)));
            exercise.put("writeLines",6);
            studentBlocks.add(exercise);

            // Never trust a free-form explanation as an unchecked teacher answer.
            // Render the same expression and proposed answer that SymPy checks
            // in qa.algebra; the teacher may explain steps live.
            String checkedAnswer = kind.equals("solution")
                    ? expression + "  →  " + variable + " = " + answer
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
                    assertion.put("kind","solution");
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
        document.put("teacherPages",List.of(Map.of(
                "title","Lösungen",
                "subtitle","Nur für Lehrkräfte",
                "blocks",List.of(Map.of("type","solutions", "section",topic,
                        "title","Antworten", "items",answers)))));
        document.put("qa",Map.of("algebra",assertions));

        // Same MCH3 school validation used for manually-authored homework.
        String source = mapper.writeValueAsString(document);
        return McpHomeworkDraftValidator.normalize(mapper,source,day,totalDays,studentName);
    }

    /**
     * Never show a single-level slash for a fraction. The legacy token renderer
     * only stacks numeric n/d, and would print (3x-2)/4 as plain text.
     * Convert all supported fractional tokens into one safe MathJax TeX object.
     * Unknown slash notation is rejected, rather than silently degrading typography.
     */
    static Map<String,Object> displayMath(List<String> tokens) {
        if(tokens.stream().noneMatch(t -> t.contains("/")))
            return Map.of("tokens",tokens);
        List<String> latex=new ArrayList<>();
        for(String token:tokens) latex.add(tokenLatex(token));
        return Map.of("latex",String.join(" ",latex));
    }

    private static String tokenLatex(String token) {
        return switch(token) {
            case "+" -> "+";
            case "-" , "−" -> "-";
            case "×", "·", "*" -> "\\cdot";
            case "÷", ":" -> "\\div";
            case "=" -> "=";
            case "_____" -> "\\underline{\\qquad\\qquad}";
            case "(" -> "(";
            case ")" -> ")";
            case "□" -> "\\square";
            default -> fractionOrAlgebra(token);
        };
    }

    private static String fractionOrAlgebra(String token) {
        String src=token.replace('−','-').trim();
        if(!src.contains("/"))return termLatex(src);
        // Parenthesized fractions, like ((3x-2)/4), retain their stacked shape.
        while(isFullyWrapped(src)) src=src.substring(1,src.length()-1).strip();
        int depth=0,divide=-1;
        for(int i=0;i<src.length();i++) {
            char c=src.charAt(i);
            if(c=='(')depth++;
            if(c==')')depth--;
            if(depth<0)throw new IllegalArgumentException("HOMEWORK_CONTENT_INVALID_FRACTION");
            if(c=='/'&&depth==0) {
                if(divide>=0)throw new IllegalArgumentException("HOMEWORK_CONTENT_SPLIT_FRACTIONS_INTO_TOKENS");
                divide=i;
            }
        }
        if(depth!=0||divide<0)
            throw new IllegalArgumentException("HOMEWORK_CONTENT_UNSUPPORTED_FRACTION");
        String numerator=src.substring(0,divide).strip();
        String denominator=src.substring(divide+1).strip();
        while(isFullyWrapped(numerator))numerator=numerator.substring(1,numerator.length()-1).strip();
        while(isFullyWrapped(denominator))denominator=denominator.substring(1,denominator.length()-1).strip();
        if(denominator.equals("0")||denominator.isBlank())
            throw new IllegalArgumentException("HOMEWORK_CONTENT_ZERO_DENOMINATOR");
        return "\\frac{"+termLatex(numerator)+"}{"+termLatex(denominator)+"}";
    }

    private static String termLatex(String token) {
        // Supports one short, flat algebraic numerator/denominator or an operand.
        // No model-supplied TeX commands, HTML, CSS, or opaque slash expressions.
        if(token.isBlank() || token.length()>60
                || !token.matches("[A-Za-z0-9 .+*()\\\\-]+"))
            throw new IllegalArgumentException("HOMEWORK_CONTENT_UNSUPPORTED_MATH_TOKEN");
        return token.replace("*","\\cdot ");
    }

    private static boolean isFullyWrapped(String value) {
        if(!value.startsWith("(")||!value.endsWith(")"))return false;
        int depth=0;
        for(int i=0;i<value.length();i++){
            char c=value.charAt(i);
            if(c=='(')depth++;
            else if(c==')')depth--;
            if(depth==0&&i<value.length()-1)return false;
            if(depth<0)return false;
        }
        return depth==0;
    }

    /**
     * A simple "Bruch vereinfachen" assignment must actually be ONE numeric
     * fraction to shorten, not a division of algebraic expressions in disguise.
     * Algebraic fractions remain possible under an appropriate advanced title.
     */
    static void verifyPedagogicalTitle(String title,String expression,List<String> display) {
        String lower=title.toLowerCase(Locale.GERMAN);
        boolean simpleFraction=lower.contains("bruch vereinfach")
                || lower.contains("brüche vereinfach")
                || lower.contains("bruch kürz")
                || lower.contains("brüche kürz")
                || lower.contains("kürze den bruch")
                || lower.contains("kürze vollständig");
        if(!simpleFraction)return;
        String normalized=expression.replaceAll("\\s+","").replace('−','-');
        if(!normalized.matches("-?[0-9]+/[1-9][0-9]*")
                || display.size()!=3 || !normalized.equals(display.get(0).replace(" ",""))
                || !"=".equals(display.get(1)) || !"_____".equals(display.get(2)))
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
