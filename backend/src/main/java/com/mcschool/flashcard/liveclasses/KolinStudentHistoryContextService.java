package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.lessons.StudentLessonHistoryService;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryDetail;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryItem;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only, student-authorized longitudinal context for Kolyn. Previous
 * lessons are fetched through the already established student-history access
 * check, which requires the caller to be this student's assigned teacher.
 * Only authorized pupils in the *current room* are considered; this includes their current teacher's own earlier lessons.
 */
@Service
public class KolinStudentHistoryContextService {
    private static final Pattern HISTORY = Pattern.compile(
        "(?iu)(прошл|последн|раньше|раннее|до этого|ранее|предыдущ|другие занят|другие урок|домаш|задани|тетрад|проходил|проходили|ошиб|помни|вчера|last lesson|previous|history|homework|was haben|früher|letzte stunde|aufgaben)");
    private final KolinTaskRoster roster;
    private final StudentLessonHistoryService history;
    private final HomeworkRepository homework;

    public KolinStudentHistoryContextService(KolinTaskRoster roster,StudentLessonHistoryService history,
                                             HomeworkRepository homework) {
        this.roster=roster;
        this.history=history;
        this.homework=homework;
    }

    @Transactional(readOnly=true)
    public Map<String,Object> read(AuthenticatedUser teacher,OnlineClass room,String question,
                                   KolinChatService.Context context) {
        // A reference to a pupil in the question overrides an unrelated
        // selected tab. Multiple matched pupils require clarification.
        var pupils=roster.read(room);
        String normalized=KolinBoardReviewService.normalize(question);
        var words=Arrays.stream(normalized.split("[^a-z0-9]+")).filter(s->!s.isBlank()).toList();
        var named=pupils.stream().filter(pupil->Arrays.stream(
                KolinBoardReviewService.normalize(pupil.name()).split("[^a-z]+"))
            .filter(name->name.length()>=3).anyMatch(name->words.stream()
                .anyMatch(word->KolinBoardReviewService.nameMatches(name,word)))).toList();
        if(named.size()>1) return Map.of("state","ambiguous_student",
            "note","Ask which student's history is needed. Never mix their records.");
        UUID studentId=named.size()==1?named.get(0).id()
                :context!=null?context.studentId():null;
        if(studentId==null && room.getStudent()!=null) studentId=room.getStudent().getId();
        if(studentId==null) return Map.of("state","select_student");
        UUID id=studentId;
        if(pupils.stream().noneMatch(p->p.id().equals(id)))
            return Map.of("state","not_authorized");
        if(question==null || !HISTORY.matcher(question).find())
            return Map.of("state","not_requested");
        String name=pupils.stream().filter(p->p.id().equals(id)).findFirst().get().name();
        try {
            // Both list() and detail() validate the assigned teacher, student
            // status and actual historical group membership, including older
            // lessons delivered by another teacher. No blind school-wide query.
            var items=history.listForTeacherAssistant(teacher,id);
            var out=new ArrayList<Map<String,Object>>();
            boolean wantsTranscript=Pattern.compile("(?iu)(говорил|сказал|обсуждал|произнос|на прошлом урок|прошлом занят|transkript|transcript|gesagt|spoken|last lesson)")
                .matcher(question).find();
            boolean wantsTasks=Pattern.compile("(?iu)(задан|задач|упражнен|тетрад|домаш|aufgaben|homework|worksheets)")
                .matcher(question).find();
            int budget=0;
            for(StudentLessonHistoryItem entry:items) {
                if(out.size()>=4 || budget>=10500) break;
                if(entry.eventId().equals(room.getEventId()) ||
                   entry.startsAt()==null || entry.endsAt()==null ||
                   entry.endsAt().isAfter(Instant.now())) continue;
                StudentLessonHistoryDetail detail=history.detail(teacher,id,entry.sourceTeacherId(),entry.eventId());
                var row=new LinkedHashMap<String,Object>();
                row.put("eventId",clip(entry.eventId(),180));
                row.put("date",entry.startsAt().toString());
                row.put("title",clip(entry.title(),180));
                row.put("teacher",clip(entry.sourceTeacherName(),100));
                row.put("isGroupLesson",entry.groupName()!=null && !entry.groupName().isBlank());
                put(row,"coveredMaterial",detail.coveredMaterial(),1050);
                put(row,"difficulties",detail.difficulties(),850);
                put(row,"homeworkNotes",detail.homeworkNotes(),850);
                put(row,"lessonPlan",detail.lessonPlan(),600);
                if(wantsTranscript) {
                    if(entry.groupName()!=null && !entry.groupName().isBlank()
                        && !entry.sourceTeacherId().equals(teacher.id())) {
                        row.put("transcriptScope","A prior group conversation under another teacher "
                            + "is not included; it may contain unrelated pupils' speech.");
                    } else {
                        String raw=detail.sonioxTranscriptText()==null||detail.sonioxTranscriptText().isBlank()
                            ? detail.transcriptText():detail.sonioxTranscriptText();
                        put(row,"transcriptExcerpt",raw,1900);
                        if(raw!=null && raw.length()>1900) row.put("transcriptTruncated",true);
                    }
                }
                if(wantsTasks && entry.hasWorkbook()) {
                    // Read only the teacher-authorized historical workbook.
                    // Older sheets with textless PDF scans remain unavailable.
                    try {
                        var file=history.document(teacher,id,entry.sourceTeacherId(),entry.eventId(),"workbook");
                        if(file!=null) put(row,"workbookTextExcerpt",pdfText(file.bytes(),2,1400),1400);
                    } catch(RuntimeException ignored) {
                        row.put("workbookTextState","unavailable");
                    }
                }
                row.put("hasWorkbook",entry.hasWorkbook());
                out.add(row);
                budget+=row.toString().length();
            }
            var assigned=homework.recentKolinHomework(id,7);
            var recent=new ArrayList<Map<String,Object>>();
            for(var task:assigned) {
                var row=new LinkedHashMap<String,Object>();
                row.put("date",task.getStartDate().toString());
                row.put("hasWorksheet",Boolean.TRUE.equals(task.getHasWorksheet()));
                row.put("submitted",task.getSubmittedAt()!=null);
                if(task.getSubmittedAt()!=null) row.put("submittedAt",task.getSubmittedAt().toString());
                put(row,"worksheetFilename",task.getWorksheetFilename(),150);
                if(wantsTasks && recent.size()<2 && Boolean.TRUE.equals(task.getHasWorksheet())) {
                    homework.findByIdAndStudentId(task.getId(),id).ifPresent(detail->
                        put(row,"worksheetTextExcerpt",pdfText(detail.getWorksheetPdf(),2,1100),1100));
                }
                recent.add(row);
            }
            var result=new LinkedHashMap<String,Object>();
            result.put("state","available");
            result.put("studentId",id.toString());
            result.put("studentName",name);
            result.put("pastLessons",out);
            result.put("recentHomework",recent);
            result.put("provenance","Past scheduled lesson entries, preparation notes and saved homework; not proof that all material was actually mastered.");
            result.put("groupCaution","A group transcript or lesson note may mention other pupils. Never attribute a group utterance or mistake to this particular student without direct evidence.");
            result.put("textOnly","A PDF excerpt comes from its text layer. It does not prove anything about handwriting or image-only worksheet pages.");
            return result;
        } catch(com.mcschool.flashcard.common.ResourceNotFoundException |
                org.springframework.web.server.ResponseStatusException ex) {
            return Map.of("state","not_authorized");
        }
    }

    private static void put(Map<String,Object> row,String key,String text,int max) {
        if(text!=null && !text.isBlank()) row.put(key,clip(text,max));
    }
    private static String clip(String text,int max) {
        if(text==null) return "";
        String clean=text.strip();
        return clean.length()>max?clean.substring(0,max):clean;
    }
    static String pdfText(byte[] pdfBytes,int maxPages,int maxChars) {
        if(pdfBytes==null || pdfBytes.length<5 || pdfBytes.length>12_000_000) return "";
        try(var pdf=Loader.loadPDF(pdfBytes)) {
            var stripper=new PDFTextStripper();
            stripper.setStartPage(1);
            stripper.setEndPage(Math.min(maxPages,pdf.getNumberOfPages()));
            return clip(stripper.getText(pdf),maxChars);
        } catch(IOException | IllegalArgumentException ex) {
            return "";
        }
    }
}
