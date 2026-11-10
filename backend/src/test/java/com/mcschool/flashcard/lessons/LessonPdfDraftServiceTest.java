package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.util.List;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import java.util.Map;
import java.util.UUID;
import java.sql.ResultSet;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import tools.jackson.databind.ObjectMapper;

class LessonPdfDraftServiceTest {
    private static BufferedImage fakeArtwork() {
        BufferedImage img = new BufferedImage(220,180,BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D brush=img.createGraphics();
        brush.setColor(Color.ORANGE);brush.fillRect(0,0,220,180);brush.dispose();
        return img;
    }

    @Test
    void makesTwoSeparatelyValidatedDocumentsWithNoHomework() throws Exception {
        BufferedImage logo=fakeArtwork();
        List<LessonPdfDraftService.Task> exercises=List.of(
            new LessonPdfDraftService.Task("Nenne die Eigenschaften einer Raute.","Alle Seiten gleich lang.",6),
            new LessonPdfDraftService.Task("Berechne den Nebenwinkel bei 75 Grad.","105 Grad.",6));
        byte[] student=LessonPdfDraftService.render("Vierecke","Mark",exercises,logo,false,"");
        byte[] teacher=LessonPdfDraftService.render("Vierecke","Mark",exercises,logo,true,"");
        assertTrue(LessonPdfDraftService.verifyPdf(student,logo,"Arbeitsblatt")>0);
        assertTrue(LessonPdfDraftService.verifyPdf(teacher,logo,"Loesungen")>0);
        try(var doc=Loader.loadPDF(student)){
            String text=new PDFTextStripper().getText(doc);
            assertTrue(text.contains("Aufgabe 1"));
            assertFalse(text.contains("Loesung:"));
            assertFalse(text.contains("Hausaufgabe"));
        }
        try(var doc=Loader.loadPDF(teacher)){
            assertTrue(new PDFTextStripper().getText(doc).contains("Loesung:"));
        }
    }

    @Test
    void minimalOrangeWorkbookWorksWithoutAnyEmbeddedLogo() throws Exception {
        List<LessonPdfDraftService.Task> exercises=List.of(
            new LessonPdfDraftService.Task("Berechne 5 + 7.", "12", 6));
        byte[] student=LessonPdfDraftService.render("Mathematik", "Sofia", exercises, null, false, "");
        byte[] answers=LessonPdfDraftService.render("Mathematik", "Sofia", exercises, null, true, "");
        assertEquals(1, LessonPdfDraftService.verifyPdf(student, null, "Arbeitsblatt"));
        assertEquals(1, LessonPdfDraftService.verifyPdf(answers, null, "Loesungen"));
        try(var pdf=Loader.loadPDF(student)) {
            assertTrue(new PDFTextStripper().getText(pdf).contains("MINDCRAFTI SCHOOL"));
            assertFalse(pdf.getPage(0).getResources().getXObjectNames().iterator().hasNext(),
                "Logo-free output must not include any embedded image");
        }
    }

    @Test
    void rejectsNonPdf() {
        assertThrows(IllegalArgumentException.class,
            () -> LessonPdfDraftService.verifyPdf(new byte[]{1,2,3},fakeArtwork(),"Arbeitsblatt"));
    }

    @Test
    void rendererDraftDoesNotModifyLessonAndPublicationRequiresExplicitConfirmation() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        LessonPreparationService preparation=mock(LessonPreparationService.class);
        var service=new LessonPdfDraftService(jdbc,new ObjectMapper(),mock(SchoolBrandGuideService.class),preparation);
        var teacher=new AuthenticatedUser(UUID.randomUUID(),"teacher@test.local",Role.TEACHER);
        BufferedImage logo=fakeArtwork();
        byte[] workbook=LessonPdfDraftService.render("Math","Sofia",List.of(
                new LessonPdfDraftService.Task("Berechne 2 + 3.","5",3)),logo,false,"");
        byte[] answers=LessonPdfDraftService.render("Math","Sofia",List.of(
                new LessonPdfDraftService.Task("Berechne 2 + 3.","5",3)),logo,true,"");
        Map<String,Object> result=service.createFromRenderer(teacher,"exact-event",workbook,answers,"plan","",1,logo);
        assertEquals("DRAFT",result.get("status"));
        assertEquals("exact-event",result.get("eventId"));
        verifyNoInteractions(preparation);
        clearInvocations(jdbc);
        assertThrows(IllegalArgumentException.class,()->service.publish(teacher,UUID.randomUUID(),false));
        verifyNoInteractions(jdbc,preparation);
    }

