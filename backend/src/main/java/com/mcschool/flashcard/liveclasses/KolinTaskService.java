package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.AiLessonPilotService;
import com.mcschool.flashcard.lessons.OwnerWorkbookPdfRenderService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/** Single provider pass, deterministic math rendering, then a private durable draft. */
@Service
public class KolinTaskService {
    public record Task(String kind,String instruction,String expression,String answer,String variable,List<String> restrictions,Map<String,Object> visual) {
        public Task(String kind,String instruction,String expression,String answer,String variable,List<String> restrictions) {
            this(kind,instruction,expression,answer,variable,restrictions,null);
        }
    }
    public record Content(String kind,String text,String studentId,List<Task> tasks,List<Content> materials) {
        public Content(String kind,String text,String studentId,List<Task> tasks) { this(kind,text,studentId,tasks,null); }
    }
    private record Fingerprint(String text,List<KolinChatService.HistoryMessage> history,KolinChatService.Context context) {}
    private final AiLessonPilotService ai;
    private final KolinTaskRoster roster;
    private final KolinWorksheetStore store;
    private final OwnerWorkbookPdfRenderService renderer;
    private final ObjectMapper mapper;
    public KolinTaskService(AiLessonPilotService ai,KolinTaskRoster roster,KolinWorksheetStore store,
                            OwnerWorkbookPdfRenderService renderer,ObjectMapper mapper) {
        this.ai=ai; this.roster=roster; this.store=store; this.renderer=renderer; this.mapper=mapper;
    }

