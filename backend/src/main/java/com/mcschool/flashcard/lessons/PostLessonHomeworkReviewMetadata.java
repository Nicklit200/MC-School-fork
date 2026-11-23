package com.mcschool.flashcard.lessons;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Describe validated homework without a second AI call or a claim about unobserved pupil errors. */
final class PostLessonHomeworkReviewMetadata {
    private PostLessonHomeworkReviewMetadata() {}

    static Map<String,Object> build(Map<String,Object> content,Map<String,Object> lessonEvidence) {
        String topic=shortText(content.get("topic"),88);
        String subtitle=shortText(content.get("subtitle"),120);
        List<Map<String,Object>> tasks=new ArrayList<>();
        if(content.get("tasks") instanceof List<?> raw) {
            for(Object obj:raw) {
                if(!(obj instanceof Map<?,?> task)) continue;
                Map<String,Object> info=new LinkedHashMap<>();
                info.put("title",shortText(task.get("title"),145));
                info.put("description",shortText(task.get("description"),200));
                // Store a stable mathematical graph fingerprint for cross-day
                // diversity checks. No teacher answer is ever stored here.
                info.put("expression",shortText(PostLessonHomeworkSeriesDiversity.taskKey(task),200));
                tasks.add(info);
            }
        }
        String note="";
        String source="LESSON";
        if(!shortText(lessonEvidence.get("personalTeacherNotes"),260).isBlank()) {
            note=shortText(lessonEvidence.get("personalTeacherNotes"),260);
            source="PERSONAL_TEACHER";
        } else if(!shortText(lessonEvidence.get("lessonHomeworkNotes"),260).isBlank()) {
            note=shortText(lessonEvidence.get("lessonHomeworkNotes"),260);
            source="LESSON_TEACHER";
        } else if(!shortText(lessonEvidence.get("teacherNotes"),260).isBlank()) {
            note=shortText(lessonEvidence.get("teacherNotes"),260);
            source="TEACHER";
        }
        String reason=note.isBlank()
                ? "Повторение и закрепление темы «"+topic+"» по материалам урока."
                : "По указанию преподавателя: "+note;
        Map<String,Object> report=new LinkedHashMap<>();
        report.put("topic",topic);
        report.put("subtitle",subtitle);
        report.put("why",reason);
        report.put("reasonSource",source);
        report.put("tasks",tasks);
        return report;
    }

    private static String shortText(Object value,int maxChars) {
        String cleaned=Objects.toString(value,"").replaceAll("[\r\n\t]+"," ").replaceAll(" +"," ").trim();
        return cleaned.length()<=maxChars?cleaned:cleaned.substring(0,maxChars-1)+"…";
    }
}
