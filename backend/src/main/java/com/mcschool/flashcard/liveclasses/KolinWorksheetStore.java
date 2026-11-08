package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.PersonalLessonWorkbookService;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Short transactions only. Model and renderer work happen outside these methods. */
@Service
public class KolinWorksheetStore {
    public record Worksheet(UUID id, UUID studentId, String studentName, int taskCount, int pageCount,
                            String state, Integer fromPage, Integer toPage, java.util.List<java.util.Map<String,Object>> interactive, String targetType) {
        public Worksheet(UUID id,UUID studentId,String studentName,int taskCount,int pageCount,String state,Integer fromPage,Integer toPage,
                         java.util.List<java.util.Map<String,Object>> interactive) {
            this(id,studentId,studentName,taskCount,pageCount,state,fromPage,toPage,interactive,"student");
        }
        public Worksheet(UUID id,UUID studentId,String studentName,int taskCount,int pageCount,String state,Integer fromPage,Integer toPage) {
            this(id,studentId,studentName,taskCount,pageCount,state,fromPage,toPage,null);
        }
    }
    public record Reservation(UUID id, UUID attemptId, KolinChatService.Reply cached) {}
    public record PreparedMaterial(KolinTaskService.Content content, UUID studentId, String studentName,
                                   int pageCount, byte[] pdf, byte[] preview) {}
    private final KolinWorksheetRepository repository;
    private final OnlineClassAccessService access;
    private final PersonalLessonWorkbookService personal;
    private final KolinWorkbookAppendService append;
    private final ObjectMapper mapper;
    @org.springframework.beans.factory.annotation.Autowired
    private OnlineClassAnnotationService annotations;

    public KolinWorksheetStore(KolinWorksheetRepository repository, OnlineClassAccessService access,
            PersonalLessonWorkbookService personal, KolinWorkbookAppendService append, ObjectMapper mapper) {
        this.repository=repository; this.access=access; this.personal=personal; this.append=append; this.mapper=mapper;
    }

    @Transactional
    public Reservation begin(AuthenticatedUser teacher, UUID classId, UUID clientId, String hash) {
        OnlineClass room=access.requireHost(teacher,classId);
        repository.reserve(UUID.randomUUID(),classId,teacher.id(),clientId,hash);
        var row=repository.findRequestForUpdate(classId,teacher.id(),clientId).orElseThrow(this::missing);
        if (!hash.equals(row.getRequestHash())) throw new ConflictException("Kolyn request changed; send a new message");
        if ("READY".equals(row.getState()) || "ADDED".equals(row.getState())) {
            checkPupil(room,row);
            return new Reservation(row.getId(),row.getAttemptId(),reply(row));
        }
        requireOpen(room);
        if ("GENERATING".equals(row.getState()) && row.getUpdatedAt().isAfter(Instant.now().minusSeconds(180)))
            throw new ConflictException("KOLIN_BUSY","Kolyn is still preparing this reply; retry the same message shortly");
        row.generating();
        repository.saveAndFlush(row);
        return new Reservation(row.getId(),row.getAttemptId(),null);
    }

    @Transactional
    public KolinChatService.Reply complete(AuthenticatedUser teacher, UUID classId, UUID id, UUID attemptId,
            String type, String text, KolinTranscriptContextService.Metadata metadata,
            UUID studentId, String studentName, int taskCount, int pageCount, byte[] pdf, byte[] preview) {
        return complete(teacher,classId,id,attemptId,type,text,metadata,studentId,studentName,taskCount,pageCount,pdf,preview,null);
    }

    @Transactional
    public KolinChatService.Reply complete(AuthenticatedUser teacher, UUID classId, UUID id, UUID attemptId,
            String type, String text, KolinTranscriptContextService.Metadata metadata,
            UUID studentId, String studentName, int taskCount, int pageCount, byte[] pdf, byte[] preview,String taskContent) {
        OnlineClass room=access.requireHost(teacher,classId);
        var row=repository.findForUpdate(id,classId,teacher.id()).orElseThrow(this::missing);
        if (!attemptId.equals(row.getAttemptId()) || !"GENERATING".equals(row.getState()))
            throw new ConflictException("Kolyn request was retried; reload the result");
        requireOpen(room);
        if (studentId!=null) personal.requireClassStudent(room,studentId);
        try {
            row.complete(type,text,mapper.writeValueAsString(metadata),studentId,studentName,taskCount,pageCount,pdf,preview);
            row.rememberTasks(taskContent);
        } catch (Exception ex) { throw new IllegalStateException("Cannot store Kolyn result",ex); }
        repository.saveAndFlush(row);
        return reply(row);
    }

