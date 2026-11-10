package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.AiLessonPilotService;
import com.mcschool.flashcard.users.Role;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Stateless text assistance. The teacher's private, per-class thread stays in the lesson UI. */
@Service
public class KolinChatService {
    public static final int MAX_TEXT_LENGTH = 4000;
    private static final int MAX_HISTORY_CHARS = 32000;
    private final OnlineClassAccessService access;
    private final StudentGroupRepository groups;
    private final AiLessonPilotService ai;
    private final ObjectMapper mapper;
    private final KolinTranscriptContextService transcripts;
    @org.springframework.beans.factory.annotation.Autowired
    private KolinTaskService tasks;
    @org.springframework.beans.factory.annotation.Autowired
    private KolinBoardReviewService reviews;
    private final Set<UUID> pendingTeachers = ConcurrentHashMap.newKeySet();

    public KolinChatService(OnlineClassAccessService access, StudentGroupRepository groups,
                            AiLessonPilotService ai, ObjectMapper mapper, KolinTranscriptContextService transcripts) {
        this.access = access; this.groups = groups; this.ai = ai; this.mapper = mapper;
        this.transcripts = transcripts;
    }

    public record HistoryMessage(@NotBlank @Pattern(regexp="user|assistant") String role,
                                 @NotBlank @Size(max=10000) String text) {}
    public record Context(@Pattern(regexp="student|group") String targetType, UUID studentId,
                          @Min(1) @Max(1000) Integer currentWorkbookPage,
                          @Pattern(regexp="pdf|interactive") String format) {
        public Context(String targetType,UUID studentId,Integer currentWorkbookPage) { this(targetType,studentId,currentWorkbookPage,null); }
    }
    public record Request(@NotBlank @Size(max=MAX_TEXT_LENGTH) String text,
                          @Size(max=8) List<@Valid HistoryMessage> history, @Valid Context context, UUID clientMessageId,
                          @Valid KolinBoardReviewService.Snapshot boardReview) {
        public Request(String text,List<HistoryMessage> history,Context context,UUID clientMessageId) { this(text,history,context,clientMessageId,null); }
        public Request(String text,List<HistoryMessage> history,Context context) { this(text,history,context,null); }
    }
    public record Reply(String type, String text, KolinTranscriptContextService.Metadata transcriptContext,
                        KolinWorksheetStore.Worksheet worksheet, List<KolinWorksheetStore.Worksheet> materials, KolinBoardReviewService.Metadata boardContext) {
        public Reply(String type,String text,KolinTranscriptContextService.Metadata metadata,KolinWorksheetStore.Worksheet worksheet,List<KolinWorksheetStore.Worksheet> materials) {
            this(type,text,metadata,worksheet,materials,null);
        }
        public Reply withBoard(KolinBoardReviewService.Metadata board) { return board==null?this:new Reply(type,text,transcriptContext,worksheet,materials,board); }
        public Reply(String type,String text,KolinTranscriptContextService.Metadata metadata,KolinWorksheetStore.Worksheet worksheet) {
            this(type,text,metadata,worksheet,null);
        }
        public Reply(String type,String text,KolinTranscriptContextService.Metadata metadata) { this(type,text,metadata,null); }
        public Reply(String type, String text) { this(type, text, null,null); }
    }

    public Map<String, Boolean> status(AuthenticatedUser teacher, UUID classId) {
        access.requireHost(teacher, classId);
        return Map.of("configured", ai.isConfigured());
    }

    public KolinBoardReviewService.Target reviewTarget(AuthenticatedUser teacher,UUID classId,KolinBoardReviewService.TargetRequest request) {
        return reviews.resolve(teacher,classId,request);
    }

