package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.stereotype.Service;

/** A teacher-requested view of one pupil page, never a background recording. */
@Service
public class KolinBoardReviewService {
    public static final int MAX_IMAGE_BYTES = 1_500_000;
    private static final String JPEG = "data:image/jpeg;base64,";
    private static final Pattern REVIEW = Pattern.compile("(?iu)(провер[ьиья]|проверь|посмотр|разбер|разоб[ер]|оцени|неправиль|ошиб|что.{0,20}реш|как.{0,20}реш|check|review|mistake|wrong|prüf|pruf|kontrollier|schau|fehler)");
    private static final Pattern WHOLE = Pattern.compile("(?iu)(всю|весь|всех.{0,10}страниц|тетрад|документ|неправиль|ошиб|что.{0,20}реш|как.{0,20}реш|workbook|document|all.{0,10}page|mistake|wrong|fehler|heft|gesamte)");
    private static final Pattern EXPLAIN = Pattern.compile("(?iu)(об[ъь]?[яе]сн|поясн|разъясн|покаж|найди|где|erklär|erklar|explain|show|find|where)");
    private static final Pattern FIRST_PAGE = Pattern.compile("(?iu)(?:перв\\p{L}*|задани\\p{L}*\\s*(?:№\\s*)?1\\b|страниц\\p{L}*\\s*(?:№\\s*)?1\\b|лист\\p{L}*\\s*(?:№\\s*)?1\\b|first\\s+(?:page|sheet|task|exercise))");
    private static final Pattern EXERCISE = Pattern.compile("(?iu)(?:задан|упражнен|пример|страниц|лист|доск|worksheet|exercise|task|page|board|seite|aufgab)");
    private static final Pattern EXPLICIT_SHARED = Pattern.compile("(?iu)(?:общ\\p{L}*\\s+(?:доск|тетрад|лист|страниц|задан)|на\\s+общ\\p{L}*|shared\\s+(?:board|worksheet)|group\\s+(?:board|worksheet))");
    private static final Pattern WORK = Pattern.compile("(?iu)(задан|решени|реша|доск|страниц|тетрад|работ|ошиб|напис|правиль|aufgab|lös|losung|seite|tafel|heft|arbeit|fehler|work|page|board|solution|answer)");
    private final OnlineClassAccessService access;
    private final KolinTaskRoster roster;
    private final OnlineClassDocumentService documents;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private KolinLessonContextService lessonContext;

    public KolinBoardReviewService(OnlineClassAccessService access, KolinTaskRoster roster, OnlineClassDocumentService documents) {
        this.access=access; this.roster=roster; this.documents=documents;
    }
    public record TargetRequest(@NotBlank @Size(max=4000) String text, @jakarta.validation.Valid KolinChatService.Context context) {}
    public record Target(String state, UUID studentId, String studentName, String message,String scope,Integer pageNumber) {
        public Target(String state,UUID id,String name,String message) { this(state,id,name,message,"current_page",null); }
        public Target(String state,UUID id,String name,String message,String scope) { this(state,id,name,message,scope,null); }
    }
    public record Page(int pageNumber,long revision,@Size(max=2000022) String imageDataUrl) {}
    public record Snapshot(UUID studentId, String boardId, int pageNumber, long documentVersion, long revision,
                           Instant observedAt, Instant capturedAt, @Size(max=2000022) String imageDataUrl,
                           String scope,int totalPageCount,@Size(max=39) List<@jakarta.validation.Valid Page> additionalPages,
                           Long sharedDocumentVersion) {
        public Snapshot(UUID id,String board,int page,long version,long revision,Instant observed,Instant captured,String image) {
            this(id,board,page,version,revision,observed,captured,image,"current_page",page,List.of(),null);
        }
        public Snapshot(UUID id,String board,int page,long version,long revision,Instant observed,Instant captured,String image,
                        String scope,int total,List<Page> extras) {
            this(id,board,page,version,revision,observed,captured,image,scope,total,extras,null);
        }
    }
    public record PageMetadata(int pageNumber,long revision,String imageSha256) {}
    public record Metadata(UUID studentId, String studentName, String boardId, int pageNumber,
                           long documentVersion, long revision, Instant capturedAt, String imageSha256,
                           String scope,int totalPageCount,List<PageMetadata> pages) {}