    @Transactional(readOnly=true)
    public String previousDraft(AuthenticatedUser teacher,UUID classId) {
        var room=access.requireHost(teacher,classId);
        var rows=repository.latestDraftContext(classId,teacher.id(),org.springframework.data.domain.PageRequest.of(0,1));
        if(rows.isEmpty()) return null;
        var row=rows.get(0);
        try {
            if(row.getStudentId()!=null) personal.requireClassStudent(room,row.getStudentId());
            var content=mapper.readValue(row.getTaskContent(),KolinTaskService.Content.class);
            if(content.materials()!=null) for(var part:content.materials())
                if(!"group".equals(part.studentId())) personal.requireClassStudent(room,UUID.fromString(part.studentId()));
        }
        catch(ResourceNotFoundException ex) { return null; }
        return row.getTaskContent();
    }

    /** All parts become visible together. A failed or stale attempt cannot leave half a reply behind. */
    @Transactional
    public KolinChatService.Reply completeMaterials(AuthenticatedUser teacher, UUID classId, UUID id, UUID attemptId,
            String text, KolinTranscriptContextService.Metadata metadata, java.util.List<PreparedMaterial> materials) {
        var room=access.requireHost(teacher,classId);
        var parent=repository.findForUpdate(id,classId,teacher.id()).orElseThrow(this::missing);
        if(!attemptId.equals(parent.getAttemptId()) || !"GENERATING".equals(parent.getState()))
            throw new ConflictException("Kolyn request was retried; reload the result");
        requireOpen(room);
        if(materials.size()!=2 || materials.stream().map(m->m.content().kind()).distinct().count()!=2
                || materials.stream().anyMatch(m->!java.util.Set.of("worksheet","interactive").contains(m.content().kind())))
            throw new IllegalArgumentException("Expected one PDF and one interactive material");
        for(var material:materials) if(material.studentId()!=null) personal.requireClassStudent(room,material.studentId());
        String transcript=mapper.writeValueAsString(metadata);
        for(int index=0;index<materials.size();index++) {
            var material=materials.get(index); var content=material.content();
            var child=KolinWorksheet.material(parent,index);
            child.complete(content.kind(),content.text(),transcript,material.studentId(),material.studentName(),
                content.tasks().size(),material.pageCount(),material.pdf(),material.preview());
            child.rememberTasks(mapper.writeValueAsString(content));
            repository.save(child);
        }
        parent.complete("materials",text,transcript,null,null,0,0,null,null);
        parent.rememberTasks(mapper.writeValueAsString(new KolinTaskService.Content("materials",text,null,java.util.List.of(),
            materials.stream().map(PreparedMaterial::content).toList())));
        repository.saveAndFlush(parent);
        return reply(parent);
    }

    @Transactional
    public void fail(AuthenticatedUser teacher, UUID classId, UUID id, UUID attemptId) {
        repository.findForUpdate(id,classId,teacher.id()).filter(row -> attemptId.equals(row.getAttemptId())
                && "GENERATING".equals(row.getState())).ifPresent(row -> { row.failed(); repository.save(row); });
    }

    @Transactional(readOnly=true)
    public byte[] file(AuthenticatedUser teacher, UUID classId, UUID id, boolean preview) {
        OnlineClass room=access.requireHost(teacher,classId);
        var row=repository.findByIdAndClassIdAndTeacherId(id,classId,teacher.id()).orElseThrow(this::missing);
        requireWorksheet(row); checkPupil(room,row);
        if(!"worksheet".equals(row.getResultType())) throw missing();
        return preview ? row.getPreviewBytes() : row.getPdfBytes();
    }