    public Reply send(AuthenticatedUser teacher, UUID classId, Request request) {
        OnlineClass room = access.requireHost(teacher, classId);
        var context = compactContext(room, request.context());
        String question = text(request.text());
        KolinBoardReviewService.Metadata board=null;
        if (reviews!=null) {
            var target=reviews.resolve(room,question,request.context());
            if (request.boardReview()!=null) {
                if(request.clientMessageId()==null) throw KolinRequestException.reviewUnavailable();
                board=reviews.validate(room,question,request.context(),request.boardReview());
                context.put("targetType",board.studentId()==null?"group":"student");
                context.put("targetName",board.studentName());
                context.put("currentWorkbookPage",board.pageNumber());
                context.put("boardReview",board);
            } else if (!"not_requested".equals(target.state())) {
                return new Reply("text",target.message()!=null?target.message():
                    "Не удалось получить текущую страницу ученика. Обновите страницу урока, попросите ученика открыть личную доску и повторите запрос.");
            }
        }
        List<Map<String, String>> history = history(request.history());
        if (!ai.isConfigured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Kolyn пока не настроен. Обратитесь к администратору.");
        if (!pendingTeachers.add(teacher.id())) throw KolinRequestException.busy();
        try {
            var transcript = transcript(room);
            context.put("transcript", transcript);
            LoggerFactory.getLogger(getClass()).info("Kolyn context: classId={} transcriptState={} transcriptSegments={} transcriptTruncated={} transcriptionActive={} boardPages={}",
                    classId,transcript.metadata().state(),transcript.metadata().segmentCount(),transcript.metadata().truncated(),
                    transcript.metadata().transcriptionActive(),board==null?0:board.pages().size());
            if (request.clientMessageId()!=null)
                return tasks.reply(teacher,room,request,context,history,question,transcript.metadata(),board);
            return new Reply("text", ai.kolinReply(mapper.writeValueAsString(context), history, question), transcript.metadata());
        } catch (KolinRequestException | com.mcschool.flashcard.common.ConflictException ex) {
            throw ex;
        } catch (Exception ex) {
            LoggerFactory.getLogger(getClass()).warn("Kolyn request failed: classId={} errorType={}", classId, ex.getClass().getSimpleName());
            throw KolinRequestException.failed();
        } finally {
            pendingTeachers.remove(teacher.id());
        }
    }

    private KolinTranscriptContextService.Context transcript(OnlineClass room) {
        try {
            return transcripts.read(room);
        } catch (RuntimeException ex) {
            LoggerFactory.getLogger(getClass()).warn("Kolyn transcript unavailable: classId={} errorType={}",
                    room.getId(), ex.getClass().getSimpleName());
            return KolinTranscriptContextService.unavailable(room);
        }
    }

    private Map<String, Object> compactContext(OnlineClass room, Context requested) {
        String type = requested == null ? null : requested.targetType();
        UUID studentId = requested == null ? null : requested.studentId();
        Integer page = requested == null ? null : requested.currentWorkbookPage();
        if (type != null && !List.of("student", "group").contains(type)) throw badRequest();
        if (page != null && (page < 1 || page > 1000)) throw badRequest();
        if ("group".equals(type) && studentId != null) throw badRequest();
        if (type == null) type = studentId != null || room.getStudent() != null ? "student" : "group";
        if ("group".equals(type) && room.getGroup() == null && room.getStudent() != null) type = "student";
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("lessonTitle", room.getTitle());
        result.put("targetType", type);
        if ("student".equals(type)) {
            if (studentId == null && room.getStudent() != null) studentId = room.getStudent().getId();
            if (studentId == null || !access.canParticipate(new AuthenticatedUser(studentId, null, Role.STUDENT), room))
                throw new ResourceNotFoundException("Student is not part of this online class");
            result.put("targetName", access.requireActiveUser(studentId).getFullName());
        } else {
            String name = room.getGroup() == null ? room.getTitle() : groups.findById(room.getGroup().getId())
                    .map(group -> group.getName()).orElse(room.getTitle());
            result.put("targetName", name);
        }
        if (page != null) result.put("currentWorkbookPage", page);
        return result;
    }

    private static List<Map<String, String>> history(List<HistoryMessage> messages) {
        if (messages == null) return List.of();
        if (messages.size() > 8) throw badRequest();
        var kept = new ArrayList<Map<String, String>>();
        int chars = 0;
        // Keep whole recent messages. Never cut an exercise in the middle to fit a character budget.
        for (var message : messages) {
            if (message == null || message.role() == null || !List.of("user", "assistant").contains(message.role())) throw badRequest();
            if(message.text()==null || message.text().isBlank() || message.text().length()>10000) throw badRequest();
        }
        for (int i=messages.size()-1; i>=0; i--) {
            var message = messages.get(i);
            String content = message.text().strip();
            if (chars + content.length() > MAX_HISTORY_CHARS) break;
            kept.add(0, Map.of("role", message.role(), "text", content)); chars += content.length();
        }
        return kept;
    }

    private static String text(String value) {
        if (value == null || value.isBlank() || value.length() > MAX_TEXT_LENGTH) throw badRequest();
        return value.strip();
    }
    private static ResponseStatusException badRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Некорректный запрос Kolyn.");
    }
}