    public Target resolve(AuthenticatedUser teacher, UUID classId, TargetRequest request) {
        OnlineClass room=access.requireHost(teacher,classId);
        Target target=resolve(room,request.text(),request.context());
        // When the teacher explicitly asks to review a numbered task, inspect
        // its *actual saved PDF page*, not a guessed index or current pupil tab.
        if (lessonContext!=null && REVIEW.matcher(request.text()).find()
                && KolinExerciseIndex.requestedNumber(request.text())!=null
                && !"clarify".equals(target.state())) {
            try {
                var location=lessonContext.locateTask(teacher,room,request.text(),request.context());
                if(location.isPresent()) {
                    var task=location.get();
                    return new Target("ready",task.studentId(),task.studentName(),
                        null,"task_page",task.pageNumber());
                }
            } catch(RuntimeException ignored) {
                // Preserve the existing explicit-current-page flow, never fail
                // all of Kolyn because one saved PDF cannot be indexed.
            }
        }
        return target;
    }
    Target resolve(OnlineClass room, String text, KolinChatService.Context context) {
        boolean namedPage=FIRST_PAGE.matcher(text).find();
        boolean explainMaterial=EXPLAIN.matcher(text).find() && EXERCISE.matcher(text).find();
        if (!REVIEW.matcher(text).find() && !explainMaterial) return new Target("not_requested",null,null,null);
        if(Pattern.compile("(?iu)(транскрип|расшифров|сказал|произнес|gesagt|transcript|said)").matcher(text).find()
                && !Pattern.compile("(?iu)(доск|тетрад|страниц|board|page|heft|seite)").matcher(text).find())
            return new Target("not_requested",null,null,null);
        if(Pattern.compile("(?iu)^\\s*(дай|создай|сделай|подготовь|erstelle|create|generate).*(задан|pdf|интерактив|aufgab|worksheet)").matcher(text).find())
            return new Target("not_requested",null,null,null);
        String scope=namedPage?"first_page":WHOLE.matcher(text).find()?"workbook":"current_page";
        boolean explicitlyShared=EXPLICIT_SHARED.matcher(text).find();
        var pupils=roster.read(room);
        var words=Arrays.stream(normalize(text).split("[^a-z0-9]+")).filter(s->!s.isBlank()).toList();
        var matches=pupils.stream().filter(p->Arrays.stream(normalize(p.name()).split("[^a-z]+")).filter(n->n.length()>=3)
                .anyMatch(name->words.stream().anyMatch(word->nameMatches(name,word)))).toList();
        // Unicode word boundaries changed in Java 19. Keep Cyrillic names identical on Java 17/21.
        boolean explicit=Pattern.compile("(?iuU)\\b(у|для|von|bei|for|of)\\s+\\p{L}+").matcher(text).find()
                || hasUnresolvedRecipient(text);
        if(matches.isEmpty() && !explicit && !explainMaterial && !Pattern.compile("(?iu)(проверь|посмотри|разбери|оцени|check|review|prüf|kontrollier|schau)").matcher(text).find())
            return new Target("not_requested",null,null,null);
        if (matches.isEmpty() && !WORK.matcher(text).find() && !explicit)
            return new Target("not_requested",null,null,null);
        if (matches.isEmpty() && !explicit && !namedPage && !explicitlyShared && text.matches("(?s).*\\d.*")
                && KolinExerciseIndex.requestedNumber(text)==null
                && !Pattern.compile("(?iu)(доск|страниц|тетрад|учени|tafel|seite|heft|schüler|board|page|pupil)").matcher(text).find())
            return new Target("not_requested",null,null,null);
        if (matches.size()>1) return clarify();
        if (explicitlyShared) return new Target("ready",null,"Общая доска",null,scope);
        if (matches.size()==1) return ready(matches.get(0),scope);
        if (explicit) return clarify();
        if (context!=null && "group".equals(context.targetType()))
            return new Target("ready",null,"Общая доска",null,scope);
        UUID selected=context==null?null:context.studentId();
        if(selected==null && room.getStudent()!=null) selected=room.getStudent().getId();
        UUID id=selected;
        var pupil=pupils.stream().filter(p->p.id().equals(id)).findFirst();
        return pupil.map(p->ready(p,scope)).orElseGet(KolinBoardReviewService::clarify);
    }
    private static Target ready(KolinTaskRoster.Pupil pupil,String scope) { return new Target("ready",pupil.id(),pupil.name(),null,scope); }
    private static Target clarify() { return new Target("clarify",null,null,
            "Уточните имя одного ученика из этого урока или откройте его личную доску и попросите проверить решение."); }

