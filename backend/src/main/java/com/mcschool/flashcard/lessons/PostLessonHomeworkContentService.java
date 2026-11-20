package com.mcschool.flashcard.lessons;

import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.function.Consumer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

/** Only creates validated, unpublished PDF pairs. Runs on the server without a browser session. */
@Service
public class PostLessonHomeworkContentService {
    private static final Logger LOG = LoggerFactory.getLogger(PostLessonHomeworkContentService.class);
    private static final int MAX_DRAFT_ATTEMPTS = 3;
    private static final int MAX_REJECTED_JSON_CHARS = 24_000;
    private final String apiKey,model;
    private final ObjectMapper json;
    private final OwnerWorkbookPdfRenderService renderer;
    private final HttpClient client;

    @Autowired
    public PostLessonHomeworkContentService(
            @Value("${OPENAI_API_KEY:}") String apiKey,
            @Value("${HOMEWORK_OPENAI_MODEL:${WORKBOOK_OPENAI_MODEL:${OPENAI_MODEL:}}}") String model,
            ObjectMapper json,OwnerWorkbookPdfRenderService renderer) {
        this(apiKey,model,json,renderer,HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15)).build());
    }

    /** Package-private for deterministic tests with a fake HTTP provider. */
    PostLessonHomeworkContentService(String apiKey,String model,ObjectMapper json,
            OwnerWorkbookPdfRenderService renderer,HttpClient client) {
        this.apiKey=apiKey==null?"":apiKey.trim();
        this.model=model==null?"":model.trim();
        this.json=Objects.requireNonNull(json);
        this.renderer=Objects.requireNonNull(renderer);
        this.client=Objects.requireNonNull(client);
    }
    public boolean configured(){return !apiKey.isEmpty()&&!model.isEmpty();}

    private String ask(String instructions,Object evidence,String formatName,Map<String,Object> schema)throws Exception{
        if(!configured())throw new IllegalStateException("HOMEWORK_AI_NOT_CONFIGURED");
        Map<String,Object> payload=Map.of("model",model,"store",false,"max_output_tokens",7500,
                "instructions",instructions,"input",inputWithWorksheet(evidence,json),
                "text",Map.of("format",Map.of("type","json_schema","name",formatName,"strict",true,"schema",schema)));
        HttpRequest req=HttpRequest.newBuilder(URI.create("https://api.openai.com/v1/responses"))
                .header("Authorization","Bearer "+apiKey).header("Content-Type","application/json")
                .timeout(Duration.ofSeconds(180))
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload))).build();
        HttpResponse<String> res;
        try {
            res=client.send(req,HttpResponse.BodyHandlers.ofString());
        } catch (HttpTimeoutException failure) {
            throw new IllegalStateException("HOMEWORK_AI_TIMEOUT",failure);
        } catch (java.io.IOException failure) {
            throw new IllegalStateException("HOMEWORK_AI_NETWORK",failure);
        }
        if(res.statusCode()<200||res.statusCode()>=300)throw new IllegalStateException("HOMEWORK_AI_HTTP_"+res.statusCode());
        if(res.body()==null||res.body().isBlank())throw new IllegalStateException("HOMEWORK_AI_EMPTY_RESPONSE");
        if(res.body().length()>700000)throw new IllegalStateException("HOMEWORK_AI_RESPONSE_TOO_LONG");
        Map<String,Object> body;
        try {
            body=json.readValue(res.body(),Map.class);
        } catch (RuntimeException failure) {
            throw new IllegalStateException("HOMEWORK_AI_RESPONSE_INVALID",failure);
        }
        if(body==null)throw new IllegalStateException("HOMEWORK_AI_RESPONSE_INVALID");
        if(!"completed".equals(body.get("status")))throw new IllegalStateException("HOMEWORK_AI_INCOMPLETE");
        try {
            String text=WorkbookContentService.outputText(body);
            if(text.isBlank())throw new IllegalStateException("HOMEWORK_AI_EMPTY_RESPONSE");
            return text;
        } catch (IllegalStateException failure) {
            String code=PostLessonHomeworkFailure.code(failure);
            if("AI_REFUSED".equals(code))throw new IllegalStateException("HOMEWORK_AI_REFUSED",failure);
            if("AI_EMPTY_RESPONSE".equals(code))throw new IllegalStateException("HOMEWORK_AI_EMPTY_RESPONSE",failure);
            throw failure;
        }
    }

    /**
     * PDF input is multimodal and stays attached to this pupil's generation request only.
     * The PDF's base64 bytes are NEVER embedded in the model's text context.
     */
    static Object inputWithWorksheet(Object evidence,ObjectMapper json)throws Exception{
        if(!(evidence instanceof Map<?,?> raw) || !(raw.get("_lessonWorksheetPdfBase64") instanceof String pdf))
            return json.writeValueAsString(evidence);
        Map<String,Object> safe=new LinkedHashMap<>();
        for(var entry:raw.entrySet()){
            if(!(entry.getKey() instanceof String key))continue;
            if(!key.startsWith("_"))safe.put(key,entry.getValue());
        }
        List<Map<String,Object>> parts=List.of(
                Map.of("type","input_text","text",json.writeValueAsString(safe)),
                Map.of("type","input_file","filename","lesson_worksheet.pdf",
                        "file_data","data:application/pdf;base64,"+pdf));
        return List.of(Map.of("role","user","content",parts));
    }

    /** Only explicit exclusions supported by an exact quotation may remove a recipient. */
    @SuppressWarnings("unchecked")
    public Map<String,Object> select(List<Map<String,Object>> roster,String notes)throws Exception{
        if(notes==null||notes.isBlank())return Map.of("excluded",List.of(),"personalNotes",List.of());
        Map<String,Object> excludedItem=Map.of("type","object","properties",Map.of(
            "studentId",Map.of("type","string"),"quote",Map.of("type","string")),
            "required",List.of("studentId","quote"),"additionalProperties",false);
        Map<String,Object> notesItem=Map.of("type","object","properties",Map.of(
            "studentId",Map.of("type","string"),"note",Map.of("type","string")),
            "required",List.of("studentId","note"),"additionalProperties",false);
        Map<String,Object> schema=Map.of("type","object","properties",Map.of(
            "excluded",Map.of("type","array","items",excludedItem),
            "personalNotes",Map.of("type","array","items",notesItem)),
            "required",List.of("excluded","personalNotes"),"additionalProperties",false);
        String system="""
                The teacher supplied a frozen student roster and notes. Return explicit exclusions only when
                notes clearly say not to assign to the named student. For every exclusion, return an EXACT
                contiguous quote from notes supporting the decision. Do not infer absence from attendance.
                Convert individual requests to personalNotes. Never invent student IDs or change the roster.
                All returned studentId values must come exactly from the roster. Output only JSON.
                """;
        Map<String,Object> out=json.readValue(ask(system,Map.of("roster",roster,"notes",notes),
                "homework_recipient_selection",schema),Map.class);
        Set<String> allowed=new HashSet<>();
        for(Map<String,Object> student:roster)allowed.add(String.valueOf(student.get("id")));
        for(Object item:(List<?>)out.get("excluded")){
            Map<?,?> v=(Map<?,?>)item;String id=String.valueOf(v.get("studentId"));
            String quote=String.valueOf(v.get("quote"));
            if(!allowed.contains(id)||quote.isBlank()||!notes.contains(quote))
                throw new IllegalArgumentException("HOMEWORK_RECIPIENT_AMBIGUOUS");
        }
        for(Object item:(List<?>)out.get("personalNotes"))
            if(!allowed.contains(String.valueOf(((Map<?,?>)item).get("studentId"))))
                throw new IllegalArgumentException("HOMEWORK_RECIPIENT_UNKNOWN");
        return out;
    }

    @SuppressWarnings("unchecked")
    public OwnerWorkbookPdfRenderService.StudioRender make(
            Map<String,Object> evidence,int day,int totalDays,String studentName)throws Exception {
        return make(evidence,day,totalDays,studentName,stage->{});
    }

    OwnerWorkbookPdfRenderService.StudioRender make(
            Map<String,Object> evidence,int day,int totalDays,String studentName,
            Consumer<PostLessonHomeworkStage> progress)throws Exception {
        // The model authors CONTENT ONLY; the server controls all MCH3 structures.
        // This is the same deterministic authoring contract used when a teacher
        // prepares a workbook through the school connector.
        String instructions="""
                Compose a daily mathematics practice exercise set for MINDCRAFTI.
                Follow the provided mandatory school homeworkPrompt. The attached pupil
                lesson_worksheet.pdf is the source of topics and examples, not evidence
                the pupil finished anything. Use explicit teacher instructions to select
                difficulty and subtopics. Do not invent pupil errors or achievements.
                Produce ONLY the requested task content JSON, NOT workbookPages,
                teacherPages, meta, QA structures, spacing, page design, HTML or PDF.
                For every task return one mathTokens array of short display tokens,
                e.g. ["3/4","+","1/8","=","_____"] or ["4x","+","3x","=","_____"].
                Keep the full result BLANK in the student-facing mathTokens.
                Return expression as arithmetic/algebra equation WITHOUT the blank,
                e.g. "3/4+1/8", and answer as the exact mathematical answer, e.g. "7/8".
                kind is "equivalence" for simplify/evaluate tasks, "solution" only
                for a one-variable equation like "2*x+3=7". In the latter case
                provide variable "x"; otherwise variable must be the empty string.
                solutionText is a correct, German explanation only for the PRIVATE
                teacher answers, not pupil-facing text.
                IMPORTANT pedagogical accuracy: distinguish Brüche (numeric fractions) from
                Terme (algebraic expressions). Do NOT mix them into one problem just because
                the source workbook contains both skills. Do not introduce x or an algebraic
                numerator in a simple Bruch kürzen/Bruch vereinfachen task. Such a task must
                display ONE ordinary numerical fraction (e.g. ["18/24","=","_____"])
                and the answer must be its reduced form (e.g. 3/4).
                Do NOT label division of fractions or Bruchterme as "Bruch vereinfachen".
                If the teacher explicitly wants advanced algebraic fractions, use an
                accurate advanced title such as "Bruchterme dividieren" and represent
                each complete fraction as ONE token ("(3x-2)/4", "3/8"), rather than
                splitting numerator, slash and denominator into separate tokens.
                The server formats these tokens as proper vertically stacked fractions.
                Follow the source exercises and teacher's stated difficulty; never
                escalate from a basic fraction into algebraic fractions without evidence.
                One or two independent problems, a total of at most ten minutes.
                Each task has a SHORT title and optional short description.
                For earlier days provide a concise helpful hint. For the final day,
                return hint as empty string; the entire student page, including titles,
                instructions and descriptions, must be in German, without Russian.
                For day 1..4 before the final day, a nonempty hint is mandatory.
                Do NOT include the pupil name, dates, day numbers, or solutions in
                the student title, subtitle, description, hint or mathTokens.
                The server will construct the fixed Mindcrafti layout and validate
                every mathematical expression, answer, page and PDF.
                """;
        Map<String,Object> taskFields=new LinkedHashMap<>();
        taskFields.put("title",Map.of("type","string"));
        taskFields.put("description",Map.of("type","string"));
        taskFields.put("mathTokens",Map.of("type","array","items",Map.of("type","string")));
        taskFields.put("expression",Map.of("type","string"));
        taskFields.put("answer",Map.of("type","string"));
        taskFields.put("solutionText",Map.of("type","string"));
        taskFields.put("kind",Map.of("type","string","enum",List.of("equivalence","solution")));
        taskFields.put("variable",Map.of("type","string"));
        Map<String,Object> taskSchema=Map.of("type","object","properties",taskFields,
                "required",new ArrayList<>(taskFields.keySet()),"additionalProperties",false);
        Map<String,Object> contentFields=new LinkedHashMap<>();
        contentFields.put("topic",Map.of("type","string"));
        contentFields.put("subtitle",Map.of("type","string"));
        contentFields.put("hint",Map.of("type","string"));
        contentFields.put("tasks",Map.of("type","array","items",taskSchema));
        Map<String,Object> schema=Map.of("type","object","properties",contentFields,
                "required",new ArrayList<>(contentFields.keySet()),"additionalProperties",false);
        String feedback=null;
        for(int attempt=1;attempt<=MAX_DRAFT_ATTEMPTS;attempt++){
            Map<String,Object> attemptEvidence=new LinkedHashMap<>(evidence);
            if(feedback!=null)attemptEvidence.put("serverRepairRequest",Map.of(
                    "day",day,"totalDays",totalDays,
                    "reason",feedback,
                    "instruction","Correct mathematical CONTENT only. The server owns all layout."));
            progress.accept(PostLessonHomeworkStage.AI_CONTENT);
            String contentJson=ask(instructions,attemptEvidence,"mindcrafti_homework_content",schema);
            progress.accept(PostLessonHomeworkStage.CONTENT_VALIDATION);
            Map<String,Object> content;
            try {
                content=json.readValue(contentJson,Map.class);
            } catch (RuntimeException failure) {
                throw new IllegalStateException("HOMEWORK_AI_RESPONSE_INVALID",failure);
            }
            if(content==null)throw new IllegalStateException("HOMEWORK_AI_RESPONSE_INVALID");
            String checked;
            try{
                checked=PostLessonHomeworkMch3Template.fromContent(json,content,day,totalDays,studentName);
            }catch(IllegalArgumentException rejected){
                feedback=repairFeedback(rejected);
                LOG.warn("Homework MCH3 content rejected: day={} attempt={} type={}",
                        day,attempt,rejected.getClass().getSimpleName());
                if(attempt==MAX_DRAFT_ATTEMPTS)
                    throw new IllegalStateException("HOMEWORK_DRAFT_VALIDATION_FAILED",rejected);
                continue;
            }
            progress.accept(PostLessonHomeworkStage.PDF_RENDER);
            try{
                OwnerWorkbookPdfRenderService.StudioRender pdf=renderer.renderStudio(checked);
                if(pdf.studentPages()!=1||pdf.teacherPages()<1
                        ||pdf.studentPdf().length<100||pdf.teacherPdf().length<100)
                    throw new IllegalStateException("HOMEWORK_PDF_INVALID");
                return pdf;
            }catch(IllegalArgumentException rejected){
                String reason=Objects.toString(rejected.getMessage(),"");
                // Don't repeatedly prompt Luna when the PDF executable itself fails.
                if(reason.contains("RUNTIME_UNAVAILABLE"))
                    throw new IllegalStateException("HOMEWORK_RENDERER_UNAVAILABLE",rejected);
                feedback=repairFeedback(rejected);
                LOG.warn("Homework MCH3 render rejected: day={} attempt={} category={}",
                        day,attempt,reason.startsWith("WORKBOOK_RENDER_")?reason:"RENDER_INPUT");
                if(attempt==MAX_DRAFT_ATTEMPTS)
                    throw new IllegalStateException("HOMEWORK_DRAFT_RENDER_FAILED",rejected);
            }catch(IllegalStateException rejected){
                if(!"Workbook studio QA did not pass".equals(rejected.getMessage()))throw rejected;
                feedback="Mathematical QA or physical one-page A4 layout failed. "
                        +"Use simpler, shorter mathematical tasks while preserving source topics.";
                if(attempt==MAX_DRAFT_ATTEMPTS)
                    throw new IllegalStateException("HOMEWORK_DRAFT_MATH_QA_FAILED",rejected);
            }
        }
        throw new IllegalStateException("HOMEWORK_DRAFT_VALIDATION_FAILED");
    }

    /** Repair guidance includes only the server-side validator reason, not private logs. */
    private static String repairFeedback(Exception error) {
        String reason=Objects.toString(error.getMessage(),"Unknown schema error");
        // Safety bound: provider-generated content is never copied into application logs.
        reason=reason.replaceAll("[\\r\\n\\t]+"," ").strip();
        if(reason.length()>350)reason=reason.substring(0,350);
        return "Server rejected the homework JSON: "+reason+". "
                +"Fix all violations of the Mindcrafti homework prompt without adding student answers.";
    }

    /** Server-side voice-to-text; the audio is never stored in the database. */
    public String transcribe(MultipartFile audio)throws Exception{
        // Speech transcription is independent of the model used for PDF generation.
        // A valid OPENAI_API_KEY is sufficient for audio transcription.
        if(apiKey.isEmpty())throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "Voice transcription is not configured");
        if(audio==null||audio.isEmpty()||audio.getSize()>5_000_000)
            throw new IllegalArgumentException("Voice note must be smaller than 5 MB");
        String original=Objects.toString(audio.getOriginalFilename(),"note.webm");
        String ext=original.substring(original.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        if(!Set.of("webm","ogg","mp4","m4a","mp3","wav").contains(ext))
            throw new IllegalArgumentException("Unsupported voice format");
        String boundary="mc-"+UUID.randomUUID();
        byte[] header=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n"+
                "gpt-4o-mini-transcribe\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"note."+ext+"\"\r\n"+
                "Content-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] raw=audio.getBytes(),tail=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] payload=new byte[header.length+raw.length+tail.length];
        System.arraycopy(header,0,payload,0,header.length);
        System.arraycopy(raw,0,payload,header.length,raw.length);
        System.arraycopy(tail,0,payload,header.length+raw.length,tail.length);
        HttpRequest req=HttpRequest.newBuilder(URI.create("https://api.openai.com/v1/audio/transcriptions"))
                .header("Authorization","Bearer "+apiKey)
                .header("Content-Type","multipart/form-data; boundary="+boundary)
                .timeout(Duration.ofSeconds(90)).POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build();
        HttpResponse<String> response=client.send(req,HttpResponse.BodyHandlers.ofString());
        if(response.statusCode()<200||response.statusCode()>=300) {
            // Avoid exposing provider response bodies or secrets to the browser.
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_GATEWAY,
                    "Voice transcription provider returned HTTP "+response.statusCode());
        }
        Map<String,Object> out=json.readValue(response.body(),Map.class);
        String note=String.valueOf(out.getOrDefault("text","")).strip();
        if(note.isBlank())throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY, "Speech could not be recognized");
        if(note.length()>3000)throw new IllegalArgumentException("Voice text too long");
        return note;
    }
}
