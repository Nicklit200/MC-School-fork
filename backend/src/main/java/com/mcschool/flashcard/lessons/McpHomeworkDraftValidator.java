package com.mcschool.flashcard.lessons;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import tools.jackson.databind.ObjectMapper;

/**
 * MCH3 seven-day homework authoring contract. ChatGPT writes content, the
 * existing workbook renderer performs the mathematical and physical PDF QA.
 * This class never assigns materials or trusts client-provided permissions.
 */
final class McpHomeworkDraftValidator {
    static final String MARKER = "MCH3_HOMEWORK_DAY_V1:";
    private McpHomeworkDraftValidator() {}

    @SuppressWarnings("unchecked")
    static String normalize(ObjectMapper mapper, String source, int day, String targetName) throws Exception {
        if (day < 1 || day > 7) throw new IllegalArgumentException("homework day must be 1..7");
        if (source == null || source.isBlank() || source.length() > OwnerWorkbookPdfRenderService.MAX_INPUT_CHARS)
            throw new IllegalArgumentException("Homework lessonJson is missing or too long");
        Map<String,Object> doc = mapper.readValue(source, Map.class);
        if (doc == null || !(doc.get("meta") instanceof Map<?,?> rawMeta))
            throw new IllegalArgumentException("Homework lessonJson requires meta");
        if (!(doc.get("workbookPages") instanceof List<?> pages) || pages.size() != 1)
            throw new IllegalArgumentException("Homework day must have exactly one student A4 page");
        if (!(doc.get("teacherPages") instanceof List<?> teacherPages) || teacherPages.isEmpty())
            throw new IllegalArgumentException("Homework day must have private teacher answers");
        if (!(pages.get(0) instanceof Map<?,?> page) || !(page.get("blocks") instanceof List<?> blocks))
            throw new IllegalArgumentException("Homework student page needs structured blocks");
        Map<String,Object> meta = new LinkedHashMap<>((Map<String,Object>)rawMeta);
        Object estimated = meta.get("homeworkEstimatedMinutes");
        if (!(estimated instanceof Number minutes) || minutes.intValue() < 1 ||
                minutes.intValue() > 10 || minutes.doubleValue() != minutes.intValue())
            throw new IllegalArgumentException("meta.homeworkEstimatedMinutes must be 1..10 (including reading and writing)");
        meta.put("homeworkMode", true);
        meta.put("homeworkDay", day);
        doc.put("meta", meta);

        if (day <= 4 && (blocks.isEmpty() || !(blocks.get(0) instanceof Map<?,?> first)
                || !Set.of("callout","explanation","example","text").contains(String.valueOf(first.get("type")))))
            throw new IllegalArgumentException("Days 1..4 require a short explanation at the TOP of the page");
        if (day >= 5 && containsCyrillic(page))
            throw new IllegalArgumentException("Days 5..7 must be fully in German, without Russian text");
        if (containsStudentIdentifier(page, targetName))
            throw new IllegalArgumentException("Student PDF must not contain names, group, calendar dates or day-number headings");
        int count = countTasks(blocks, day, 0);
        if (count < 1 || count > 2)
            throw new IllegalArgumentException("Homework contains " + count + " tasks; at most 2 independent responses per day");
        int lined = countResponseAreas(blocks, 0);
        if (lined < count)
            throw new IllegalArgumentException("Each homework task requires at least 6 full-width handwriting lines (8 mm apart)");
        if (!(doc.get("qa") instanceof Map<?,?> qa) || !(qa.get("algebra") instanceof List<?> assertions))
            throw new IllegalArgumentException("Homework must include qa.algebra for every numbered exercise");
        if (assertions.size() != count)
            throw new IllegalArgumentException("Every homework task needs exactly one linked qa.algebra assertion");
        Set<Integer> found = new HashSet<>();
        for (Object raw : assertions) {
            if (!(raw instanceof Map<?,?> check) || !(check.get("number") instanceof Number num))
                throw new IllegalArgumentException("Homework qa.algebra must include a numeric task number");
            int n = num.intValue();
            if (num.doubleValue() != n || n < 1 || n > count || !found.add(n))
                throw new IllegalArgumentException("Homework qa.algebra numbers must uniquely match tasks 1.." + count);
            String kind = String.valueOf(check.get("kind"));
            if (!Set.of("equivalence","solution","visualValue").contains(kind))
                throw new IllegalArgumentException("Unsupported homework algebra QA assertion kind");
        }
        return mapper.writeValueAsString(doc);
    }

