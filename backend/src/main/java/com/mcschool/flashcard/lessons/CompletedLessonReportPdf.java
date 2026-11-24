package com.mcschool.flashcard.lessons;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

/** Text-only teacher report. Never modifies or replaces an archived pupil board. */
final class CompletedLessonReportPdf {
    private static final Color INK=new Color(24,37,57);
    private static final Color ORANGE=new Color(210,92,21);
    private static final Color MUTED=new Color(91,103,121);
    private CompletedLessonReportPdf(){}

    static byte[] render(PostLessonSkillReviewService.PreviewReport report,boolean de)throws IOException {
        Path font=Path.of("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
        Path bold=Path.of("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
        if(!Files.isReadable(font))throw new IOException("Report font unavailable");
        try(PDDocument document=new PDDocument();ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
            PDType0Font regular=PDType0Font.load(document,font.toFile());
            PDType0Font heading=Files.isReadable(bold)?PDType0Font.load(document,bold.toFile()):regular;
            try(Layout layout=new Layout(document,regular,heading,de)) {
                layout.heading(de?"Dokument der vergangenen Stunde":"Документ пройденного урока",19);
                layout.paragraph((de?"Schüler: ":"Ученик: ")+report.studentName(),13,INK,true);
                layout.paragraph(de?"KI-Auswertung · Nur für Lehrkräfte · Keine Änderung der Lernstandswerte":
                        "ИИ-анализ · Только для преподавателя · Проценты знаний не изменены",10,MUTED,false);
                layout.gap(12);
                layout.heading(de?"Verfügbare Quellen":"Доступные источники",13);
                layout.paragraph((de?"Archivierte persönliche PDFs: ":"Архивные личные PDF: ")+report.archivedPdfs()
                        +(de?"  |  Seiten mit Schülerstift: ":"  |  Страницы с записями ученика: ")+report.verifiedInkPages()
                        +(de?"  |  Schülerstimme: ":"  |  Речь ученика: ")+(report.verifiedSpeech()?(de?"ja":"да"):(de?"nein":"нет")),
                        10,MUTED,false);
                layout.gap(12);
                if(!"READY".equals(report.state())){
                    layout.heading(de?"Keine bestätigten Beobachtungen":"Нет подтверждённых наблюдений",14);
                    layout.paragraph(detail(report.detail(),de),12,INK,false);
                }
                int n=0;
                for(var row:report.observations()){
                    layout.gap(12);
                    layout.heading((++n)+". "+row.skillTitle(),13);
                    layout.paragraph(correctness(row.correctness(),de)+" · "+autonomy(row.autonomy(),de)
                            +(de?" · KI-Sicherheit: ":" · Уверенность ИИ: ")+row.confidence()+"%"
                            +(de?" · korrekte selbstständige Beispiele: ":" · Верных самостоятельных примеров: ")+row.correctExamples(),
                            10,MUTED,false);
                    layout.paragraph(row.explanation(),12,INK,false);
                    layout.paragraph((de?"Beleg: ":"Подтверждение: ")+row.excerpt(),11,INK,false);
                    layout.paragraph("WRITING".equals(row.origin())
                            ? (de?"Persönliche Tafel, Seite ":"Личная доска, страница ")+row.pageNumber()
                            : (de?"Authentifizierte Schülerrede":"Реплика ученика с подтверждённым авторством"),
                            10,MUTED,false);
                }
            }
            document.save(bytes);return bytes.toByteArray();
        }
    }

    static String detail(String code,boolean de) {
        return switch(Objects.toString(code,"")) {
            case "STUDENT_GRADE_UNSET" -> de?"Klassenstufe fehlt.":"Не указан класс ученика.";
            case "GRADE_BOARD_NOT_FOUND" -> de?"Kein passender Lehrplan gefunden.":"Не найдена карта навыков для класса.";
            case "GRADE_BOARD_AMBIGUOUS" -> de?"Mehrere Lehrpläne passen; keine automatische Auswahl.":"Найдено несколько карт навыков; выбор неоднозначен.";
            case "NO_MATCHING_SKILLS" -> de?"Keine passenden Lernziele gefunden.":"Не найдены подходящие навыки.";
            case "NO_PUPIL_WORK_OR_SPEECH" -> de?"Keine eindeutig zugeordneten Schülerlösungen oder Schüleräußerungen.":"Нет записей или реплик, которые можно надёжно отнести к ученику.";
            case "ANNOTATED_PDF_NOT_SAVED" -> de?"Kein verwendbares archiviertes persönliches Tafel-PDF.":"Нет доступного архивного PDF личной доски с записями.";
            case "NO_CONFIRMED_SKILL_EVIDENCE" -> de?"Die KI konnte keine ausreichend belegte Beobachtung bestätigen.":"ИИ не нашёл достаточно надёжных подтверждений навыков.";
            default -> de?"Keine belastbare Auswertung möglich.":"Недостаточно данных для надёжного анализа.";
        };
    }

    private static String correctness(String code,boolean de){
        return switch(code){
            case "CORRECT" -> de?"Richtig":"Верно";
            case "INCORRECT" -> de?"Fehler":"Ошибка";
            case "PARTIAL" -> de?"Teilweise richtig":"Частично верно";
            default -> de?"Unklar":"Неясно";
        };
    }
    private static String autonomy(String code,boolean de){
        return switch(code){
            case "FIRST_TRY" -> de?"Beim ersten Versuch":"С первой попытки";
            case "INDEPENDENT" -> de?"Selbstständig":"Самостоятельно";
            case "HINTED" -> de?"Mit Hinweis":"С подсказкой";
            case "AFTER_EXPLANATION" -> de?"Nach Erklärung":"После объяснения";
            case "NOT_YET" -> de?"Noch nicht selbstständig":"Пока не самостоятельно";
            default -> de?"Nicht sicher zuzuordnen":"Неясная самостоятельность";
        };
    }

    private static final class Layout implements AutoCloseable {
        private final PDDocument doc;
        private final PDType0Font normal,bold;
        private final boolean de;
        private PDPageContentStream out;
        private float y;
        private static final float LEFT=48,RIGHT=48,BOTTOM=55;
        private int page;
        Layout(PDDocument doc,PDType0Font normal,PDType0Font bold,boolean de)throws IOException{
            this.doc=doc;this.normal=normal;this.bold=bold;this.de=de;newPage();
        }
        private void newPage()throws IOException{
            if(out!=null)out.close();
            PDPage p=new PDPage(PDRectangle.A4);doc.addPage(p);out=new PDPageContentStream(doc,p);
            y=PDRectangle.A4.getHeight()-43;
            draw("MINDCRAFTI SCHOOL",10,bold,ORANGE,LEFT,y);
            draw(de?"Nur für Lehrkräfte":"Только для преподавателя",9,normal,MUTED,LEFT,34);
            draw(String.valueOf(++page),9,normal,MUTED,PDRectangle.A4.getWidth()-RIGHT-16,34);
            out.setStrokingColor(ORANGE);out.setLineWidth(1.3f);
            out.moveTo(LEFT,y-9);out.lineTo(PDRectangle.A4.getWidth()-RIGHT,y-9);out.stroke();y-=29;
        }
        void gap(float amount){y-=amount;}
        void heading(String text,float size)throws IOException{paragraph(text,size,INK,true);gap(4);}
        void paragraph(String text,float size,Color color,boolean strong)throws IOException{
            PDType0Font f=strong?bold:normal;
            float step=size*1.38f;
            for(String line:wrap(safe(text,f),f,size,PDRectangle.A4.getWidth()-LEFT-RIGHT)){
                if(y-step<BOTTOM)newPage();
                draw(line,size,f,color,LEFT,y);y-=step;
            }
            y-=4;
        }
        private void draw(String text,float size,PDType0Font f,Color color,float x,float baseline)throws IOException{
            out.beginText();out.setFont(f,size);out.setNonStrokingColor(color);
            out.newLineAtOffset(x,baseline);out.showText(text);out.endText();
        }
        @Override public void close()throws IOException{if(out!=null)out.close();}
    }

    private static String safe(String value,PDType0Font f)throws IOException{
        StringBuilder s=new StringBuilder();
        for(int cp:Objects.toString(value,"").codePoints().toArray()){
            if(cp=='\n'){s.append('\n');continue;}
            if(Character.isISOControl(cp)){s.append(' ');continue;}
            String ch=new String(Character.toChars(cp));
            try {f.getStringWidth(ch);s.append(ch);}
            catch(IllegalArgumentException missingGlyph){s.append('?');}
        }
        return s.toString();
    }

    static List<String> wrap(String input,PDType0Font font,float size,float maxWidth)throws IOException{
        List<String> result=new ArrayList<>();
        for(String paragraph:input.split("\\R",-1)){
            String line="";
            for(String word:paragraph.strip().split("\\s+")){
                if(word.isEmpty())continue;
                String next=line.isEmpty()?word:line+" "+word;
                if(width(font,next,size)<=maxWidth){line=next;continue;}
                if(!line.isEmpty()){result.add(line);line="";}
                for(int cp:word.codePoints().toArray()){
                    String ch=new String(Character.toChars(cp));
                    if(!line.isEmpty() && width(font,line+ch,size)>maxWidth){result.add(line);line="";}
                    line+=ch;
                }
            }
            result.add(line);
        }
        return result;
    }
    private static float width(PDType0Font f,String text,float size)throws IOException{
        return f.getStringWidth(text)*size/1000f;
    }
}
