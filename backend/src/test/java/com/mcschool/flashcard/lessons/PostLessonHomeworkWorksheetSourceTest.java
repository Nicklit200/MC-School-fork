package com.mcschool.flashcard.lessons;

import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.Map;
import java.util.List;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;

/** Offline fixtures: no OpenAI call, no assignment to a real pupil. */
class PostLessonHomeworkWorksheetSourceTest {

    @Test void aRealLessonPdfIsAcceptedWithoutTranscription() throws Exception {
        byte[] pdf=worksheetPdf("Berechne: 3/4 + 1/8");
        var source=PostLessonHomeworkJobService.inspectWorksheet(pdf,"personal");
        assertNotNull(source);
        assertEquals("personal",source.source());
        assertEquals(1,source.pages());
        assertTrue(source.text().contains("3/4 + 1/8"));
        assertArrayEquals(pdf,source.pdf());
    }

    @Test void invalidAndOversizedFilesNeverBecomeLessonEvidence() {
        assertNull(PostLessonHomeworkJobService.inspectWorksheet("not a pdf".getBytes(),"personal"));
        assertNull(PostLessonHomeworkJobService.inspectWorksheet(new byte[8_000_001],"personal"));
    }

    @SuppressWarnings("unchecked")
    @Test void aiReceivesWorksheetAsPdfAndTeacherWordsAsTextNotBase64Text() throws Exception {
        byte[] pdf=worksheetPdf("Vereinfache: 4x + 3x");
        String encoded=Base64.getEncoder().encodeToString(pdf);
        Map<String,Object> evidence=Map.of(
            "homeworkPrompt","SCHOOL PROMPT",
            "teacherNotes","Bitte schwierigere Terme üben",
            "lessonWorksheetText","Vereinfache: 4x + 3x",
            "_lessonWorksheetPdfBase64",encoded);
        Object result=PostLessonHomeworkContentService.inputWithWorksheet(evidence,new ObjectMapper());
        assertInstanceOf(List.class,result);
        var messages=(List<Map<String,Object>>)result;
        var content=(List<Map<String,Object>>)messages.get(0).get("content");
        String instructions=String.valueOf(content.get(0).get("text"));
        assertTrue(instructions.contains("SCHOOL PROMPT"));
        assertTrue(instructions.contains("Bitte schwierigere Terme üben"));
        assertTrue(instructions.contains("4x + 3x"));
        assertFalse(instructions.contains(encoded));
        assertFalse(instructions.contains("_lessonWorksheetPdfBase64"));
        assertEquals("input_file",content.get(1).get("type"));
        assertEquals("lesson_worksheet.pdf",content.get(1).get("filename"));
        assertEquals("data:application/pdf;base64,"+encoded,content.get(1).get("file_data"));
    }

    @Test void selectionWithoutWorksheetRemainsTextOnly() throws Exception {
        Object input=PostLessonHomeworkContentService.inputWithWorksheet(
                Map.of("roster",List.of(),"notes","Nur für Testschüler"),new ObjectMapper());
        assertInstanceOf(String.class,input);
        assertTrue(((String)input).contains("Nur für Testschüler"));
    }

    private static byte[] worksheetPdf(String example)throws Exception {
        try(var pdf=new PDDocument()){
            PDPage page=new PDPage();
            pdf.addPage(page);
            try(var stream=new PDPageContentStream(pdf,page)){
                stream.beginText();
                stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),12);
                stream.newLineAtOffset(40,740);
                stream.showText(example);
                stream.endText();
            }
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            pdf.save(out);
            return out.toByteArray();
        }
    }
}