    private static int countTasks(List<?> blocks, int day, int depth) {
        if (depth > 12) throw new IllegalArgumentException("Homework nesting limit exceeded");
        int count = 0;
        for (Object raw : blocks) {
            if (!(raw instanceof Map<?,?> b)) throw new IllegalArgumentException("Invalid homework block");
            String type = String.valueOf(b.get("type"));
            if (Set.of("teacherNote","solutions","schedule","studentHeader").contains(type))
                throw new IllegalArgumentException("Teacher-only or identity blocks are forbidden in homework PDF");
            if (day >= 5 && Set.of("callout","explanation","example").contains(type))
                throw new IllegalArgumentException("Days 5..7 cannot contain explanations or worked examples");
            if ("exercise".equals(type) || "visualTask".equals(type)) {
                count++;
                if ("exercise".equals(type) && b.get("rows") instanceof List<?> rows && rows.size() != 1)
                    throw new IllegalArgumentException("Each homework exercise must contain exactly one answer, not a list of subparts");
                if ("visualTask".equals(type) && b.get("spec") == null)
                    throw new IllegalArgumentException("A graph or geometry task must have a structured spec");
                if (b.get("number") == null) throw new IllegalArgumentException("Homework task number is required");
            }
            if (b.get("children") instanceof List<?> children) count += countTasks(children, day, depth + 1);
            if (b.get("left") instanceof List<?> left) count += countTasks(left, day, depth + 1);
            if (b.get("right") instanceof List<?> right) count += countTasks(right, day, depth + 1);
        }
        return count;
    }

    private static int countResponseAreas(List<?> blocks, int depth) {
        if (depth > 12) throw new IllegalArgumentException("Homework nesting limit exceeded");
        int lines = 0;
        for (Object raw : blocks) {
            if (!(raw instanceof Map<?,?> b)) continue;
            if ("exercise".equals(b.get("type")) && b.get("writeLines") instanceof Number n && n.intValue() >= 6)
                lines++;
            if ("answerLines".equals(b.get("type")) && b.get("lines") instanceof Number n && n.intValue() >= 6) {
                String spacing = String.valueOf(b.containsKey("spacing") ? b.get("spacing") : "8mm");
                if (!"8mm".equals(spacing) && !"9mm".equals(spacing) && !"10mm".equals(spacing))
                    throw new IllegalArgumentException("Homework answer lines require at least 8 mm spacing");
                lines++;
            }
            if (b.get("children") instanceof List<?> ch) lines += countResponseAreas(ch,depth+1);
            if (b.get("left") instanceof List<?> left) lines += countResponseAreas(left,depth+1);
            if (b.get("right") instanceof List<?> right) lines += countResponseAreas(right,depth+1);
        }
        return lines;
    }

    private static boolean containsCyrillic(Object value) {
        if (value instanceof String s) return s.codePoints().anyMatch(code -> Character.UnicodeScript.of(code) == Character.UnicodeScript.CYRILLIC);
        if (value instanceof Map<?,?> map) return map.values().stream().anyMatch(McpHomeworkDraftValidator::containsCyrillic);
        if (value instanceof List<?> list) return list.stream().anyMatch(McpHomeworkDraftValidator::containsCyrillic);
        return false;
    }

    private static boolean containsStudentIdentifier(Map<?,?> page, String targetName) {
        StringBuilder printable = new StringBuilder();
        collectText(page, printable, 0);
        String text=printable.toString().toLowerCase(Locale.ROOT);
        if (text.matches("(?s).*(?:tag\\s*0?[1-7]\\b|день\\s*0?[1-7]\\b|\\b\\d{2}\\.\\d{2}\\.20\\d{2}\\b).*"))
            return true;
        return targetName != null && targetName.strip().length() >= 3 &&
                text.contains(targetName.toLowerCase(Locale.ROOT).strip());
    }

    private static void collectText(Object value, StringBuilder b, int depth) {
        if (depth > 16) return;
        if (value instanceof String s) b.append(s).append(' ');
        else if (value instanceof Map<?,?> map)
            for (var entry : map.entrySet()) if (!"spec".equals(entry.getKey())) collectText(entry.getValue(),b,depth+1);
        else if (value instanceof List<?> list) for (Object one : list) collectText(one,b,depth+1);
    }

    static String seriesMarker(String seriesKey, int day) {
        if (day < 1 || day > 7 || seriesKey == null || seriesKey.length() < 8
                || seriesKey.length() > 128 || seriesKey.codePoints().anyMatch(Character::isISOControl))
            throw new IllegalArgumentException("Series key must contain 8..128 printable characters and day 1..7");
        try {
            String digest=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(seriesKey.getBytes(StandardCharsets.UTF_8)));
            return MARKER + day + ":" + digest;
        } catch (Exception e) { throw new IllegalStateException("Cannot hash homework series key",e); }
    }
}