    // Do not treat an unfamiliar name after a review verb/work noun as the selected pupil.
    private static boolean hasUnresolvedRecipient(String text) {
        var mentions=Pattern.compile("(?iuU)\\b(?:проверь|посмотри|разбери|оцени|задани[ея]|решени[ея]|работ[уыа]|тетрад[ьи])(?=\\s+(\\p{L}+))").matcher(text);
        var generic=Set.of("пожалуйста","сейчас","заодно","ещё","еще","тоже","у","для","на","в","из","с","по","и",
                "это","этот","эту","эти","текущее","текущую","всю","весь","все","всё","его","её","ее","мое","моё","мои",
                "решение","решения","задание","задания","работу","работы","тетрадь","страницу","страницы","ответ","ответы",
                "вычисления","правильность","полностью","целиком","ниже","выше","что","как","верно","правильно",
                "первую","первого","первое","первой","первый","первые","вторую","второго","второе","второй","вторые");
        while(mentions.find()) if(!generic.contains(mentions.group(1).toLowerCase(Locale.ROOT))) return true;
        return false;
    }

    // Exact names plus common case endings. No fuzzy nearest-pupil selection.
    static boolean nameMatches(String name,String word) {
        if(name.equals(word)) return true;
        String stem=name.replaceFirst("(?:iya|ia|ya|a)$","");
        return stem.length()>=3 && word.startsWith(stem)
                && Set.of("a","y","e","u","i","ia","ya","yi","ii","iyu","yu","s","as","yas","ias").contains(word.substring(stem.length()));
    }
    static String normalize(String text) {
        String value=Normalizer.normalize(text.toLowerCase(Locale.ROOT).replace('ё','е'),Normalizer.Form.NFD).replaceAll("\\p{M}","");
        String from="абвгдеэийклмнопрстуфхыьъ",to="abvgdeeijklmnoprstufhy";
        var out=new StringBuilder();
        for(char c:value.toCharArray()) {
            int at=from.indexOf(c);
            if(at>=0) { if(at<to.length()) out.append(to.charAt(at)); }
            else out.append(switch(c) { case 'ж'->"zh";case 'з'->"z";case 'ц'->"ts";case 'ч'->"ch";case 'ш'->"sh";case 'щ'->"sch";case 'ю'->"yu";case 'я'->"ya";default->String.valueOf(c); });
        }
        return out.toString();
    }

    /** Re-check the authorized recipient independently of any browser-supplied metadata. */
    public Metadata validate(OnlineClass room, String text, KolinChatService.Context context, Snapshot snapshot) {
        return validateResolved(resolve(room,text,context),snapshot);
    }

    /** Re-resolve the indexed task on the server; a forged client page is rejected. */
    public Metadata validate(AuthenticatedUser teacher, OnlineClass room, String text,
                             KolinChatService.Context context, Snapshot snapshot) {
        return validateResolved(resolve(teacher,room.getId(),new TargetRequest(text,context)),snapshot);
    }

