package com.mcschool.flashcard.liveclasses;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic, inexpensive indexing of numbered exercises in saved text-layer PDFs.
 * This is a text locator, NOT an OCR system and NOT proof that the layout was read
 * perfectly. It never opens teacher answer keys or calls a language model.
 */
final class KolinExerciseIndex {
    private static final int MAX_TASKS_PER_PAGE = 40;
    static final int MAX_TASK_TEXT = 1800;
    private static final Pattern LABELED = Pattern.compile(
        "(?iu)^\\s*(?:Aufgabe|Task|Exercise|Problem|Задани\\p{L}*|Упражнени\\p{L}*|Задач\\p{L}*|Nr\\.?|№)\\s*([1-9]\\d?)\\s*[.):\\-]?\\s*(.*)$");
    private static final Pattern NUMBERED = Pattern.compile(
        "^\\s*([1-9]\\d?)\\s*[.):\\-]\\s*(.*)$");
    private static final Pattern STANDALONE = Pattern.compile("^\\s*([1-9]\\d?)\\s*$");
    private static final Pattern INLINE = Pattern.compile(
        "^\\s*([1-9]\\d?)\\s+([\\p{Lu}][\\p{L}].*)$");
    private static final Pattern REQUEST_AFTER = Pattern.compile(
        "(?iu)(?:задан\\p{L}*|упражнен\\p{L}*|задач\\p{L}*|пример\\p{L}*|aufgabe|task|exercise|problem)\\s*(?:(?:№|#|номер|nr\\.?)\\s*)?([1-9]\\d?)\\b");
    private static final Pattern REQUEST_BEFORE = Pattern.compile(
        "(?iu)(?<!\\d)([1-9]\\d?)\\s*(?:-?(?:е|ое|я|го|й))?\\s*(?:задан\\p{L}*|упражнен\\p{L}*|задач\\p{L}*|пример\\p{L}*|aufgabe|task|exercise)");
    private static final Pattern ORDINAL = Pattern.compile(
        "(?iu)(перв\\p{L}*|втор\\p{L}*|трет\\p{L}*|треть\\p{L}*|четвер\\p{L}*|пят\\p{L}*|шест\\p{L}*|седьм\\p{L}*|восьм\\p{L}*|девят\\p{L}*|десят\\p{L}*|first|second|third|seventh|erste\\p{L}*|zweite\\p{L}*|siebte\\p{L}*)\\s+(?:задан\\p{L}*|упражнен\\p{L}*|задач\\p{L}*|пример\\p{L}*|aufgabe|task|exercise)");

    record Exercise(int number, int pageNumber, int occurrence, String text, boolean truncated) {}
    private record Heading(int number, String rest) {}
    private KolinExerciseIndex() {}

    static Integer requestedNumber(String question) {
        if (question == null) return null;
        Matcher matcher = REQUEST_AFTER.matcher(question);
        if (matcher.find()) return Integer.parseInt(matcher.group(1));
        matcher = REQUEST_BEFORE.matcher(question);
        if (matcher.find()) return Integer.parseInt(matcher.group(1));
        matcher = ORDINAL.matcher(question);
        if (!matcher.find()) return null;
        String ordinal=matcher.group(1).toLowerCase(Locale.ROOT);
        if (ordinal.startsWith("перв") || ordinal.startsWith("first") || ordinal.startsWith("erst")) return 1;
        if (ordinal.startsWith("втор") || ordinal.startsWith("second") || ordinal.startsWith("zweit")) return 2;
        if (ordinal.startsWith("трет") || ordinal.startsWith("треть") || ordinal.startsWith("third")) return 3;
        if (ordinal.startsWith("четвер")) return 4;
        if (ordinal.startsWith("пят")) return 5;
        if (ordinal.startsWith("шест")) return 6;
        if (ordinal.startsWith("седьм") || ordinal.startsWith("seventh") || ordinal.startsWith("siebt")) return 7;
        if (ordinal.startsWith("восьм")) return 8;
        if (ordinal.startsWith("девят")) return 9;
        if (ordinal.startsWith("десят")) return 10;
        return null;
    }

    static List<Exercise> fromPage(int pageNumber, String text) {
        if (text == null || text.isBlank()) return List.of();
        var found = new ArrayList<Exercise>();
        var current = new StringBuilder();
        Integer number = null;
        int occurrence = 0;
        for (String line : text.replace("\r\n", "\n").split("\n")) {
            Heading heading = heading(line);
            if (heading != null) {
                if (number != null) flush(found,number,pageNumber,occurrence,current);
                if (found.size() >= MAX_TASKS_PER_PAGE) break;
                number = heading.number();
                occurrence++;
                current = new StringBuilder(heading.rest().strip());
            } else if (number != null && !line.isBlank() && current.length() < MAX_TASK_TEXT + 1) {
                if (!current.isEmpty()) current.append("\n");
                current.append(line.strip());
            }
        }
        if (number != null && found.size() < MAX_TASKS_PER_PAGE)
            flush(found,number,pageNumber,occurrence,current);
        return List.copyOf(found);
    }

    private static void flush(List<Exercise> result,int number,int page,int occurrence,StringBuilder source) {
        String text=source.toString().strip();
        if (text.length() < 3) return; // A lone page number is not an assignment.
        boolean truncated=text.length()>MAX_TASK_TEXT;
        if(truncated) text=text.substring(0,MAX_TASK_TEXT);
        result.add(new Exercise(number,page,occurrence,text,truncated));
    }

    private static Heading heading(String line) {
        Matcher explicit=LABELED.matcher(line);
        if (explicit.matches()) return new Heading(Integer.parseInt(explicit.group(1)),explicit.group(2));
        Matcher numbered=NUMBERED.matcher(line);
        if (numbered.matches()) return new Heading(Integer.parseInt(numbered.group(1)),numbered.group(2));
        Matcher alone=STANDALONE.matcher(line);
        if (alone.matches()) return new Heading(Integer.parseInt(alone.group(1)),"");
        Matcher inline=INLINE.matcher(line);
        if (inline.matches() && !inline.group(2).matches("(?iu)(Minuten|Minutes|Punkte|Seiten|Jahre|Credits).*"))
            return new Heading(Integer.parseInt(inline.group(1)),inline.group(2));
        return null;
    }

    /** Never place raw user IDs or source paths in a model-visible task reference. */
    static String id(String scope, long version, Exercise exercise) {
        try {
            String key = scope+":"+version+":"+exercise.pageNumber()+":"+exercise.number()+":"+exercise.occurrence();
            byte[] digest=MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            return "task-"+HexFormat.of().formatHex(digest,0,12);
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("Missing SHA-256", impossible);
        }
    }
}
