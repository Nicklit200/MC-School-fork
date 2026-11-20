package com.mcschool.flashcard.lessons;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Reject exclusions inferred from attendance, academic performance, or ambiguous teacher notes.
 * The model may suggest recipients, but only an explicit instruction can remove a pupil.
 * This also validates persisted recipient selections from older generator runs.
 */
final class PostLessonHomeworkRecipientGuard {
    private static final Pattern DIRECT_SKIP = Pattern.compile(
            "(?iu)(?:"
            + "не\\s+(?:задавай(?:те)?|задавать|выдавай(?:те)?|выдавать|"
            + "назначай(?:те)?|назначать|давай(?:те)?|давать)\\s+"
            + "(?:(?:ей|ему|им)\\s+)?(?:домашк[\\p{L}]*|домашн[\\p{L}]*\\s+задан[\\p{L}]*|дз|ничего)"
            + "|не\\s+(?:нужно|надо|следует)\\s+(?:задавать|выдавать|назначать|давать)\\s+"
            + "(?:домашк[\\p{L}]*|домашн[\\p{L}]*\\s+задан[\\p{L}]*|дз|ничего)"
            + "|(?:домашк[\\p{L}]*|домашн[\\p{L}]*\\s+задан[\\p{L}]*|дз)\\s+"
            + "не\\s+(?:задавать|задавай(?:те)?|давать|давай(?:те)?|нужн[\\p{L}]*)"
            + "|(?:без|никакой|никаких|нет)\\s+(?:домашк[\\p{L}]*|домашн[\\p{L}]*\\s+задан[\\p{L}]*|дз)"
            + "|(?:keine?|ohne)\\s+hausaufgaben"
            + "|hausaufgaben\\s+nicht\\s+(?:geben|aufgeben|erteilen|zuweisen)"
            + "|(?:do\\s+not|don't)\\s+(?:assign|give|set)\\s+(?:any\\s+)?(?:homework|assignments)"
            + "|no\\s+homework"
            + ")");
    private static final Pattern BARE_SKIP = Pattern.compile(
            "(?iu)\\bне\\s+(?:задавай(?:те)?|задавать|выдавай(?:те)?|выдавать|"
            + "назначай(?:те)?|назначать|давай(?:те)?|давать)\\s*[.!?,;]?\\s*$");

    private PostLessonHomeworkRecipientGuard() {}

    static Map<String,Object> verify(List<Map<String,Object>> roster, String notes,
                                     Map<String,Object> proposed) {
        String instructions = Objects.toString(notes, "");
        List<?> proposedExclusions = proposed.get("excluded") instanceof List<?> entries
                ? entries : List.of();
        List<Map<String,Object>> accepted = new ArrayList<>();

        for (Object raw : proposedExclusions) {
            if (!(raw instanceof Map<?,?> item)) continue;
            String studentId = Objects.toString(item.get("studentId"), "");
            String quote = Objects.toString(item.get("quote"), "");
            if (quote.isBlank() || !instructions.contains(quote)
                    || !explicitExclusion(quote, instructions)) continue;

            Map<String,Object> intended = roster.stream()
                    .filter(pupil -> studentId.equals(Objects.toString(pupil.get("id"), "")))
                    .findFirst().orElse(null);
            if (intended == null) continue;

            // A quote naming another member cannot be used to exclude this pupil.
            String normalizedQuote = quote.toLowerCase(Locale.ROOT);
            String targetStem = nameStem(Objects.toString(intended.get("name"), ""));
            boolean namesTarget = !targetStem.isEmpty() && normalizedQuote.contains(targetStem);
            boolean namesOther = roster.stream().anyMatch(pupil ->
                    !studentId.equals(Objects.toString(pupil.get("id"), ""))
                    && !nameStem(Objects.toString(pupil.get("name"), "")).isEmpty()
                    && normalizedQuote.contains(nameStem(Objects.toString(pupil.get("name"), ""))));
            if (namesOther && !namesTarget) continue;

            accepted.add(Map.of("studentId", studentId, "quote", quote));
        }

        Map<String,Object> safe = new LinkedHashMap<>(proposed);
        safe.put("excluded", accepted);
        return safe;
    }

    private static boolean explicitExclusion(String quote, String instructions) {
        if (DIRECT_SKIP.matcher(quote).find()) return true;
        if (!BARE_SKIP.matcher(quote).find()) return false;
        // Bare "don't assign" is valid only when the source clause ends there.
        // The partial quote "не задавай" from "не задавай сложные задачи" is NOT an exclusion.
        int index = instructions.indexOf(quote);
        while (index >= 0) {
            int after = index + quote.length();
            while (after < instructions.length() && Character.isWhitespace(instructions.charAt(after)))
                after++;
            if (after == instructions.length() || ",.!?;".indexOf(instructions.charAt(after)) >= 0)
                return true;
            index = instructions.indexOf(quote, index + 1);
        }
        return false;
    }

    private static String nameStem(String name) {
        String first = name.strip().split("\\s+")[0].toLowerCase(Locale.ROOT);
        if (first.isEmpty()) return "";
        return first.substring(0, Math.min(3, first.length()));
    }
}