    private Metadata validateResolved(Target target, Snapshot snapshot) {
        if(!"ready".equals(target.state()) || snapshot==null || !Objects.equals(target.studentId(),snapshot.studentId())
                || (target.studentId()==null ? !"board-1".equals(snapshot.boardId())
                    : !PersonalBoard.ownerOf(snapshot.boardId()).filter(target.studentId()::equals).isPresent())
                || snapshot.pageNumber()<1 || snapshot.pageNumber()>1000 || snapshot.documentVersion()<0 || snapshot.revision()<0
                || snapshot.capturedAt()==null || !Objects.equals(target.scope(),snapshot.scope())
                || snapshot.totalPageCount()<snapshot.pageNumber() || snapshot.totalPageCount()>1000
                || "first_page".equals(snapshot.scope()) && snapshot.pageNumber()!=1
                || "task_page".equals(snapshot.scope())
                    && (target.pageNumber()==null || target.pageNumber()!=snapshot.pageNumber())
                || snapshot.sharedDocumentVersion()!=null && snapshot.sharedDocumentVersion()<0
                || target.studentId()==null && snapshot.sharedDocumentVersion()!=null
                || target.studentId()!=null && !"workbook".equals(snapshot.scope()) && !"first_page".equals(snapshot.scope())
                    && !"task_page".equals(snapshot.scope()) && (snapshot.observedAt()==null
                    || snapshot.observedAt().isAfter(snapshot.capturedAt().plusSeconds(5))
                    || snapshot.observedAt().isBefore(snapshot.capturedAt().minusSeconds(30)))) throw KolinRequestException.reviewUnavailable();
        var pages=new ArrayList<Page>();pages.add(new Page(snapshot.pageNumber(),snapshot.revision(),snapshot.imageDataUrl()));
        if(snapshot.additionalPages()!=null) pages.addAll(snapshot.additionalPages());
        if(pages.size()>40 || !"workbook".equals(snapshot.scope()) && pages.size()!=1
                || "workbook".equals(snapshot.scope()) && pages.size()!=snapshot.totalPageCount()
                || pages.stream().anyMatch(p->p==null || p.pageNumber()<1 || p.pageNumber()>snapshot.totalPageCount() || p.revision()<0)
                || pages.stream().map(Page::pageNumber).distinct().count()!=pages.size()
                || pages.stream().mapToLong(p->p.imageDataUrl()==null?Long.MAX_VALUE/100:p.imageDataUrl().length()).sum()>16_000_000)
            throw KolinRequestException.reviewUnavailable();
        var metadata=pages.stream().map(p->new PageMetadata(p.pageNumber(),p.revision(),imageHash(p.imageDataUrl()))).toList();
        return new Metadata(target.studentId(),target.studentName(),snapshot.boardId(),snapshot.pageNumber(),snapshot.documentVersion(),
                snapshot.revision(),snapshot.capturedAt(),metadata.get(0).imageSha256(),snapshot.scope(),snapshot.totalPageCount(),metadata);
    }
    private String imageHash(String data) {
        if(data==null || !data.startsWith(JPEG) || data.length()>2_000_022) throw KolinRequestException.reviewUnavailable();
        try {
            byte[] bytes=Base64.getDecoder().decode(data.substring(JPEG.length()));
            if(bytes.length>MAX_IMAGE_BYTES || bytes.length<4 || (bytes[0]&255)!=255 || (bytes[1]&255)!=216) throw new IllegalArgumentException();
            try(var input=new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers=ImageIO.getImageReaders(input);
                if(!readers.hasNext()) throw new IllegalArgumentException();
                var reader=readers.next();
                try {
                    if(!"JPEG".equalsIgnoreCase(reader.getFormatName())) throw new IllegalArgumentException();
                    reader.setInput(input);
                    int width=reader.getWidth(0),height=reader.getHeight(0);
                    if(width<32 || height<32 || width>3072 || height>3072 || (long)width*height>6_000_000 || reader.read(0)==null)
                        throw new IllegalArgumentException();
                } finally { reader.dispose(); }
            }
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch(Exception ex) { throw KolinRequestException.reviewUnavailable(); }
    }

    /** Only fresh model calls need a current source; cached answers retain their original dated snapshot. */
    public void requireCurrent(AuthenticatedUser teacher, UUID classId, Snapshot snapshot) {
        Instant now=Instant.now();
        if(snapshot.capturedAt().isBefore(now.minusSeconds(300)) || snapshot.capturedAt().isAfter(now.plusSeconds(60)))
            throw KolinRequestException.reviewUnavailable();
        if(snapshot.studentId()==null) {
            if(!"board-1".equals(snapshot.boardId())
                    || documents.workbookVersion(teacher,classId,"board-1")!=snapshot.documentVersion())
                throw KolinRequestException.reviewUnavailable();
            return;
        }
        long personal=documents.workbookVersion(teacher,classId,PersonalBoard.workbookTargetIdFor(snapshot.studentId()));
        String expected=personal>0?PersonalBoard.workbookTargetIdFor(snapshot.studentId()):PersonalBoard.targetIdFor(snapshot.studentId());
        long version=personal>0?personal:documents.workbookVersion(teacher,classId,expected);
        if(!expected.equals(snapshot.boardId()) || version!=snapshot.documentVersion()) throw KolinRequestException.reviewUnavailable();
        Long shared=personal>0?null:documents.workbookVersion(teacher,classId,"board-1");
        if(!Objects.equals(snapshot.sharedDocumentVersion(),shared!=null&&shared>0?shared:null))
            throw KolinRequestException.reviewUnavailable();
    }
}
