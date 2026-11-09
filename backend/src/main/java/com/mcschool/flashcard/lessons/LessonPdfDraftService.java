package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.text.Normalizer;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.PDXObject;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Server-side generation, QA, and persistent preview drafts for exactly two PDFs.
 * ChatGPT supplies lesson-specific exercises and checked solutions as JSON;
 * this renderer supplies the school's official artwork and fixed document layout.
 * Nothing touches an actual lesson until publish() is called explicitly.
 */
@Service
public class LessonPdfDraftService {
    private static final int MAX_JSON = 55_000;
    private static final int MAX_PDF = 15 * 1024 * 1024;
    private static final Color ORANGE = new Color(0xFF6A00);
    private static final Color NAVY = new Color(0x070A20);
    private static final Color GRAY = new Color(0x6B7280);
    private static final Color LINE = new Color(0xE5E7EB);

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final SchoolBrandGuideService guideService;
    private final LessonPreparationService preparationService;

    public LessonPdfDraftService(JdbcTemplate jdbc, ObjectMapper objectMapper,
            SchoolBrandGuideService guideService, LessonPreparationService preparationService) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.guideService = guideService;
        this.preparationService = preparationService;
    }

    public Map<String, Object> create(AuthenticatedUser teacher, String eventId, String calendarTitle, String lessonJson)
            throws Exception {
        if (teacher == null) throw new IllegalArgumentException("Authentication is required");
        if (eventId == null || eventId.isBlank()) throw new IllegalArgumentException("eventId is required");
        if (lessonJson == null || lessonJson.isBlank() || lessonJson.length() > MAX_JSON)
            throw new IllegalArgumentException("lessonJson must contain 1-55000 characters");
        @SuppressWarnings("unchecked")
        Map<String, Object> input = objectMapper.readValue(lessonJson, Map.class);
        if (input.containsKey("homework") || input.containsKey("homeworkDays") ||
                input.containsKey("homeworkPdf"))
            throw new IllegalArgumentException("Homework belongs to the separate homework workflow");
        String title = limited(input.get("title"), "Mathematik - Unterricht", 160);
        String plan = limited(input.get("lessonPlan"), "", 10_000);
        String difficulties = limited(input.get("difficulties"), "", 5_000);
        List<Task> tasks = parseTasks(input.get("tasks"));
        BufferedImage officialLogo = extractOfficialLogo(guideService.pdfForStaff(teacher).bytes());

        byte[] workbook = render(title, calendarTitle, tasks, officialLogo, false, plan);
        byte[] answers = render(title, calendarTitle, tasks, officialLogo, true, plan);
        int workbookPages = verifyPdf(workbook, officialLogo, "Arbeitsblatt");
        int answersPages = verifyPdf(answers, officialLogo, "Loesungen");
        if (workbook.length > MAX_PDF || answers.length > MAX_PDF)
            throw new IllegalArgumentException("Generated PDF exceeds 15 MB");

        UUID draftId = UUID.randomUUID();
        String safeName = "Mindcrafti_" + draftId.toString().substring(0, 8);
        String workbookName = safeName + "_Arbeitsblatt.pdf";
        String answersName = safeName + "_Lehrerloesungen.pdf";
        jdbc.update("""
                INSERT INTO lesson_pdf_drafts
                 (id, teacher_id, event_id, workbook_filename, answers_filename,
                  workbook_pdf, answers_pdf, lesson_plan, difficulties, task_count, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)
                """, draftId, teacher.id(), eventId, workbookName, answersName,
                workbook, answers, plan, difficulties, tasks.size(), Timestamp.from(Instant.now()));
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("draftId", draftId.toString());
        result.put("status", "DRAFT");
        result.put("teacherId", teacher.id().toString());
        result.put("eventId", eventId);
        result.put("workbookFilename", workbookName);
        result.put("answersFilename", answersName);
        result.put("workbookPages", workbookPages);
        result.put("answersPages", answersPages);
        result.put("taskCount", tasks.size());
        result.put("homeworkCount", 0);
        result.put("brandGuideLogo", "extracted from current official Brand Guide PDF");
        result.put("qaPassed", true);
        result.put("next", "Download both PDF previews, then request explicit user approval before publishing.");
        return result;
    }


    /**
     * Reuse the existing private draft + approval flow for the branded v3 engine.
     * The model never sees an arbitrary PDF-upload endpoint and drafts never
     * touch a lesson until publish_lesson_draft is explicitly confirmed.
     */
    public Map<String, Object> createFromRenderer(AuthenticatedUser teacher, String eventId,
            byte[] workbook, byte[] answers, String plan, String difficulties,
            int taskCount, BufferedImage originalLogo) throws IOException {
        if (teacher == null || eventId == null || eventId.isBlank())
            throw new IllegalArgumentException("Teacher and lesson are required");
        if (workbook == null || answers == null ||
                workbook.length > MAX_PDF || answers.length > MAX_PDF)
            throw new IllegalArgumentException("Renderer PDFs must be at most 15 MB each");
        int workbookPages = verifyPdf(workbook, originalLogo, "Arbeitsheft");
        int answerPages = verifyPdf(answers, originalLogo, "Lehrerloesungen");
        String planText = limited(plan, "", 10_000);
        String difficultiesText = limited(difficulties, "", 5_000);

        UUID id = UUID.randomUUID();
        String name = "Mindcrafti_" + id.toString().substring(0, 8);
        String workbookName = name + "_Arbeitsheft.pdf";
        String answerName = name + "_Lehrerloesungen.pdf";
        jdbc.update("""
                INSERT INTO lesson_pdf_drafts
                  (id, teacher_id, event_id, workbook_filename, answers_filename,
                   workbook_pdf, answers_pdf, lesson_plan, difficulties, task_count, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)
                """, id, teacher.id(), eventId, workbookName, answerName,
                workbook, answers, planText, difficultiesText, taskCount, Timestamp.from(Instant.now()));

        Map<String,Object> result = new LinkedHashMap<>();
        result.put("draftId", id.toString());
        result.put("status", "DRAFT");
        result.put("teacherId", teacher.id().toString());
        result.put("eventId", eventId);
        result.put("workbookFilename", workbookName);
        result.put("answersFilename", answerName);
        result.put("workbookPages", workbookPages);
        result.put("answersPages", answerPages);
        result.put("taskCount", taskCount);
        result.put("homeworkCount", 0);
        result.put("qaPassed", true);
        result.put("brandGuideLogo", "extracted from current Mindcrafti Brand Guide");
        result.put("next", "Download and review both PDFs; explicit publish_lesson_draft approval required");
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> info(AuthenticatedUser teacher, UUID draftId) {
        Draft draft = requireDraft(teacher, draftId, false);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("draftId", draft.id().toString());
        result.put("teacherId", teacher.id().toString());
        result.put("eventId", draft.eventId());
        result.put("status", draft.status());
        result.put("workbookFilename", draft.workbookName());
        result.put("answersFilename", draft.answersName());
        result.put("taskCount", draft.taskCount());
        result.put("homeworkCount", 0);
        result.put("qaPassed", true);
        if(draft.plan()!=null && draft.plan().startsWith(McpHomeworkDraftValidator.MARKER)) {
            String[] dayMarker=draft.plan().split(":",3);
            result.put("homeworkOnly",true);
            result.put("homeworkDay",Integer.parseInt(dayMarker[1]));
            result.put("assignmentStatus","UNASSIGNED_DRAFT");
        }
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> download(AuthenticatedUser teacher, UUID draftId, String kind)
            throws IOException {
        Draft draft = requireDraft(teacher, draftId, false);
        boolean workbook = "workbook".equalsIgnoreCase(kind);
        if (!workbook && !"answers".equalsIgnoreCase(kind))
            throw new IllegalArgumentException("kind must be workbook or answers");
        byte[] pdf = workbook ? draft.workbook() : draft.answers();
        String filename = workbook ? draft.workbookName() : draft.answersName();
        return Map.of("draftId", draftId.toString(), "kind", kind.toLowerCase(Locale.ROOT),
                "filename", filename, "mimeType", "application/pdf",
                "sizeBytes", pdf.length, "base64", Base64.getEncoder().encodeToString(pdf));
    }

    public record PreviewFile(String eventId,String filename,byte[] bytes) {}

    /**
     * Mark a complete, QA-verified workbook draft as one unassigned homework day.
     * Never attach it to lesson slots: homework assignment is a separate, explicit action.
     */
    @Transactional
    public void markHomeworkDraft(AuthenticatedUser teacher, UUID draftId,
                                  String eventId, int day, String seriesKey) {
        Draft draft=requireDraft(teacher,draftId,true);
        if(!eventId.equals(draft.eventId()) || !"DRAFT".equals(draft.status()))
            throw new IllegalArgumentException("Homework draft must be unpublished and belong to the exact source lesson");
        String marker=McpHomeworkDraftValidator.seriesMarker(seriesKey,day);
        if(draft.plan()!=null && draft.plan().startsWith(McpHomeworkDraftValidator.MARKER))
            throw new IllegalArgumentException("Homework draft was already assigned to a day");
        int changed=jdbc.update("UPDATE lesson_pdf_drafts SET lesson_plan=? WHERE id=? AND teacher_id=? AND status='DRAFT'",
                marker,draftId,teacher.id());
        if(changed!=1)throw new IllegalStateException("Could not mark the approved homework preview");
    }

    @Transactional(readOnly=true)
    public PreviewFile homeworkPreviewFile(AuthenticatedUser teacher,UUID draftId,
                                            String eventId,int day,String seriesKey) {
        Draft draft=requireDraft(teacher,draftId,false);
        String expected=McpHomeworkDraftValidator.seriesMarker(seriesKey,day);
        if(!eventId.equals(draft.eventId()) || !"DRAFT".equals(draft.status()) ||
                !expected.equals(draft.plan()))
            throw new IllegalArgumentException("Homework PDF is not an approved day from this exact series and owned lesson");
        if(draft.workbook()==null || draft.workbook().length==0)
            throw new IllegalArgumentException("Homework PDF is unavailable");
        return new PreviewFile(draft.eventId(),draft.workbookName(),draft.workbook());
    }

    @Transactional(readOnly=true)
    public PreviewFile previewFile(AuthenticatedUser teacher,UUID draftId,String kind) {
        Draft draft=requireDraft(teacher,draftId,false);
        if(!"workbook".equals(kind)&&!"answers".equals(kind))throw new IllegalArgumentException("kind must be workbook or answers");
        return "workbook".equals(kind)?new PreviewFile(draft.eventId(),draft.workbookName(),draft.workbook())
                :new PreviewFile(draft.eventId(),draft.answersName(),draft.answers());
    }

    /**
     * Explicit publication only. A row lock prevents duplicate concurrent publications;
     * workbook + answers and draft status are committed together.
     */
    @Transactional
    public Map<String, Object> publish(AuthenticatedUser teacher, UUID draftId, boolean confirm)
            throws Exception {
        if (!confirm) throw new IllegalArgumentException("Publication requires confirm=true after the user reviewed both PDFs");
        Draft draft = requireDraft(teacher, draftId, true);
        if ("PUBLISHED".equals(draft.status())) return publicationResult(teacher, draft, true);
        if (!"DRAFT".equals(draft.status())) throw new IllegalStateException("Draft is not publishable");
        if(draft.plan()!=null && draft.plan().startsWith(McpHomeworkDraftValidator.MARKER))
            throw new IllegalArgumentException("Homework drafts cannot be published as lesson workbooks; use the explicit seven-day homework assignment tool");

        // The two PDFs were generated and verified on create; recheck integrity before uploading.
        BufferedImage logo = extractOfficialLogo(guideService.pdfForStaff(teacher).bytes());
        verifyPdf(draft.workbook(), logo, "Arbeitsblatt");
        verifyPdf(draft.answers(), logo, "Loesungen");
        preparationService.prepareMaterials(teacher, draft.eventId(), null,
                draft.workbookName(), draft.workbook(), draft.answersName(), draft.answers());
        jdbc.update("UPDATE lesson_pdf_drafts SET status = 'PUBLISHED', published_at = ? WHERE id = ?",
                Timestamp.from(Instant.now()), draftId);
        return publicationResult(teacher, draft, false);
    }

    private Map<String,Object> publicationResult(AuthenticatedUser teacher, Draft draft, boolean alreadyPublished) {
        LessonPreparationResponse saved = preparationService.read(teacher, draft.eventId());
        if (!draft.eventId().equals(saved.eventId()) || !saved.hasWorkbook() || !saved.hasAnswers()
                || !draft.workbookName().equals(saved.workbookFilename()) || !draft.answersName().equals(saved.answersFilename())
                || saved.workbookSizeBytes() != draft.workbook().length || saved.answersSizeBytes() != draft.answers().length)
            throw new IllegalStateException("Lesson readback did not confirm the exact approved PDF slots, filenames and sizes");
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("draftId", draft.id().toString());
        result.put("status", "PUBLISHED");
        result.put("eventId", saved.eventId());
        result.put("workbookFilename", saved.workbookFilename());
        result.put("answersFilename", saved.answersFilename());
        result.put("hasWorkbook", saved.hasWorkbook());
        result.put("hasAnswers", saved.hasAnswers());
        result.put("alreadyPublished", alreadyPublished);
        result.put("published", true);
        result.put("homeworkCount", 0);
        return result;
    }

    private Draft requireDraft(AuthenticatedUser teacher, UUID id, boolean lock) {
        if (teacher == null || teacher.role() != com.mcschool.flashcard.users.Role.TEACHER)
            throw new IllegalArgumentException("A scoped teacher identity is required");
        String suffix = lock ? " FOR UPDATE" : "";
        List<Draft> results = jdbc.query("""
                SELECT id, teacher_id, event_id, workbook_filename, answers_filename,
                       workbook_pdf, answers_pdf, lesson_plan, difficulties, task_count, status
                FROM lesson_pdf_drafts WHERE id = ?
                """ + suffix,
                (rs, row) -> new Draft((UUID) rs.getObject("id"), (UUID) rs.getObject("teacher_id"),
                        rs.getString("event_id"), rs.getString("workbook_filename"),
                        rs.getString("answers_filename"), rs.getBytes("workbook_pdf"),
                        rs.getBytes("answers_pdf"), rs.getString("lesson_plan"),
                        rs.getString("difficulties"), rs.getInt("task_count"),
                        rs.getString("status")), id);
        if (results.isEmpty() || !results.get(0).teacherId().equals(teacher.id()))
            throw new IllegalArgumentException("Lesson draft not found for this teacher");
        return results.get(0);
    }

    private static List<Task> parseTasks(Object raw) {
        if (!(raw instanceof List<?> source) || source.size() < 2 || source.size() > 24)
            throw new IllegalArgumentException("tasks must be an array of 2-24 questions");
        List<Task> result = new ArrayList<>();
        for (Object item : source) {
            if (!(item instanceof Map<?, ?> task))
                throw new IllegalArgumentException("Every task must be an object");
            String question = limited(task.get("question"), "", 2000);
            String answer = limited(task.get("answer"), "", 2000);
            if (question.isBlank() || answer.isBlank())
                throw new IllegalArgumentException("Each task needs a question and a correct answer");
            int lines = task.get("lines") instanceof Number n ? n.intValue() : 6;
            if (lines < 2 || lines > 12)
                throw new IllegalArgumentException("Every task lines value must be 2-12");
            result.add(new Task(question, answer, lines));
        }
        return result;
    }

    private static String limited(Object value, String fallback, int maximum) {
        String s = value == null ? fallback : String.valueOf(value).trim();
        if (s.length() > maximum) throw new IllegalArgumentException("Lesson text is too long");
        return s;
    }

    /** The logo is extracted as an original image XObject from the *stored* official guide. */
    static BufferedImage extractOfficialLogo(byte[] officialBrandGuide) throws IOException {
        if (officialBrandGuide == null || officialBrandGuide.length == 0)
            throw new IllegalArgumentException("Original Mindcrafti Brand Guide PDF is missing");
        try (PDDocument guide = Loader.loadPDF(officialBrandGuide)) {
            for (PDPage page : guide.getPages()) {
                if (page.getResources() == null) continue;
                for (COSName name : page.getResources().getXObjectNames()) {
                    PDXObject object = page.getResources().getXObject(name);
                    if (object instanceof PDImageXObject img) {
                        BufferedImage artwork = img.getImage();
                        if (artwork != null && artwork.getWidth() >= 100 && artwork.getHeight() >= 100)
                            return artwork;
                    }
                }
            }
        }
        throw new IllegalArgumentException("No official logo image could be extracted from Brand Guide PDF");
    }

    /** Uses fixed measured spacing so problems never collide with the next page header. */
    static byte[] render(String title, String student, List<Task> tasks,
            BufferedImage logo, boolean teacherAnswers, String plan) throws IOException {
        try (PDDocument document = new PDDocument()) {
            Writer writer = new Writer(document, logo);
            writer.newPage();
            writer.heading(teacherAnswers ? "Loesungen fuer Lehrkraefte" : "Arbeitsblatt", title);
            writer.small("Lernende: " + student);
            writer.rule();
            if (teacherAnswers && plan != null && !plan.isBlank()) {
                writer.subheading("Unterrichtsplan");
                writer.paragraph(plan, 9.5f, 14f);
                writer.rule();
            }
            for (int i = 0; i < tasks.size(); i++) {
                Task task = tasks.get(i);
                writer.task(i+1, teacherAnswers ? task.question() + "\nLoesung: " + task.answer() : task.question(),
                        teacherAnswers ? 0 : task.lines(), teacherAnswers);
            }
            writer.finish();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            document.save(out);
            return out.toByteArray();
        }
    }

    static int verifyPdf(byte[] data, BufferedImage artwork, String expectedTitle) throws IOException {
        if (data == null || data.length < 100 || !new String(data, 0, 5, java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-"))
            throw new IllegalArgumentException("Invalid generated PDF");
        try (PDDocument pdf = Loader.loadPDF(data)) {
            int count = pdf.getNumberOfPages();
            if (count < 1 || count > 50) throw new IllegalArgumentException("PDF page count outside permitted bounds");
            PDFTextStripper stripper = new PDFTextStripper();
            for (int i=0; i<count; i++) {
                PDPage page = pdf.getPage(i);
                if (page.getResources() == null) throw new IllegalArgumentException("PDF page lacks official logo");
                boolean hasOfficialImage = false;
                for (COSName name : page.getResources().getXObjectNames()) {
                    PDXObject x = page.getResources().getXObject(name);
                    if (x instanceof PDImageXObject image &&
                            image.getWidth() == artwork.getWidth() &&
                            image.getHeight() == artwork.getHeight()) {
                        hasOfficialImage = true;
                    }
                }
                if (!hasOfficialImage)
                    throw new IllegalArgumentException("Missing official Mindcrafti logo on page " + (i+1));
                stripper.setStartPage(i+1);
                stripper.setEndPage(i+1);
                String text = stripper.getText(pdf);
                if (text == null || !text.contains("MINDCRAFTI SCHOOL") || text.strip().length() < 24)
                    throw new IllegalArgumentException("Blank or incorrectly branded PDF page " + (i+1));
            }
            return count;
        }
    }

    static record Task(String question, String answer, int lines) {}
    private record Draft(UUID id, UUID teacherId, String eventId, String workbookName, String answersName,
            byte[] workbook, byte[] answers, String plan, String difficulties, int taskCount, String status) {}

    /** Page composer; content is intentionally in German for all student-facing text. */
    static final class Writer {
        private static final PDRectangle PAGE = PDRectangle.A4;
        private static final float LEFT = 47f;
        private static final float RIGHT = PAGE.getWidth() - 47f;
        private static final PDFont REGULAR = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
        private static final PDFont BOLD = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
        private final PDDocument doc;
        private final BufferedImage logo;
        private PDPageContentStream stream;
        private float y;
        private int pageNumber;

        Writer(PDDocument doc, BufferedImage logo) { this.doc=doc; this.logo=logo; }

        void newPage() throws IOException {
            if (stream!=null) stream.close();
            PDPage page=new PDPage(PAGE); doc.addPage(page);
            stream=new PDPageContentStream(doc,page);
            pageNumber++;
            y=PAGE.getHeight()-125f;
            stream.setNonStrokingColor(NAVY);
            text(LEFT,PAGE.getHeight()-56f,"MINDCRAFTI SCHOOL",BOLD,11f);
            stream.setStrokingColor(ORANGE);
            stream.setLineWidth(2);
            stream.moveTo(LEFT,PAGE.getHeight()-71f);
            stream.lineTo(RIGHT,PAGE.getHeight()-71f);
            stream.stroke();
            PDImageXObject image=LosslessFactory.createFromImage(doc,logo);
            float width=50f, height=width*logo.getHeight()/logo.getWidth();
            if(height>54f){height=54f;width=height*logo.getWidth()/logo.getHeight();}
            stream.drawImage(image,RIGHT-width,PAGE.getHeight()-57f-height,width,height);
            stream.setNonStrokingColor(GRAY);
            text(LEFT,31,"Mindcrafti School  |  "+pageNumber,REGULAR,8f);
        }

        void heading(String label, String subtitle) throws IOException {
            ensure(75);
            text(LEFT,y,label,BOLD,22);y-=30;
            paragraph(subtitle,13,17);y-=10;
        }
        void small(String label) throws IOException {
            ensure(22);text(LEFT,y,label,REGULAR,10);y-=21;
        }
        void subheading(String title) throws IOException {
            ensure(34);text(LEFT,y,title,BOLD,13);y-=25;
        }
        void rule() throws IOException {
            ensure(22);stream.setStrokingColor(LINE);stream.setLineWidth(.6f);
            stream.moveTo(LEFT,y);stream.lineTo(RIGHT,y);stream.stroke();y-=22;
        }
        void task(int index, String content,int blankLines,boolean isAnswer) throws IOException {
            float fontSize=isAnswer?10.5f:11f;
            float leading=isAnswer?15f:17f;
            List<String> lines=wrap(content,isAnswer?REGULAR:REGULAR,fontSize,RIGHT-LEFT-18);
            float estimated=28+lines.size()*leading+blankLines*17+16;
            if(estimated>PAGE.getHeight()-175)throw new IllegalArgumentException("One task exceeds a full A4 page; split it into shorter tasks");
            ensure(estimated);
            text(LEFT,y,"Aufgabe "+index,BOLD,12);y-=22;
            for(String line:lines){text(LEFT+9,y,line,REGULAR,fontSize);y-=leading;}
            y-=8;
            for(int n=0;n<blankLines;n++){
                stream.setLineWidth(.5f);stream.setStrokingColor(LINE);
                stream.moveTo(LEFT+9,y);stream.lineTo(RIGHT,y);stream.stroke();y-=17;
            }
            y-=14;
        }
        void paragraph(String value,float fontSize,float leading)throws IOException {
            for(String line:wrap(value,REGULAR,fontSize,RIGHT-LEFT)){
                ensure(leading+8);text(LEFT,y,line,REGULAR,fontSize);y-=leading;
            }
        }
        void ensure(float size)throws IOException {if(y-size<64)newPage();}
        void text(float x,float atY,String raw,PDFont font,float size)throws IOException{
            String cleaned=printable(raw);
            stream.beginText();stream.setFont(font,size);stream.setNonStrokingColor(NAVY);
            stream.newLineAtOffset(x,atY);stream.showText(cleaned);stream.endText();
        }
        void finish() throws IOException {if(stream!=null){stream.close();stream=null;}}
        static List<String> wrap(String input,PDFont font,float size,float maxWidth)throws IOException {
            List<String> result=new ArrayList<>();
            String[] parts=printable(input).replace("\r","").split("\n",-1);
            for(String paragraph:parts){
                String line="";
                for(String word:paragraph.split("\\s+")){
                    if(word.isBlank())continue;
                    String maybe=line.isEmpty()?word:line+" "+word;
                    if(font.getStringWidth(maybe)*size/1000f<=maxWidth){line=maybe;continue;}
                    if(!line.isEmpty()){result.add(line);line="";}
                    if(font.getStringWidth(word)*size/1000f<=maxWidth){line=word;continue;}
                    String part="";
                    for(char c:word.toCharArray()){
                        if(!part.isEmpty()&&font.getStringWidth(part+c)*size/1000f>maxWidth){
                            result.add(part);part="";
                        }
                        part+=c;
                    }
                    line=part;
                }
                if(!line.isEmpty())result.add(line);
                if(paragraph.isEmpty())result.add(" ");
            }
            return result;
        }
        static String printable(String text) {
            if(text==null)return "";
            String s=Normalizer.normalize(text,Normalizer.Form.NFC)
                    .replace('−','-').replace('–','-').replace('—','-')
                    .replace('×','x').replace('÷','/').replace('→','>')
                    .replace('≤','<').replace('≥','>').replace('∠','<')
                    .replace('“','"').replace('”','"').replace('„','"').replace('’','\'')
                    .replace('²','2').replace('³','3').replace('π','p');
            String cyr="абвгдежзийклмнопрстуфхцчшщъыьэюя";
            String[] lat={"a","b","v","g","d","e","zh","z","i","y","k","l","m","n","o","p","r","s","t","u","f","kh","ts","ch","sh","sch","","y","","e","yu","ya"};
            StringBuilder output=new StringBuilder();
            for(char c:s.toCharArray()){
                if(c=='\n'){output.append('\n');continue;}
                if((c>=32&&c<=126)||(c>=160&&c<=255)){output.append(c);continue;}
                int at=cyr.indexOf(Character.toLowerCase(c));
                if(at>=0){String v=lat[at];output.append(Character.isUpperCase(c)?v.toUpperCase(Locale.ROOT):v);}
                else if(Character.isWhitespace(c))output.append(' ');
                else output.append('?');
            }
            return output.toString();
        }
    }
}