    public KolinChatService.Reply reply(AuthenticatedUser teacher,OnlineClass room,KolinChatService.Request request,
            Map<String,Object> context,List<Map<String,String>> history,String question,
            KolinTranscriptContextService.Metadata transcript) throws Exception {
        String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsString(
                new Fingerprint(question,history.stream().map(item -> new KolinChatService.HistoryMessage(item.get("role"),item.get("text"))).toList(),request.context()))
                .getBytes(StandardCharsets.UTF_8)));
        var reserved=store.begin(teacher,room.getId(),request.clientMessageId(),hash);
        if(reserved.cached()!=null) return reserved.cached();
        String stage="ROSTER";
        try {
            var pupils=roster.read(room);
            context.put("roster",pupils);
            String previous=store.previousDraft(teacher,room.getId());
            Content previousContent=previous==null?null:mapper.readValue(previous,Content.class);
            if(previousContent!=null) context.put("lastGeneratedWorksheet",previousContent);
            int pdfCount=requestedCount(question,previousCount(previousContent,"worksheet"),5),
                interactiveCount=requestedCount(question,previousCount(previousContent,"interactive"),1);
            context.put("requestedPdfTaskCount",pdfCount);
            context.put("requestedInteractiveTaskCount",interactiveCount);
            if(request.context()!=null && request.context().studentId()!=null)
                context.put("selectedStudentId",request.context().studentId());
            else if(room.getStudent()!=null) context.put("selectedStudentId",room.getStudent().getId());
            stage="MODEL";
            Content content=mapper.readValue(ai.kolinStructuredReply(mapper.writeValueAsString(context),history,question),Content.class);
            stage="CONTENT";
            if(content==null || content.kind()==null || content.text()==null || content.text().length()>4000
                    || content.tasks()==null) throw new IllegalArgumentException("Invalid Kolyn content");
            if("text".equals(content.kind())) {
                if(!content.tasks().isEmpty() || content.text().isBlank() || content.materials()!=null && !content.materials().isEmpty())
                    throw new IllegalArgumentException("Invalid Kolyn text reply");
                // Text has no recipient or artifact. Discard model recipient metadata here.
                stage="STORE";
                return store.complete(teacher,room.getId(),reserved.id(),reserved.attemptId(),"text",content.text(),transcript,
                        null,null,0,0,null,null);
            }
            boolean bundle="materials".equals(content.kind());
            String bundleText=content.text();
            if(bundle && (content.materials()==null || content.materials().size()!=2 || !content.tasks().isEmpty()
                    || content.materials().stream().anyMatch(m->m==null || !Set.of("worksheet","interactive").contains(m.kind()))
                    || content.materials().stream().map(Content::kind).distinct().count()!=2))
                throw new IllegalArgumentException("Invalid mixed materials");
            var parts=bundle?content.materials():List.of(content);
            var prepared=new ArrayList<KolinWorksheetStore.PreparedMaterial>();
            boolean repairUsed=false;
            for(var part:parts) {
                content=part;
                stage="CONTENT";
                if(content.text()==null || content.text().length()>4000 || content.tasks()==null
                        || content.materials()!=null && !content.materials().isEmpty())
                    throw new IllegalArgumentException("Invalid material content");
                boolean interactive="interactive".equals(content.kind());
                // A supported static cone/cylinder in the PDF must not reject a different interactive scene.
                String materialQuestion=bundle?content.text():question;
                if(interactive && unsupportedInteractive(materialQuestion,content.tasks())) {
                    String explanation="Этот интерактив пока не поддерживается. Доступны плоские построения, графики, данные, выпуклые многогранники и развёртка куба. Кривые поверхности и развёртки других тел пока не создаются. Могу объяснить тему текстом или подготовить доступный статичный рисунок в PDF.";
                    if(content.tasks().stream().anyMatch(t->t.visual()!=null&&"de".equals(t.visual().get("language"))))
                        explanation="Diese interaktive Konstruktion wird noch nicht unterstützt. Möglich sind ebene Konstruktionen, Funktionen, Daten, konvexe Polyeder und das Würfelnetz. Gekrümmte Flächen und andere Körpernetze sind noch nicht verfügbar. Ich kann das Thema erklären oder eine unterstützte statische PDF-Abbildung vorbereiten.";
                    return store.complete(teacher,room.getId(),reserved.id(),reserved.attemptId(),"text",explanation,transcript,
                        null,null,0,0,null,null);
                }
                int requiredCount=interactive?interactiveCount:pdfCount;
                if((!interactive && !"worksheet".equals(content.kind())) || content.tasks().isEmpty() || content.tasks().size()>20)
                    throw new IllegalArgumentException("Invalid Kolyn worksheet");
                // A question may mention many tasks without asking to generate any.
                if(interactive && (requiredCount<1 || requiredCount>5)) throw new IllegalArgumentException("At most five interactive templates");
                stage="CONTENT_COUNT";
                if(content.tasks().size()!=requiredCount)
                    throw new IllegalArgumentException("Unexpected worksheet task count");
                stage="CONTENT";
                if(interactive && needsInteractiveRepair(content)) {
                    if(repairUsed) throw new IllegalArgumentException("Interactive repair budget exhausted");
                    repairUsed=true;
                    // One bounded repair only, before a preview or append can be created. Normal drafts use one call.
                    String recipient=content.studentId();
                    context.put("invalidInteractiveDraft",content);
                    stage="MODEL_REPAIR";
                    content=mapper.readValue(ai.kolinStructuredReply(mapper.writeValueAsString(context),List.of(),
                        "Исправь invalidInteractiveDraft для запроса: "+question+"\n"
                        +"Верни весь interactive-черновик с прежним studentId и числом задач. Проверь ссылки: каждая вершина faces и segments обязана существовать в vertices, включая основание высоты O. Проверь выражения, границы, плоские грани и замкнутость. При answer!=null не показывай искомое в measurements или metrics; для демонстрации используй answer=null. Не меняй тему и не добавляй материал на доску."),Content.class);
                    stage="CONTENT";
                    if(content==null || !"interactive".equals(content.kind()) || !Objects.equals(recipient,content.studentId())
                        || content.text()==null || content.text().length()>4000 || content.tasks()==null
                        || content.tasks().size()!=requiredCount || needsInteractiveRepair(content) || unsupportedInteractive(materialQuestion,content.tasks()))
                        throw new IllegalArgumentException("Invalid repaired interactive draft");
                }
                stage="RECIPIENT";
                boolean group="group".equals(content.studentId());
                UUID target=group?null:UUID.fromString(content.studentId());
                var pupil=group?null:pupils.stream().filter(item -> item.id().equals(target)).findFirst()
                        .orElseThrow(() -> new IllegalArgumentException("Unknown worksheet recipient"));
                String recipientName=group?"Общая доска":pupil.name();
                if(interactive) {
                    stage="CONTENT";
                    var canonical=new ArrayList<Task>();
                    for(var task:content.tasks()) {
                        if(!"visual".equals(task.kind())) throw new IllegalArgumentException("Interactive tasks must be visual");
                        canonical.add(new Task("visual","","",null,"",List.of(),InteractiveTemplateSpec.validate(task.visual())));
                    }
                    var saved=new Content("interactive",content.text(),content.studentId(),canonical);
                    prepared.add(new KolinWorksheetStore.PreparedMaterial(saved,target,recipientName,canonical.size(),null,null));
                    continue;
                }
                long started=System.nanoTime();
                OwnerWorkbookPdfRenderService.PlainWorksheet rendered;
                Content verifiedContent;
                while(true) {
                    try {
                        stage="DOCUMENT";
                        if(requiresVisualConditions(content) && content.tasks().stream().anyMatch(task->!"visual".equals(task.kind())))
                            throw new IllegalArgumentException("Geometry conditions require checked visual tasks");
                        String document=mapper.writeValueAsString(document(content.tasks()));
                        stage="RENDER";
                        rendered=renderer.renderPlain(document);
                        stage="ANSWERS";
                        verifiedContent=withVerifiedAnswers(content,rendered.qa());
                        break;
                    } catch(IllegalArgumentException invalid) {
                        if(repairUsed) throw invalid;
                        repairUsed=true;
                        String recipient=content.studentId();
                        context.remove("invalidInteractiveDraft");
                        context.put("invalidWorksheetDraft",content);
                        context.put("worksheetRequiresVisual",requiresVisualConditions(content)
                            || content.tasks().stream().anyMatch(task->"visual".equals(task.kind())));
                        context.put("worksheetValidationStage",stage);
                        stage="MODEL_REPAIR";
                        content=mapper.readValue(ai.kolinStructuredReply(mapper.writeValueAsString(context),List.of(),
                            "Исправь invalidWorksheetDraft для запроса: "+question+"\n"
                            +"Верни только worksheet-материал с прежним studentId и числом задач. Сохрани тему и сложность. Все условия геометрии задай через visual с числовыми размерами. В expression не должно быть знака равенства или готового ответа, equation содержит только линейное уравнение. instruction использует только разрешённую короткую команду, без условий, чисел, Unicode-дробей и формул. Проверь выражения, размеры и область определения. Ответы вычисляет сервер, ничего не добавляй на доску."),Content.class);
                        stage="CONTENT";
                        if(content==null || !"worksheet".equals(content.kind()) || !Objects.equals(recipient,content.studentId())
                                || content.text()==null || content.text().length()>4000 || content.tasks()==null
                                || content.tasks().size()!=requiredCount || content.materials()!=null && !content.materials().isEmpty())
                            throw new IllegalArgumentException("Invalid repaired worksheet draft");
                    }
                }
                String summary=content.text().isBlank()?"Подготовлено "+content.tasks().size()+" заданий.":content.text();
                prepared.add(new KolinWorksheetStore.PreparedMaterial(new Content("worksheet",summary,content.studentId(),verifiedContent.tasks()),
                    target,recipientName,rendered.pageCount(),rendered.pdf(),rendered.previewPng()));
                org.slf4j.LoggerFactory.getLogger(getClass()).info("Kolyn worksheet ready: classId={} artifactId={} tasks={} pages={} renderMs={}",
                        room.getId(),reserved.id(),content.tasks().size(),rendered.pageCount(),(System.nanoTime()-started)/1_000_000);
            }
            stage="STORE";
            if(bundle) return store.completeMaterials(teacher,room.getId(),reserved.id(),reserved.attemptId(),bundleText,transcript,prepared);
            var material=prepared.get(0); var saved=material.content();
            return store.complete(teacher,room.getId(),reserved.id(),reserved.attemptId(),saved.kind(),saved.text(),transcript,
                material.studentId(),material.studentName(),saved.tasks().size(),material.pageCount(),material.pdf(),material.preview(),mapper.writeValueAsString(saved));
        } catch(Exception ex) {
            var log=org.slf4j.LoggerFactory.getLogger(getClass());
            log.warn("Kolyn generation failed: classId={} artifactId={} stage={} errorType={} reason={}",
                    room.getId(),reserved.id(),stage,ex.getClass().getSimpleName(),validationReason(ex));
            try { store.fail(teacher,room.getId(),reserved.id(),reserved.attemptId()); }
            catch(RuntimeException recovery) {
                log.warn("Kolyn failure receipt unavailable: classId={} artifactId={} errorType={}",
                        room.getId(),reserved.id(),recovery.getClass().getSimpleName());
            }
            if(ex instanceof KolinRequestException known) throw known;
            if(ex instanceof com.mcschool.flashcard.common.ConflictException conflict) throw conflict;
            if(ex instanceof org.springframework.web.server.ResponseStatusException status
                    && (status.getStatusCode().value()==503 || status.getStatusCode().value()==429))
                throw KolinRequestException.busy();
            if(Set.of("CONTENT","CONTENT_COUNT","RECIPIENT","DOCUMENT","RENDER","ANSWERS").contains(stage))
                throw KolinRequestException.invalid();
            throw KolinRequestException.failed();
        }
    }

    /** Validation assertions are built from the exact expressions displayed to pupils. */
    static Map<String,Object> document(List<Task> tasks) {
        if(tasks.stream().anyMatch(task -> "visual".equals(task.kind()))) return visualDocument(tasks);
        var pages=new ArrayList<Map<String,Object>>();
        var checks=new ArrayList<Map<String,Object>>();
        for(int offset=0;offset<tasks.size();offset+=5) {
            var rows=new ArrayList<Map<String,Object>>();
            for(int i=offset;i<Math.min(offset+5,tasks.size());i++) {
                Task task=tasks.get(i);
                if(task.visual()!=null) throw new IllegalArgumentException("Unexpected visual on algebra task");
                requireText(task.instruction(),160); requireText(task.expression(),500);
                if(task.instruction().codePoints().anyMatch(value -> Character.isDigit(value)
                        || Character.getType(value)==Character.OTHER_NUMBER || Character.getType(value)==Character.LETTER_NUMBER
                        || "=<>+*/^\\$×÷−⁄".indexOf(value)>=0))
                    throw new IllegalArgumentException("Math belongs in the checked expression field");
                if(task.restrictions()==null || task.restrictions().size()>4) throw new IllegalArgumentException("Invalid restrictions");
                task.restrictions().forEach(value -> requireText(value,60));
                Map<String,Object> check;
                if("expression".equals(task.kind())) {
                    if(task.expression().contains("=")) throw new IllegalArgumentException("Expression contains a hidden answer");
                    check=Map.of("kind","expressionValue","expression",task.expression(),"restrictions",task.restrictions());
                } else if("equation".equals(task.kind()) && Set.of("x","y","z","a","b","c","m","n").contains(task.variable())) {
                    check=Map.of("kind","linearValue","equation",task.expression(),"variable",task.variable(),
                            "restrictions",task.restrictions());
                } else throw new IllegalArgumentException("Unsupported checked math task");
                checks.add(check);
                rows.add(Map.of("label",String.valueOf(i+1)+".","math",Map.of("latex",task.expression()),
                        "text",task.instruction()+(task.restrictions().isEmpty()?"":" ("+String.join(", ",task.restrictions())+")"),"work",false));
            }
            pages.add(Map.of("title","","subtitle","","blocks",List.of(Map.of("type","exercise","number","",
                    "title","","subtitle","","rows",rows,"writeLines",0))));
        }
        return Map.of("meta",Map.of("school","MINDCRAFTI SCHOOL","durationMinutes",30,"group","","date",""),
                "workbookPages",pages,"teacherPages",List.of(Map.of("title","","subtitle","","blocks",List.of(
                    Map.of("type","text","text","Private automated answer validation")))),"qa",Map.of("algebra",checks));
    }
    /** Two diagrams per page leave writing space. Pure arithmetic stays five per page. */
    private static Map<String,Object> visualDocument(List<Task> tasks) {
        var pages=new ArrayList<Map<String,Object>>();
        var checks=new ArrayList<Map<String,Object>>();
        for(int i=0;i<tasks.size();i++) {
            Task task=tasks.get(i);
            if("visual".equals(task.kind())) {
                // The closed visual spec is authoritative. Model-supplied prose/formulas are
                // deliberately discarded, including in follow-up context, never rendered.
                if(task.visual()==null || task.visual().isEmpty())
                    throw new IllegalArgumentException("Visual conditions must come exclusively from checked parameters");
                pages.add(Map.of("title","","blocks",List.of(Map.of("type","taskCard","children",List.of(
                        Map.of("type","visualTask","number",i+1,"spec",task.visual()))))));
                checks.add(Map.of("kind","visualValue","number",i+1));
            } else {
                var single=document(List.of(task));
                @SuppressWarnings("unchecked") var singlePages=(List<Map<String,Object>>)single.get("workbookPages");
                // Keep continuous numbering in a mixed worksheet.
                @SuppressWarnings("unchecked") var blocks=(List<Map<String,Object>>)singlePages.get(0).get("blocks");
                @SuppressWarnings("unchecked") var rows=(List<Map<String,Object>>)blocks.get(0).get("rows");
                var row=new LinkedHashMap<>(rows.get(0)); row.put("label",(i+1)+".");
                var block=new LinkedHashMap<>(blocks.get(0)); block.put("rows",List.of(row));
                pages.add(Map.of("title","","blocks",List.of(block)));
                @SuppressWarnings("unchecked") var qa=(Map<String,Object>)single.get("qa");
                @SuppressWarnings("unchecked") var algebra=(List<Map<String,Object>>)qa.get("algebra");
                checks.add(algebra.get(0));
            }
        }
        var packed=new ArrayList<Map<String,Object>>();
        for(int i=0;i<pages.size();i+=2) {
            var blocks=new ArrayList<Object>((List<?>)pages.get(i).get("blocks"));
            if(i+1<pages.size()) {
                blocks.add(Map.of("type","spacer","height","14mm"));
                blocks.addAll((List<?>)pages.get(i+1).get("blocks"));
            }
            packed.add(Map.of("title","","blocks",blocks));
        }
        return Map.of("meta",Map.of("school","MINDCRAFTI SCHOOL","durationMinutes",30,"group","","date",""),
                "workbookPages",packed,"teacherPages",List.of(Map.of("title","","blocks",List.of(
                        Map.of("type","text","text","Private automated answer validation")))),"qa",Map.of("algebra",checks));
    }
    private static void requireText(String value,int maximum) {
        if(value==null || value.isBlank() || value.length()>maximum) throw new IllegalArgumentException("Invalid task text");
    }
    /** Only application-owned constant reasons may enter logs; never provider text or renderer output. */
    static String validationReason(Exception error) {
        return switch(Objects.toString(error.getMessage(),"")) {
            case "Math belongs in the checked expression field" -> "MATH_IN_INSTRUCTION";
            case "Expression contains a hidden answer" -> "EQUALITY_IN_EXPRESSION";
            case "Invalid task text" -> "TASK_TEXT";
            case "Unexpected visual on algebra task" -> "UNEXPECTED_VISUAL";
            case "Invalid restrictions" -> "RESTRICTIONS";
            case "Unsupported checked math task" -> "UNSUPPORTED_TASK";
            case "Visual conditions must come exclusively from checked parameters" -> "MISSING_VISUAL";
            case "Unexpected worksheet task count" -> "TASK_COUNT";
            case "Geometry conditions require checked visual tasks" -> "GEOMETRY_CONDITIONS";
            default -> "UNCLASSIFIED";
        };
    }
    /** A material advertised as a geometry problem must actually carry checked geometric conditions. */
    static boolean requiresVisualConditions(Content content) {
        String description=Objects.toString(content.text(),"").toLowerCase(Locale.ROOT);
        return description.matches("(?su).*(?:площад|объ[её]м|периметр|угл|угол|surface|area|volume|perimeter|fläche|umfang|volumen|winkel).*")
            && description.matches("(?su).*(?:куб|прямоуголь|треуголь|многоуголь|пирамид|призм|окружност|круг|цилиндр|конус|сфер|геометр|cube|cuboid|triangle|rectangle|polygon|pyramid|prism|circle|cylinder|cone|sphere|würfel|quader|dreieck|rechteck|kreis|kegel|kugel|geometr).*");
    }
    static Content withVerifiedAnswers(Content content,Map<String,Object> qa) {
        if(!(qa.get("results") instanceof List<?> results) || results.size()!=content.tasks().size())
            throw new IllegalArgumentException("Missing computed reference answers");
        var tasks=new ArrayList<Task>();
        for(int i=0;i<results.size();i++) {
            if(!(results.get(i) instanceof Map<?,?> row) || !Boolean.TRUE.equals(row.get("passed"))
                    || !(row.get("answer") instanceof String answer) || answer.isBlank() || answer.length()>2000)
                throw new IllegalArgumentException("Invalid computed reference answer");
            var task=content.tasks().get(i);
            tasks.add("visual".equals(task.kind())
                    ? new Task("visual","","",answer,"",List.of(),task.visual())
                    : new Task(task.kind(),task.instruction(),task.expression(),answer,task.variable(),task.restrictions(),task.visual()));
        }
        return new Content(content.kind(),content.text(),content.studentId(),tasks);
    }
    static int requestedCount(String question) {
        return requestedCount(question,0);
    }
    static boolean unsupportedInteractive(String question,List<Task> tasks) {
        String described=question+" "+tasks.stream().filter(t->t.visual()!=null)
            .map(t->Objects.toString(t.visual().get("title"),"")+" "+Objects.toString(t.visual().get("prompt"),""))
            .collect(java.util.stream.Collectors.joining(" "));
        if(java.util.regex.Pattern.compile("(?iu)\\b(?:конус[\\p{L}]*|цилиндр[\\p{L}]*|сфер[\\p{L}]*|шар(?:а|ом|ы|ов|е|у)?|cones?|cylinders?|spheres?|kegel[\\p{L}]*|zylinder[\\p{L}]*|kugel[\\p{L}]*)\\b")
            .matcher(described).find())return true;
        return java.util.regex.Pattern.compile("(?iu)(?:разв[её]ртк|entfalt|körpernetz|unfold|\\bnet\\b)").matcher(described).find()
            && tasks.stream().noneMatch(t->t.visual()!=null&&"cube".equals(t.visual().get("template")));
    }
    static boolean needsInteractiveRepair(Content content) {
        try {
            for(var task:content.tasks()) {
                if(task==null || !"visual".equals(task.kind()))return true;
                InteractiveTemplateSpec.validate(task.visual());
            }return false;
        }catch(com.mcschool.flashcard.common.ConflictException ex){return true;}
    }
    static int requestedCount(String question,int previousCount) { return requestedCount(question,previousCount,5); }
    /** Clear two-format requests may be answered with both materials or a clarification, never half a draft. */
    public static boolean requestsMixedMaterials(String question) {
        return question.matches("(?isu).*(?:интер(?:а)?ктив|interactive|interaktiv).*" )
            && question.matches("(?isu).*(?:\\bpdf\\b|пдф|печат|статич|обычн|(?:друг|отдельн|плюс)[\\p{L}]*.{0,60}(?:задан|пример|упражнен)|(?:задан|пример|упражнен).{0,60}(?:друг|отдельн)).*");
    }
    private static int previousCount(Content previous,String kind) {
        if(previous==null) return 0;
        if(kind.equals(previous.kind())) return previous.tasks().size();
        if(previous.materials()!=null) return previous.materials().stream().filter(p->kind.equals(p.kind()))
            .mapToInt(p->p.tasks().size()).findFirst().orElse(0);
        return 0;
    }
    static int requestedCount(String question,int previousCount,int defaultCount) {
        // A count attached to an interactive page must never become the PDF exercise count.
        String interactiveItem="(?:интер(?:а)?ктив[\\p{L}]*|interactive[\\p{L}]*|interaktiv[\\p{L}]*)";
        var explicitInteractive=java.util.regex.Pattern.compile("(?iu)(\\d{1,3}|одно|один|одну|два|две|три|четыре|пять|one|two|three|four|five|eine|zwei|drei|vier|fünf)\\s+"+interactiveItem).matcher(question);
        String interactiveCountPhrase=explicitInteractive.find()?explicitInteractive.group():null;
        if(defaultCount==1 && interactiveCountPhrase!=null) question=interactiveCountPhrase;
        else if(defaultCount==5) question=question.replaceAll("(?iu)(?:\\d{1,3}|[\\p{L}]+)\\s+"+interactiveItem," ");
        String item="(?:задан|пример|упражнен|интер(?:а)?ктив|interactive|interaktiv|график|диаграмм|пирамид|призм|фигур|куб|круг|aufgaben|aufgabe|tasks?|exercises?|graph|diagram|pyramid|prism)";
        var numeric=java.util.regex.Pattern.compile("(?iu)(\\d{1,3})\\s*"+item).matcher(question);
        if(numeric.find()) return Integer.parseInt(numeric.group(1));
        var words=Map.ofEntries(Map.entry("одно",1),Map.entry("один",1),Map.entry("одну",1),Map.entry("два",2),Map.entry("две",2),
                Map.entry("три",3),Map.entry("четыре",4),Map.entry("пять",5),Map.entry("шесть",6),Map.entry("семь",7),
                Map.entry("восемь",8),Map.entry("девять",9),Map.entry("десять",10),Map.entry("one",1),Map.entry("two",2),
                Map.entry("three",3),Map.entry("four",4),Map.entry("five",5),Map.entry("eine",1),Map.entry("zwei",2),
                Map.entry("drei",3),Map.entry("vier",4),Map.entry("fünf",5));
        var verbal=java.util.regex.Pattern.compile("(?iu)([\\p{L}]+)\\s+"+item).matcher(question);
        while(verbal.find()) { Integer count=words.get(verbal.group(1).toLowerCase(Locale.ROOT)); if(count!=null) return count; }
        if(previousCount>0 && !question.matches("(?isU).*\\b(?:пару|несколько|paar|einige)\\b.*")
                && question.matches("(?isu).*(?:добав|отправ|сделай\\s+(?:её|ее|его|их|выше|ниже)|втор|перв|треть|четв|пят|измени|передел|услож|упрост|сложнее|проще|schwerer|leichter|ändern|hinzufügen).*"))
            return previousCount;
        return defaultCount;
    }
}
