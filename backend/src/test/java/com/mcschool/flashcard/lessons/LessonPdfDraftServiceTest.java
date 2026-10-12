package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.util.List;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

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
    void rejectsNonPdf() {
        assertThrows(IllegalArgumentException.class,
            () -> LessonPdfDraftService.verifyPdf(new byte[]{1,2,3},fakeArtwork(),"Arbeitsblatt"));
    }
}