    @Transactional
    public Worksheet append(AuthenticatedUser teacher, UUID classId, UUID id) {
        OnlineClass room=access.requireHost(teacher,classId);
        var row=repository.findForUpdate(id,classId,teacher.id()).orElseThrow(this::missing);
        requireWorksheet(row); checkPupil(room,row);
        if ("ADDED".equals(row.getState())) return metadata(row);
        requireOpen(room);
        var templates=interactive(row);
        var result=append.append(teacher,room,row.getStudentId(),templates==null?row.getPdfBytes():blankPages(templates.size()));
        if(templates!=null) {
            for(int index=0;index<templates.size();index++) {
                var document=annotations.openDocument(teacher,classId,AnnotationTargetType.WHITEBOARD,
                        isGroup(row)?"board-1":PersonalBoard.workbookTargetIdFor(row.getStudentId()),result.fromPage()-1+index,595,842);
                UUID operationId=UUID.nameUUIDFromBytes((row.getId()+":"+index).getBytes(java.nio.charset.StandardCharsets.UTF_8));
                annotations.append(teacher,classId,document.id(),new com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest(
                        operationId,AnnotationOperationType.ADD,mapper.writeValueAsString(InteractiveTemplateSpec.shape(templates.get(index)))));
            }
        }
        row.added(result.fromPage(),result.toPage());
        repository.saveAndFlush(row);
        return metadata(row);
    }

    private void checkPupil(OnlineClass room,KolinWorksheet row) {
        if (row.getStudentId()!=null) personal.requireClassStudent(room,row.getStudentId());
        if("materials".equals(row.getResultType())) for(var child:children(row)) checkPupil(room,child);
    }
    private void requireWorksheet(KolinWorksheet row) {
        if (!("worksheet".equals(row.getResultType()) || "interactive".equals(row.getResultType()))
                || !("READY".equals(row.getState()) || "ADDED".equals(row.getState()))
                || row.getStudentId()==null && !isGroup(row)) throw missing();
        if("worksheet".equals(row.getResultType()) && (row.getPdfBytes()==null || row.getPreviewBytes()==null)) throw missing();
        if("interactive".equals(row.getResultType())) interactive(row);
    }
    private static void requireOpen(OnlineClass room) {
        if (room.getStatus()==OnlineClassStatus.ENDED || room.getStatus()==OnlineClassStatus.CANCELLED)
            throw new ConflictException("Lesson has ended; its workbook cannot be changed");
    }
    private KolinChatService.Reply reply(KolinWorksheet row) {
        try {
            return new KolinChatService.Reply(row.getResultType(),row.getReplyText(),
                    mapper.readValue(row.getTranscriptMetadata(),KolinTranscriptContextService.Metadata.class),
                    java.util.List.of("worksheet","interactive").contains(row.getResultType()) ? metadata(row) : null,
                    "materials".equals(row.getResultType()) ? children(row).stream().map(this::metadata).toList() : null);
        } catch (Exception ex) { throw new IllegalStateException("Cannot read Kolyn result",ex); }
    }
    private java.util.List<KolinWorksheet> children(KolinWorksheet parent) {
        var rows=repository.findByParentIdAndClassIdAndTeacherIdOrderByMaterialIndex(parent.getId(),parent.getClassId(),parent.getTeacherId());
        if(rows.size()!=2) throw missing();
        rows.forEach(this::requireWorksheet); return rows;
    }
    private Worksheet metadata(KolinWorksheet row) {
        return new Worksheet(row.getId(),row.getStudentId(),row.getStudentName(),row.getTaskCount(),row.getPageCount(),
                row.getState(),row.getFromPage(),row.getToPage(),interactive(row),isGroup(row)?"group":"student");
    }
    private boolean isGroup(KolinWorksheet row) {
        return row.getStudentId()==null && row.getTaskContent()!=null
                && "group".equals(mapper.readValue(row.getTaskContent(),KolinTaskService.Content.class).studentId());
    }
    private java.util.List<java.util.Map<String,Object>> interactive(KolinWorksheet row) {
        if(!"interactive".equals(row.getResultType())) return null;
        var content=mapper.readValue(row.getTaskContent(),KolinTaskService.Content.class);
        if(content.tasks()==null || content.tasks().isEmpty() || content.tasks().size()>5) throw missing();
        return content.tasks().stream().map(task -> InteractiveTemplateSpec.validate(task.visual())).toList();
    }
    private static byte[] blankPages(int count) {
        try(var pdf=new org.apache.pdfbox.pdmodel.PDDocument();var out=new java.io.ByteArrayOutputStream()) {
            for(int i=0;i<count;i++) pdf.addPage(new org.apache.pdfbox.pdmodel.PDPage(org.apache.pdfbox.pdmodel.common.PDRectangle.A4));
            pdf.save(out); return out.toByteArray();
        } catch(java.io.IOException ex) { throw new IllegalStateException("Cannot prepare interactive page",ex); }
    }
    private ResourceNotFoundException missing() { return new ResourceNotFoundException("Kolyn worksheet not found"); }
}