    @Test
    @SuppressWarnings("unchecked")
    void publicationAttachesExactApprovedPairAndReadsBackNamesEventAndSizes() throws Exception {
        UUID id=UUID.randomUUID(), teacherId=UUID.randomUUID();
        var teacher=new AuthenticatedUser(teacherId,"teacher@test.local",Role.TEACHER);
        BufferedImage logo=fakeArtwork();
        byte[] workbook=LessonPdfDraftService.render("Math","Sofia",List.of(new LessonPdfDraftService.Task("2+3?","5",3)),logo,false,"");
        byte[] answers=LessonPdfDraftService.render("Math","Sofia",List.of(new LessonPdfDraftService.Task("2+3?","5",3)),logo,true,"");
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ResultSet rs=mock(ResultSet.class);
        when(rs.getObject("id")).thenReturn(id);
        when(rs.getObject("teacher_id")).thenReturn(teacherId);
        when(rs.getString("event_id")).thenReturn("exact-event");
        when(rs.getString("workbook_filename")).thenReturn("approved-workbook.pdf");
        when(rs.getString("answers_filename")).thenReturn("approved-answers.pdf");
        when(rs.getBytes("workbook_pdf")).thenReturn(workbook);
        when(rs.getBytes("answers_pdf")).thenReturn(answers);
        when(rs.getString("status")).thenReturn("DRAFT");
        when(jdbc.query(anyString(),any(RowMapper.class),eq(id))).thenAnswer(i->List.of(((RowMapper<?>)i.getArgument(1)).mapRow(rs,0)));
        SchoolBrandGuideService brand=mock(SchoolBrandGuideService.class);
        when(brand.pdfForStaff(teacher)).thenReturn(new SchoolBrandGuideService.BrandGuidePdf("guide.pdf",workbook));
        LessonPreparationService preparation=mock(LessonPreparationService.class);
        when(preparation.read(teacher,"exact-event")).thenReturn(new LessonPreparationResponse("exact-event",null,null,null,null,false,null,
                true,"approved-workbook.pdf",true,"approved-answers.pdf",null,null,null,null,null,true,workbook.length,1,answers.length,1));
        var service=new LessonPdfDraftService(jdbc,new ObjectMapper(),brand,preparation);
        Map<String,Object> result=service.publish(teacher,id,true);
        assertEquals(true,result.get("success"));
        assertEquals("exact-event",result.get("eventId"));
        verify(preparation).prepareMaterials(teacher,"exact-event",null,"approved-workbook.pdf",workbook,"approved-answers.pdf",answers);
        verify(preparation).read(teacher,"exact-event");
        verify(preparation,never()).update(any(),any(),any());
        when(rs.getString("status")).thenReturn("PUBLISHED");
        assertEquals(true,service.publish(teacher,id,true).get("alreadyPublished"));
        verify(preparation,times(1)).prepareMaterials(any(),any(),any(),any(),any(),any(),any());
        when(preparation.read(teacher,"exact-event")).thenReturn(new LessonPreparationResponse("wrong-event",null,null,null,null,false,null,
                true,"other.pdf",true,"approved-answers.pdf",null,null,null,null,null,true,workbook.length,1,answers.length,1));
        assertThrows(IllegalStateException.class,()->service.publish(teacher,id,true));
    }
}
