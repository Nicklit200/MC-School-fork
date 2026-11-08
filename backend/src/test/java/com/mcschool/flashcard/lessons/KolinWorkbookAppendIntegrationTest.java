package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.verifyNoInteractions;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.*;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.users.*;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Actual PostgreSQL migrations, row locks, annotation retargeting and confirmation receipts. */
@SpringBootTest
@TestPropertySource(properties="app.online-classes.enabled=true")
@EnabledIf("databaseAvailable")
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class KolinWorkbookAppendIntegrationTest {
    @Autowired private KolinWorkbookAppendService append;
    @Autowired private KolinWorksheetStore store;
    @Autowired private PersonalLessonWorkbookRepository workbooks;
    @Autowired private LessonPreparationRepository preparations;
    @Autowired private UserRepository users;
    @Autowired private OnlineClassRepository rooms;
    @Autowired private OnlineClassParticipantRepository participants;
    @Autowired private OnlineClassAnnotationService annotations;
    @Autowired private OnlineClassAnnotationDocumentRepository annotationDocuments;
    @Autowired private OnlineClassDocumentService documents;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactions;
    @MockitoBean private GoogleCalendarLessonService calendar;
    private User teacher,student;
    private AuthenticatedUser host,owner;
    private OnlineClass room;

    @DynamicPropertySource static void database(DynamicPropertyRegistry p){McpTestDatabase.properties(p);}
    static boolean databaseAvailable(){return McpTestDatabase.available();}
    @AfterAll static void stopDatabase(){McpTestDatabase.stop();}

    @BeforeEach void seed(){
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        teacher=users.saveAndFlush(User.activeTeacher("Other active teacher","append@test.local","append-teacher","unused"));
        student=users.saveAndFlush(User.managedStudent("Pupil",teacher));
        host=new AuthenticatedUser(teacher.getId(),null,Role.TEACHER);owner=new AuthenticatedUser(student.getId(),null,Role.STUDENT);
        var candidate=OnlineClass.forStudent(teacher,"kolin-test-event","kolin-test-event","Test",Instant.now().minusSeconds(300),Instant.now().plusSeconds(3600),student);
        candidate.start(Instant.now());room=rooms.saveAndFlush(candidate);
        var admission=OnlineClassParticipant.student(room,student);admission.admit();participants.saveAndFlush(admission);
    }

    private byte[] pdf(String... texts)throws Exception{
        try(var doc=new PDDocument();var out=new ByteArrayOutputStream()){
            for(String text:texts){var page=new PDPage();doc.addPage(page);try(var s=new PDPageContentStream(doc,page)){
                s.beginText();s.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),12);s.newLineAtOffset(40,700);s.showText(text);s.endText();}}
            doc.save(out);return out.toByteArray();
        }
    }
    private AnnotationOperationRequest stroke(){return new AnnotationOperationRequest(UUID.randomUUID(),AnnotationOperationType.ADD,
            "{\"kind\":\"text\",\"x\":0.2,\"y\":0.3,\"text\":\"ink\",\"size\":0.02}");}
    private UUID legacyPage(int page){return annotations.openDocument(host,room.getId(),AnnotationTargetType.WHITEBOARD,
            PersonalBoard.targetIdFor(student.getId()),page,800,600).id();}
    private PersonalLessonWorkbook workbook(){return workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(),room.getEventId(),student.getId()).orElseThrow();}

    private static final tools.jackson.databind.ObjectMapper JSON=new tools.jackson.databind.ObjectMapper();
    private java.util.Map<String,Object> graph(double coefficient) {
        return java.util.Map.of("template","graph","language","ru","function","linear","coefficients",List.of(coefficient,1));
    }
    private UUID interactiveDraft() {
        return interactiveDraft(false);
    }
    private List<KolinWorksheetStore.PreparedMaterial> mixedMaterials() throws Exception {
        var interactive=new KolinTaskService.Content("interactive","Общая сцена","group",List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),graph(1))));
        var worksheet=new KolinTaskService.Content("worksheet","Личная практика",student.getId().toString(),List.of(
            new KolinTaskService.Task("expression","Вычислите","1+1","2","",List.of())));
        return List.of(new KolinWorksheetStore.PreparedMaterial(interactive,null,"Общая доска",1,null,null),
            new KolinWorksheetStore.PreparedMaterial(worksheet,student.getId(),"Pupil",1,pdf("mixed practice"),new byte[]{1}));
    }
    @Test void mixedReplyKeepsPrivateIndependentArtifactsAndReplaysCurrentConfirmationReceipts()throws Exception {
        UUID client=UUID.randomUUID();String hash="c".repeat(64);
        var request=store.begin(host,room.getId(),client,hash);
        var reply=store.completeMaterials(host,room.getId(),request.id(),request.attemptId(),"Both",null,mixedMaterials());
        assertThat(reply.type()).isEqualTo("materials");assertThat(reply.worksheet()).isNull();
        assertThat(reply.materials()).hasSize(2);
        assertThat(reply.materials().get(0).targetType()).isEqualTo("group");
        assertThat(reply.materials().get(1).studentId()).isEqualTo(student.getId());
        assertThat(annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).isEmpty();
        assertThat(workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(),room.getEventId(),student.getId())).isEmpty();
        assertThat(store.begin(host,room.getId(),client,hash).cached()).isEqualTo(reply);
        assertThatThrownBy(()->store.append(host,room.getId(),request.id())).isInstanceOf(ResourceNotFoundException.class);
        var first=store.append(host,room.getId(),reply.materials().get(0).id());
        assertThat(first.state()).isEqualTo("ADDED");
        var partial=store.begin(host,room.getId(),client,hash).cached();
        assertThat(partial.materials()).extracting(KolinWorksheetStore.Worksheet::state).containsExactly("ADDED","READY");
        var second=store.append(host,room.getId(),reply.materials().get(1).id());
        // First private workbook inherits the existing shared page before appending the personal task.
        assertThat(second.fromPage()).isEqualTo(2);
        assertThat(store.append(host,room.getId(),reply.materials().get(1).id())).isEqualTo(second);
        assertThat(workbook().documentVersion()).isEqualTo(1);
        try(var parsed=Loader.loadPDF(workbook().getWorkbookPdf())) {
            assertThat(parsed.getNumberOfPages()).isEqualTo(2);
            assertThat(new PDFTextStripper().getText(parsed)).containsOnlyOnce("mixed practice");
        }
        assertThat(store.begin(host,room.getId(),client,hash).cached().materials())
            .extracting(KolinWorksheetStore.Worksheet::state).containsExactly("ADDED","ADDED");
        var previous=JSON.readValue(store.previousDraft(host,room.getId()),KolinTaskService.Content.class);
        assertThat(previous.materials()).extracting(KolinTaskService.Content::kind).containsExactly("interactive","worksheet");
    }
    @Test void mixedCompletionRollsBackAllChildrenAndRejectsStaleAttempts()throws Exception {
        UUID client=UUID.randomUUID();String hash="d".repeat(64);
        var old=store.begin(host,room.getId(),client,hash);
        store.fail(host,room.getId(),old.id(),old.attemptId());
        var request=store.begin(host,room.getId(),client,hash);
        var parts=mixedMaterials();
        assertThatThrownBy(()->store.completeMaterials(host,room.getId(),old.id(),old.attemptId(),"Old",null,parts))
            .isInstanceOf(com.mcschool.flashcard.common.ConflictException.class);
        assertThatThrownBy(()->new TransactionTemplate(transactions).execute(status->{
            store.completeMaterials(host,room.getId(),request.id(),request.attemptId(),"Both",null,parts);
            throw new IllegalStateException("Rollback");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("select count(*) from kolin_worksheets where parent_id=?",Integer.class,request.id())).isZero();
        assertThat(jdbc.queryForObject("select state from kolin_worksheets where id=?",String.class,request.id())).isEqualTo("GENERATING");
        assertThat(store.completeMaterials(host,room.getId(),request.id(),request.attemptId(),"Both",null,parts).materials()).hasSize(2);
    }
    private UUID interactiveDraft(boolean group) {
        return interactiveDraft(group,graph(1));
    }
    private UUID interactiveDraft(boolean group,java.util.Map<String,Object> spec) {
        var reservation=store.begin(host,room.getId(),UUID.randomUUID(),"b".repeat(64));
        var content=new KolinTaskService.Content("interactive","Graph",group?"group":student.getId().toString(),List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),spec)));
        store.complete(host,room.getId(),reservation.id(),reservation.attemptId(),"interactive","Graph",
            new KolinTranscriptContextService.Metadata("empty",0,false,null,null,null,false),group?null:student.getId(),group?"Общая доска":"Pupil",1,1,null,null,JSON.writeValueAsString(content));
        return reservation.id();
    }
    private AnnotationOperationRequest interaction(UUID target,UUID revision,double coefficient) {
        return interaction(target,revision,graph(coefficient));
    }
    private AnnotationOperationRequest interaction(UUID target,UUID revision,java.util.Map<String,Object> spec) {
        var shape=new java.util.HashMap<>(InteractiveTemplateSpec.shape(spec));
        shape.put("targetOperationId",target.toString());shape.put("baseOperationId",revision.toString());
        return new AnnotationOperationRequest(UUID.randomUUID(),AnnotationOperationType.UPDATE,JSON.writeValueAsString(shape));
    }
    @ParameterizedTest @ValueSource(strings={"math-scenes.json","math-solids.json"})
    @SuppressWarnings("unchecked") void sceneValuesPersistButPupilCannotRewriteTheConstruction(String fixture)throws Exception {
        var examples=JSON.readValue(java.nio.file.Files.readString(java.nio.file.Path.of("../frontend/e2e/"+fixture)),List.class);
        var scene=(java.util.Map<String,Object>)examples.get(0);
        UUID draft=interactiveDraft(false,scene);store.append(host,room.getId(),draft);
        var page=annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId()).get(0);
        var added=annotations.replay(owner,room.getId(),page.getId(),0).get(0);
        ((java.util.Map<String,Object>)((List<?>)scene.get("parameters")).get(0)).put("value",6);
        var shape=new java.util.HashMap<>(InteractiveTemplateSpec.shape(scene));
        shape.put("targetOperationId",added.operationId().toString());shape.put("baseOperationId",added.operationId().toString());
        var saved=annotations.append(owner,room.getId(),page.getId(),new AnnotationOperationRequest(UUID.randomUUID(),AnnotationOperationType.UPDATE,JSON.writeValueAsString(shape)));
        var replay=annotations.replay(host,room.getId(),page.getId(),0);assertThat(replay).hasSize(2);
        assertThat(replay.get(1).payload()).contains("\"value\":6");
        scene.put("title","Pupil replaced construction");shape.put("baseOperationId",saved.operationId().toString());
        assertThatThrownBy(()->annotations.append(owner,room.getId(),page.getId(),new AnnotationOperationRequest(UUID.randomUUID(),AnnotationOperationType.UPDATE,JSON.writeValueAsString(shape))))
                .isInstanceOf(com.mcschool.flashcard.common.ConflictException.class);
        assertThat(annotations.replay(owner,room.getId(),page.getId(),0)).hasSize(2);
    }
    @ParameterizedTest @ValueSource(strings={"graph","solid"})
    @SuppressWarnings("unchecked") void sharedConfirmationPreservesInheritedInkAndIsEditableByBothParticipants(String kind)throws Exception {
        var prep=LessonPreparation.create(teacher,room.getEventId());prep.attachWorkbook("shared.pdf",pdf("original"));preparations.saveAndFlush(prep);
        UUID oldPage=legacyPage(3);annotations.append(owner,room.getId(),oldPage,stroke());
        var spec=kind.equals("solid")?(java.util.Map<String,Object>)JSON.readValue(java.nio.file.Files.readString(java.nio.file.Path.of("../frontend/e2e/math-solids.json")),List.class).get(0):graph(1);
        UUID draft=interactiveDraft(true,spec);
        assertThat(store.previousDraft(host,room.getId())).contains("group");
        var added=store.append(host,room.getId(),draft);
        assertThat(added.targetType()).isEqualTo("group");assertThat(added.studentId()).isNull();
        assertThat(added.fromPage()).isEqualTo(5);assertThat(store.append(host,room.getId(),draft)).isEqualTo(added);
        assertThat(annotations.replay(owner,room.getId(),oldPage,0)).hasSize(1);
        assertThat(workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(),room.getEventId(),student.getId())).isEmpty();
        var shared=preparations.findByTeacherIdAndEventId(teacher.getId(),room.getEventId()).orElseThrow();
        try(var loaded=Loader.loadPDF(shared.getWorkbookPdf())) {
            assertThat(loaded.getNumberOfPages()).isEqualTo(5);assertThat(new PDFTextStripper().getText(loaded)).contains("original");
        }
        var page=annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId()).stream()
                .filter(p->p.getTargetId().equals("board-1")).findFirst().orElseThrow();
        var first=annotations.replay(owner,room.getId(),page.getId(),0).get(0);
        var changedSpec=new java.util.HashMap<>(spec);changedSpec.put(kind.equals("solid")?"yaw":"coefficients",kind.equals("solid")?45:List.of(2,0));
        var changed=annotations.append(owner,room.getId(),page.getId(),interaction(first.operationId(),first.operationId(),changedSpec));
        assertThat(annotations.replay(host,room.getId(),page.getId(),0)).hasSize(2);
        changedSpec.put(kind.equals("solid")?"pitch":"coefficients",kind.equals("solid")?15:List.of(3,0));
        annotations.append(host,room.getId(),page.getId(),interaction(first.operationId(),changed.operationId(),changedSpec));
        assertThat(annotations.replay(owner,room.getId(),page.getId(),0)).hasSize(3);
    }
    @Test void interactiveDraftNeedsConfirmationAndBothViewersReplayTheSameRevision()throws Exception {
        UUID draft=interactiveDraft();
        assertThat(workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(),room.getEventId(),student.getId())).isEmpty();
        assertThat(annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).isEmpty();
        var added=store.append(host,room.getId(),draft);
        assertThat(store.append(host,room.getId(),draft)).isEqualTo(added);
        assertThat(added.interactive()).containsExactly(graph(1));assertThat(workbook().documentVersion()).isEqualTo(1);
        var page=annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId()).get(0);
        var initial=annotations.replay(owner,room.getId(),page.getId(),0);
        assertThat(initial).hasSize(1);UUID target=initial.get(0).operationId();
        var request=interaction(target,target,2);
        var saved=annotations.append(owner,room.getId(),page.getId(),request);
        assertThat(annotations.append(owner,room.getId(),page.getId(),request))
            .usingRecursiveComparison().ignoringFields("createdAt").isEqualTo(saved);
        assertThat(annotations.replay(host,room.getId(),page.getId(),0)).isEqualTo(annotations.replay(owner,room.getId(),page.getId(),0));
        assertThatThrownBy(()->annotations.append(host,room.getId(),page.getId(),interaction(target,target,3)))
            .isInstanceOf(com.mcschool.flashcard.common.ConflictException.class);
        annotations.append(host,room.getId(),page.getId(),interaction(target,saved.operationId(),3));
        assertThat(annotations.replay(owner,room.getId(),page.getId(),0)).hasSize(3);
        var outsider=users.saveAndFlush(User.managedStudent("Other",teacher));
        assertThatThrownBy(()->annotations.replay(new AuthenticatedUser(outsider.getId(),null,Role.STUDENT),room.getId(),page.getId(),0))
            .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(()->annotations.append(owner,room.getId(),page.getId(),new AnnotationOperationRequest(UUID.randomUUID(),AnnotationOperationType.ADD,
            JSON.writeValueAsString(InteractiveTemplateSpec.shape(graph(1)))))).isInstanceOf(ResourceNotFoundException.class);
        // Replacing a template with an ordinary text UPDATE must not bypass validation.
        assertThatThrownBy(()->annotations.append(host,room.getId(),page.getId(),new AnnotationOperationRequest(UUID.randomUUID(),AnnotationOperationType.UPDATE,
            JSON.writeValueAsString(java.util.Map.of("kind","text","x",0.2,"y",0.2,"text","replacement","targetOperationId",target.toString())))))
            .isInstanceOf(com.mcschool.flashcard.common.ConflictException.class);
        try(var pdf=Loader.loadPDF(workbook().getWorkbookPdf())){assertThat(pdf.getNumberOfPages()).isEqualTo(1);}
    }
    @Test void concurrentInteractiveChangesHaveOneWinnerAndNeverOverwriteSilently()throws Exception {
        store.append(host,room.getId(),interactiveDraft());
        var page=annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId()).get(0);
        UUID target=annotations.replay(owner,room.getId(),page.getId(),0).get(0).operationId();
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try {
            var teacherChange=pool.submit(()->{start.await();try{annotations.append(host,room.getId(),page.getId(),interaction(target,target,2));return true;}
                catch(com.mcschool.flashcard.common.ConflictException ex){return false;}});
            var pupilChange=pool.submit(()->{start.await();try{annotations.append(owner,room.getId(),page.getId(),interaction(target,target,3));return true;}
                catch(com.mcschool.flashcard.common.ConflictException ex){return false;}});
            start.countDown();assertThat(teacherChange.get(15,TimeUnit.SECONDS)^pupilChange.get(15,TimeUnit.SECONDS)).isTrue();
            assertThat(annotations.replay(owner,room.getId(),page.getId(),0)).hasSize(2);
        } finally {start.countDown();pool.shutdownNow();}
    }
    @Test void failedInteractiveConfirmationRollsBackPdfObjectAndReceiptTogether() {
        UUID draft=interactiveDraft();
        assertThatThrownBy(()->new TransactionTemplate(transactions).execute(status->{
            store.append(host,room.getId(),draft);throw new IllegalStateException("test rollback");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).isEmpty();
        assertThat(workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(),room.getEventId(),student.getId())).isEmpty();
        assertThat(store.append(host,room.getId(),draft).state()).isEqualTo("ADDED");
        assertThat(annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).hasSize(1);
    }

    @Test void firstAssignmentPreservesBackgroundInkBlankPagesAndStaleClientWritesForAnyActiveTeacher()throws Exception{
        byte[] shared=pdf("inherited one","inherited two");
        var prep=LessonPreparation.create(teacher,room.getEventId());prep.attachWorkbook("shared.pdf",shared);preparations.saveAndFlush(prep);
        UUID page=legacyPage(0);legacyPage(4);var originalStroke=stroke();annotations.append(owner,room.getId(),page,originalStroke);
        var result=append.append(host,room,student.getId(),pdf("new exercise"));
        assertThat(result).isEqualTo(new KolinWorkbookAppendService.Result(6,6,1));
        assertThat(annotationDocuments.findById(page).orElseThrow().getTargetId()).isEqualTo(PersonalBoard.workbookTargetIdFor(student.getId()));
        assertThat(annotations.replay(owner,room.getId(),page,0)).extracting(event->event.operationId()).containsExactly(originalStroke.operationId());
        var inFlightOldDocumentStroke=stroke();annotations.append(owner,room.getId(),page,inFlightOldDocumentStroke);
        assertThat(annotations.replay(owner,room.getId(),page,0)).hasSize(2);
        var staleOpen=annotations.openDocument(owner,room.getId(),AnnotationTargetType.WHITEBOARD,
                PersonalBoard.targetIdFor(student.getId()),6,800,600);
        assertThat(staleOpen.targetId()).isEqualTo(PersonalBoard.workbookTargetIdFor(student.getId()));
        assertThat(annotationDocuments.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId()))
                .noneMatch(d->d.getTargetId().equals(PersonalBoard.targetIdFor(student.getId())));
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(),room.getEventId()).orElseThrow().getWorkbookPdf()).isEqualTo(shared);
        String privateTarget=PersonalBoard.workbookTargetIdFor(student.getId());
        assertThat(documents.workbook(owner,room.getId(),privateTarget)).contains(workbook().getWorkbookPdf());
        assertThat(documents.workbookVersion(owner,room.getId(),privateTarget)).isEqualTo(1);
        assertThat(documents.workbookVersion(host,room.getId(),privateTarget)).isEqualTo(1);
        var outsider=users.saveAndFlush(User.managedStudent("Outsider",teacher));
        var outsiderPrincipal=new AuthenticatedUser(outsider.getId(),null,Role.STUDENT);
        assertThatThrownBy(()->documents.workbook(outsiderPrincipal,room.getId(),privateTarget)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(()->documents.workbookVersion(outsiderPrincipal,room.getId(),privateTarget)).isInstanceOf(ResourceNotFoundException.class);
        try(var merged=Loader.loadPDF(workbook().getWorkbookPdf())){
            assertThat(merged.getNumberOfPages()).isEqualTo(6);
            assertThat(new PDFTextStripper().getText(merged)).contains("inherited one","inherited two","new exercise");
            assertThat(merged.getPage(4).getMediaBox().getWidth()/merged.getPage(4).getMediaBox().getHeight()).isEqualTo(800f/600f);
        }
        verifyNoInteractions(calendar);
    }

    @Test void appendWaitsForAnInflightStrokeAndRetainsItsDocumentAndOperation()throws Exception{
        UUID page=legacyPage(3);var operation=stroke();
        var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var appendStarted=new CountDownLatch(1);
        var appendPid=new AtomicInteger();var pool=Executors.newFixedThreadPool(2);byte[] generated=pdf("after concurrent ink");
        try{
            var writing=pool.submit(()->new TransactionTemplate(transactions).execute(status->{
                annotations.append(owner,room.getId(),page,operation);entered.countDown();
                try{if(!release.await(10,TimeUnit.SECONDS))throw new AssertionError("Lock test timed out");}catch(InterruptedException e){throw new RuntimeException(e);}return true;
            }));
            assertThat(entered.await(5,TimeUnit.SECONDS)).isTrue();
            var appending=pool.submit(()->new TransactionTemplate(transactions).execute(status->{
                appendPid.set(jdbc.queryForObject("select pg_backend_pid()",Integer.class));appendStarted.countDown();
                return append.append(host,room,student.getId(),generated);
            }));
            assertThat(appendStarted.await(5,TimeUnit.SECONDS)).isTrue();
            boolean blocked=false;long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
            while(System.nanoTime()<deadline&&!blocked){blocked=Boolean.TRUE.equals(jdbc.queryForObject(
                    "select cardinality(pg_blocking_pids(?)) > 0",Boolean.class,appendPid.get()));if(!blocked)Thread.sleep(20);}
            assertThat(blocked).as("exclusive append must wait for the annotation writer's shared class lock").isTrue();
            assertThat(appending.isDone()).isFalse();release.countDown();assertThat(writing.get(10,TimeUnit.SECONDS)).isTrue();
            assertThat(appending.get(10,TimeUnit.SECONDS).fromPage()).isEqualTo(5);
            assertThat(annotations.replay(owner,room.getId(),page,0)).extracting(event->event.operationId()).containsExactly(operation.operationId());
            assertThat(annotationDocuments.findById(page).orElseThrow().getTargetId()).isEqualTo(PersonalBoard.workbookTargetIdFor(student.getId()));
        }finally{release.countDown();pool.shutdownNow();}
    }

    @Test void twoConfirmationsOfTheSameDurableArtifactAppendExactlyOnce()throws Exception{
        byte[] generated=pdf("only once");
        var reservation=store.begin(host,room.getId(),UUID.randomUUID(),"a".repeat(64));
        store.complete(host,room.getId(),reservation.id(),reservation.attemptId(),"worksheet","Ready",
                new KolinTranscriptContextService.Metadata("empty",0,false,null,null,null,false),student.getId(),"Pupil",1,1,generated,new byte[]{1,2,3});
        assertThat(jdbc.queryForObject("select to_regclass('public.kolin_worksheets')::text",String.class)).isEqualTo("kolin_worksheets");
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try{
            Callable<KolinWorksheetStore.Worksheet> call=()->{start.await();return store.append(host,room.getId(),reservation.id());};
            var first=pool.submit(call);var second=pool.submit(call);start.countDown();
            var a=first.get(15,TimeUnit.SECONDS);var b=second.get(15,TimeUnit.SECONDS);
            assertThat(a).isEqualTo(b);assertThat(a.state()).isEqualTo("ADDED");assertThat(a.fromPage()).isEqualTo(1);assertThat(a.toPage()).isEqualTo(1);
            assertThat(workbook().documentVersion()).isEqualTo(1);
            try(var merged=Loader.loadPDF(workbook().getWorkbookPdf())){assertThat(merged.getNumberOfPages()).isEqualTo(1);assertThat(new PDFTextStripper().getText(merged)).containsOnlyOnce("only once");}
        }finally{start.countDown();pool.shutdownNow();}
        verifyNoInteractions(calendar);
    }

    @Test void outerConfirmationRollbackRestoresAnnotationScopeAndDoesNotLeaveAPrivatePdf()throws Exception{
        UUID page=legacyPage(0);var operation=stroke();annotations.append(owner,room.getId(),page,operation);byte[] generated=pdf("rolled back");
        assertThatThrownBy(()->new TransactionTemplate(transactions).execute(status->{
            append.append(host,room,student.getId(),generated);throw new IllegalStateException("Confirmation failed after append");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(),room.getEventId(),student.getId())).isEmpty();
        assertThat(annotationDocuments.findById(page).orElseThrow().getTargetId()).isEqualTo(PersonalBoard.targetIdFor(student.getId()));
        assertThat(annotations.replay(owner,room.getId(),page,0)).extracting(event->event.operationId()).containsExactly(operation.operationId());
    }
}
