package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.Role;
import java.util.List;
import java.util.UUID;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CompletedLessonReportTest {
    @Test void reportSelectionRejectsUnrelatedPupilBeforeAnyQueueOrPdfRead() {
        UUID room=UUID.randomUUID(), allowed=UUID.randomUUID(), outsider=UUID.randomUUID();
        var teacher=new AuthenticatedUser(UUID.randomUUID(),null,Role.TEACHER);
        var review=mock(PostLessonSkillReviewService.class);
        var jdbc=mock(JdbcTemplate.class);
        when(review.previewRecipients(teacher,room)).thenReturn(List.of(
                new PostLessonSkillReviewService.ReportRecipient(allowed,"Pupil")));
        var reports=new CompletedLessonReportService(jdbc,new ObjectMapper(),
                mock(PlatformTransactionManager.class),review);
        try {
            assertThrows(ResourceNotFoundException.class,()->reports.enqueue(teacher,room,
                    new CompletedLessonReportService.Request(outsider,UUID.randomUUID(),"test")));
            assertThrows(ResourceNotFoundException.class,()->reports.history(teacher,room,outsider));
            assertThrows(ResourceNotFoundException.class,()->reports.report(teacher,room,outsider,UUID.randomUUID()));
            verifyNoInteractions(jdbc);
        } finally {reports.close();}
    }

    @Test void reportPdfContainsRealExampleAndProvenanceInCyrillic()throws Exception {
        var row=new PostLessonSkillReviewService.ReportObservation("skill","Дроби","INDEPENDENT","CORRECT",
                "WRITING",2,98,"Ученик самостоятельно решил пример.","1/4 + 1/6 = 5/12","personal-test",4);
        var report=new PostLessonSkillReviewService.PreviewReport(UUID.randomUUID(),"Тестовый ученик",
                "READY","",1,2,true,List.of(row));
        byte[] pdf=CompletedLessonReportPdf.render(report,false);
        try(var document=Loader.loadPDF(pdf)){
            assertEquals(1,document.getNumberOfPages());
            String text=new PDFTextStripper().getText(document);
            assertTrue(text.contains("Документ пройденного урока"));
            assertTrue(text.contains("1/4 + 1/6 = 5/12"));
            assertTrue(text.contains("Личная доска, страница 4"));
            assertTrue(text.contains("Проценты знаний не изменены"));
        }
        // The report is stored as structured data; round-trip must retain actual evidence.
        ObjectMapper mapper=new ObjectMapper();
        assertEquals(report,mapper.readValue(mapper.writeValueAsString(report),
                PostLessonSkillReviewService.PreviewReport.class));
    }

    @Test void noEvidenceReportDoesNotInventSolutions()throws Exception{
        var report=new PostLessonSkillReviewService.PreviewReport(UUID.randomUUID(),"Test",
                "NO_EVIDENCE","NO_PUPIL_WORK_OR_SPEECH",1,0,false,List.of());
        try(var document=Loader.loadPDF(CompletedLessonReportPdf.render(report,true))){
            String text=new PDFTextStripper().getText(document);
            assertTrue(text.contains("Keine bestätigten Beobachtungen"));
            assertTrue(text.contains("Keine eindeutig zugeordneten Schülerlösungen"));
            assertFalse(text.contains("KI-Sicherheit"));
        }
    }

    @Test void longEvidenceIsPaginatedInsteadOfClipped()throws Exception {
        var row=new PostLessonSkillReviewService.ReportObservation("skill","Дроби","INDEPENDENT","PARTIAL",
                "WRITING",0,90,"Проверка ".repeat(100),"оченьдлинноеслово".repeat(70)+" END", "personal-test",7);
        var report=new PostLessonSkillReviewService.PreviewReport(UUID.randomUUID(),"Test","READY","",1,1,false,
                List.of(row,row,row,row));
        try(var document=Loader.loadPDF(CompletedLessonReportPdf.render(report,false))){
            assertTrue(document.getNumberOfPages()>1);
            assertTrue(new PDFTextStripper().getText(document).contains("END"));
        }
    }
}
