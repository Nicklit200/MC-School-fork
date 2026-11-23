package com.mcschool.flashcard.lessons;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Server-side quality gate for a pupil's complete multi-day series.
 *
 * The PDF and algebra validators prove an exercise is well-formed/correct, but
 * they do not detect that the SAME valid exercise was already assigned.
 * Compare the actual math content, not titles, fonts, explanations or PDF bytes.
 * Persisted review_json provides history even after a worker restart/retry.
 */
final class PostLessonHomeworkSeriesDiversity {
    static final String REPEATED_EXPRESSION = "HOMEWORK_CONTENT_REPEATED_EXPRESSION";
    static final String REPEATED_PATTERN = "HOMEWORK_CONTENT_REPEATED_PATTERN";
    private static final Pattern SIMPLE_LINEAR_ZERO = Pattern.compile(
        "^(?:[+-]?\\d+(?:\\.\\d+)?\\*)?[a-z][+-]\\d+(?:\\.\\d+)?=0$");

    private PostLessonHomeworkSeriesDiversity() {}

    static void validate(Map<String,Object> candidate, Object previousDays, int day) {
        List<?> tasks = candidate.get("tasks") instanceof List<?> list ? list : List.of();
        Set<String> used = new HashSet<>();
        Map<Integer, Boolean> previousAllSimple = new HashMap<>();
        if (previousDays instanceof List<?> previous) {
            for (Object prior : previous) {
                if (!(prior instanceof Map<?,?> entry)
                        || !(entry.get("tasks") instanceof List<?> earlier)) continue;
                int priorDay = entry.get("day") instanceof Number number ? number.intValue() : -1;
                boolean allSimple = !earlier.isEmpty();
                for (Object raw : earlier) {
                    if (!(raw instanceof Map<?,?> task)) { allSimple=false; continue; }
                    String key = key(task.get("expression"));
                    if (key.isBlank()) { allSimple=false; continue; }
                    used.add(key);
                    allSimple &= isSimpleLinearZero(key);
                }
                if (priorDay > 0) previousAllSimple.put(priorDay, allSimple);
            }
        }

        boolean currentAllSimple = !tasks.isEmpty();
        for (Object raw : tasks) {
            if (!(raw instanceof Map<?,?> task)) continue;
            String key = taskKey(task);
            if (key.isEmpty()) continue; // Existing field validation will reject it.
            if (!used.add(key)) throw new IllegalArgumentException(REPEATED_EXPRESSION);
            currentAllSimple &= isSimpleLinearZero(key);
        }
        // Avoid three consecutive days of exclusively "ax+b=0" substitution.
        // A numerical check of a proposed zero, or a differently structured
        // linear exercise, is enough. Never demand unstudied advanced topics.
        if (day >= 3 && currentAllSimple
                && previousAllSimple.getOrDefault(day-1, false)
                && previousAllSimple.getOrDefault(day-2, false))
            throw new IllegalArgumentException(REPEATED_PATTERN);
    }

    /** Stable fingerprint for both ordinary math and checked graphical tasks. */
    static String taskKey(Map<?,?> task) {
        if("graph".equals(task.get("kind"))) {
            if(!(task.get("visualGraph") instanceof Map<?,?> graph))
                return "";
            String family=Objects.toString(graph.get("family"),"");
            String objective=Objects.toString(graph.get("objective"),"");
            String coefficients=Objects.toString(graph.get("coefficients"),"");
            String at=Objects.toString(graph.get("at"),"");
            String level=Objects.toString(graph.get("level"),"");
            return key("graph:"+family+":"+objective+":"+coefficients+":"+at+":"+level);
        }
        return key(task.get("expression"));
    }

    static String key(Object value) {
        String expression=Objects.toString(value,"")
                .replace('−','-').replace('–','-')
                .replace('×','*').replace('·','*')
                .replaceAll("\\s+","")
                .toLowerCase(Locale.ROOT);
        if (expression.isBlank()) return "";
        int eq=expression.indexOf('=');
        // Zero equations have the same exercise if the two sides are flipped.
        if (eq>0 && eq==expression.lastIndexOf('=')) {
            String left=expression.substring(0,eq),right=expression.substring(eq+1);
            if ("0".equals(left)) return right+"=0";
            if ("0".equals(right)) return left+"=0";
        }
        return expression;
    }

    private static boolean isSimpleLinearZero(String key) {
        return SIMPLE_LINEAR_ZERO.matcher(key).matches();
    }

    static String repairAdvice(String reason) {
        return REPEATED_EXPRESSION.equals(reason)
            ? "This exact mathematical exercise was already assigned earlier in this student's series, "
              +"or twice on the same day. Change the mathematics, not just the title, wording or layout. "
              +"Compare all expressions in previousGeneratedHomework; every expression must be unique."
            : "The last two daily worksheets already contain only trivial one-step ax+b=0 equations. "
              +"Use a different cognitive action still grounded in the lesson: for example, verify a proposed "
              +"zero by evaluating the function (numeric equivalence), or solve a differently structured "
              +"linear equation only if taught. Do not repeat the same pattern for a third consecutive day.";
    }
}
