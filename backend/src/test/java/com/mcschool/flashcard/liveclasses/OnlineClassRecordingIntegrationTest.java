package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.RecordingResponse;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.liveclasses.provider.ClassRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.google.protobuf.util.JsonFormat;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Date;
import java.util.Optional;
import livekit.LivekitEgress;
import livekit.LivekitWebhook;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Recording lifecycle and webhook reconciliation.
 *
 * <p>Webhook signatures are produced here with the same HMAC scheme the provider
 * uses, so verification is exercised for real — no LiveKit account required.
 */
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.online-classes.livekit-url=wss://test.invalid",
        "app.online-classes.livekit-api-key=" + OnlineClassRecordingIntegrationTest.API_KEY,
        "app.online-classes.livekit-api-secret=" + OnlineClassRecordingIntegrationTest.API_SECRET,
        "app.online-classes.recording-enabled=true"
})
class OnlineClassRecordingIntegrationTest extends AbstractIntegrationTest {

    static final String API_KEY = "test-api-key";
    static final String API_SECRET = "test-api-secret-value-not-a-real-credential";

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    @Autowired
    private OnlineClassRecordingService recordingService;

    @Autowired
    private OnlineClassWebhookService webhookService;

    @Autowired
    private OnlineClassRecordingRepository recordingRepository;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassParticipantRepository participantRepository;

    @Autowired
    private UserRepository userRepository;

    @MockitoBean
    private ClassRecordingProvider recordingProvider;

    @MockitoBean
    private ClassArtifactStorage storage;

    private User teacher;
    private User student;
    private AuthenticatedUser teacherPrincipal;
    private AuthenticatedUser studentPrincipal;
    private OnlineClass onlineClass;

    @BeforeEach
    void seed() {
        teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local", "t1", END));
        student = userRepository.save(User.invitedStudent("Student", "student@test.local",
                teacher, "s1", END));
        teacherPrincipal = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
        studentPrincipal = new AuthenticatedUser(student.getId(), student.getEmail(), student.getRole());

        OnlineClass created = OnlineClass.forStudent(teacher, "event-1", "binding-1",
                "Maths", START, END, student);
        created.start(START);
        onlineClass = classRepository.save(created);

        when(recordingProvider.isConfigured()).thenReturn(true);
        when(recordingProvider.startRoomRecording(anyString(), anyString())).thenReturn("egress-1");
        when(storage.isConfigured()).thenReturn(true);
        when(storage.buildObjectKey(anyString(), anyString()))
                .thenAnswer(invocation -> "classes/" + invocation.getArgument(0) + "/recording.mp4");
        when(storage.createSignedDownloadUrl(anyString(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(Optional.of("https://storage.invalid/signed?sig=abc"));
    }

    // --- Signing helpers (mirrors the provider's scheme) ---------------------

    private static String signedAuthHeader(String body) {
        byte[] digest;
        try {
            digest = MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return JWT.create()
                .withIssuer(API_KEY)
                .withExpiresAt(new Date(System.currentTimeMillis() + 60_000))
                .withClaim("sha256", Base64.getEncoder().encodeToString(digest))
                .sign(Algorithm.HMAC256(API_SECRET));
    }

    private static String egressBody(String event, LivekitEgress.EgressStatus status,
                                     String filename, long size) throws Exception {
        LivekitEgress.EgressInfo.Builder info = LivekitEgress.EgressInfo.newBuilder()
                .setEgressId("egress-1")
                .setStatus(status);
        if (filename != null) {
            info.addFileResults(LivekitEgress.FileInfo.newBuilder()
                    .setFilename(filename)
                    .setSize(size)
                    .setDuration(120L * 1_000_000_000L)
                    .build());
        }
        LivekitWebhook.WebhookEvent webhookEvent = LivekitWebhook.WebhookEvent.newBuilder()
                .setEvent(event)
                .setEgressInfo(info.build())
                .build();
        return JsonFormat.printer().print(webhookEvent);
    }

    private void deliver(String body) {
        webhookService.handle(webhookService.verify(body, signedAuthHeader(body)));
    }

    // --- Recording lifecycle -------------------------------------------------

    @Test
    void teacherStartsRecordingAndItIsNotReadyUntilTheWebhookArrives() {
        RecordingResponse started = recordingService.start(teacherPrincipal, onlineClass.getId());

        // Starting is a request, not a result.
        assertThat(started.status()).isEqualTo(RecordingStatus.STARTING);
        assertThat(started.downloadUrl()).isNull();
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow().getRecordingState())
                .isEqualTo(ClassFeatureState.STARTING);
    }

    @Test
    void startingTwiceReturnsTheRunningRecording() {
        RecordingResponse first = recordingService.start(teacherPrincipal, onlineClass.getId());
        RecordingResponse second = recordingService.start(teacherPrincipal, onlineClass.getId());

        assertThat(second.id()).isEqualTo(first.id());
        assertThat(recordingRepository.count()).isEqualTo(1);
    }

    @Test
    void aStudentCannotStartStopOrListRecordings() {
        assertThatThrownBy(() -> recordingService.start(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> recordingService.stop(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> recordingService.list(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void recordingCannotStartOnAClassThatIsNotLive() {
        OnlineClass scheduled = classRepository.save(OnlineClass.forStudent(teacher, "event-2",
                "binding-2", "Maths", START, END, student));

        assertThatThrownBy(() -> recordingService.start(teacherPrincipal, scheduled.getId()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("live");
    }

    @Test
    void aProviderFailureIsReportedRatherThanLeavingItStuckStarting() {
        when(recordingProvider.startRoomRecording(anyString(), anyString()))
                .thenThrow(new MediaProviderException("provider down"));

        assertThatThrownBy(() -> recordingService.start(teacherPrincipal, onlineClass.getId()))
                .isInstanceOf(ConflictException.class);

        // The failure must be persisted, not rolled back with the exception —
        // otherwise the teacher sees no explanation at all.
        assertThat(recordingRepository.findAllByOnlineClassIdOrderByRequestedAtDesc(onlineClass.getId()))
                .singleElement()
                .extracting(OnlineClassRecording::getStatus)
                .isEqualTo(RecordingStatus.FAILED);
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow().getRecordingState())
                .isEqualTo(ClassFeatureState.FAILED);
    }

    @Test
    void stoppingMarksProcessingNotReady() {
        recordingService.start(teacherPrincipal, onlineClass.getId());

        RecordingResponse stopped = recordingService.stop(teacherPrincipal, onlineClass.getId());

        // Only the webhook may declare a recording ready.
        assertThat(stopped.status()).isEqualTo(RecordingStatus.PROCESSING);
    }

    @Test
    void stoppingWithNothingRunningIsRejected() {
        assertThatThrownBy(() -> recordingService.stop(teacherPrincipal, onlineClass.getId()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("No recording");
    }

    // --- Webhook verification ------------------------------------------------

    @Test
    void aWebhookWithAValidSignatureIsAccepted() throws Exception {
        recordingService.start(teacherPrincipal, onlineClass.getId());
        String body = egressBody("egress_ended", LivekitEgress.EgressStatus.EGRESS_COMPLETE,
                "classes/x/recording.mp4", 2048L);

        deliver(body);

        OnlineClassRecording recording = recordingRepository.findByEgressId("egress-1").orElseThrow();
        assertThat(recording.getStatus()).isEqualTo(RecordingStatus.READY);
        assertThat(recording.getByteSize()).isEqualTo(2048L);
        assertThat(recording.getDurationSeconds()).isEqualTo(120L);
        assertThat(recording.getDeleteAfter()).isNotNull();
    }

    @Test
    void aWebhookWithNoAuthorizationHeaderIsRejected() throws Exception {
        String body = egressBody("egress_ended", LivekitEgress.EgressStatus.EGRESS_COMPLETE,
                "f.mp4", 1L);

        assertThatThrownBy(() -> webhookService.verify(body, null))
                .isInstanceOf(WebhookVerificationException.class);
    }

    @Test
    void aWebhookSignedWithTheWrongSecretIsRejected() throws Exception {
        String body = egressBody("egress_ended", LivekitEgress.EgressStatus.EGRESS_COMPLETE,
                "f.mp4", 1L);
        String forged = JWT.create()
                .withIssuer(API_KEY)
                .withExpiresAt(new Date(System.currentTimeMillis() + 60_000))
                .withClaim("sha256", "irrelevant")
                .sign(Algorithm.HMAC256("attacker-secret"));

        assertThatThrownBy(() -> webhookService.verify(body, forged))
                .isInstanceOf(WebhookVerificationException.class);
    }

    @Test
    void aTamperedBodyIsRejectedEvenWithAValidSignature() throws Exception {
        String original = egressBody("egress_ended", LivekitEgress.EgressStatus.EGRESS_COMPLETE,
                "classes/x/recording.mp4", 2048L);
        String header = signedAuthHeader(original);
        String tampered = original.replace("2048", "999999");

        // The signature covers a SHA-256 of the raw body, so swapping the body
        // after signing must fail.
        assertThatThrownBy(() -> webhookService.verify(tampered, header))
                .isInstanceOf(WebhookVerificationException.class);
    }

    // --- Idempotency and ordering -------------------------------------------

    @Test
    void aDuplicateCompletionWebhookDoesNotChangeTheResult() throws Exception {
        recordingService.start(teacherPrincipal, onlineClass.getId());
        String body = egressBody("egress_ended", LivekitEgress.EgressStatus.EGRESS_COMPLETE,
                "classes/x/recording.mp4", 2048L);

        deliver(body);
        deliver(body);

        OnlineClassRecording recording = recordingRepository.findByEgressId("egress-1").orElseThrow();
        assertThat(recording.getStatus()).isEqualTo(RecordingStatus.READY);
        assertThat(recording.getByteSize()).isEqualTo(2048L);
        assertThat(recordingRepository.count()).isEqualTo(1);
    }

    @Test
    void aLateStartedEventCannotUndoACompletedRecording() throws Exception {
        recordingService.start(teacherPrincipal, onlineClass.getId());
        deliver(egressBody("egress_ended", LivekitEgress.EgressStatus.EGRESS_COMPLETE,
                "classes/x/recording.mp4", 2048L));

        // Out-of-order delivery must not move a finished recording backwards.
        deliver(egressBody("egress_started", LivekitEgress.EgressStatus.EGRESS_ACTIVE, null, 0L));

        assertThat(recordingRepository.findByEgressId("egress-1").orElseThrow().getStatus())
                .isEqualTo(RecordingStatus.READY);
    }

    @Test
    void aFailedEgressIsRecordedWithItsReason() throws Exception {
        recordingService.start(teacherPrincipal, onlineClass.getId());
        LivekitWebhook.WebhookEvent event = LivekitWebhook.WebhookEvent.newBuilder()
                .setEvent("egress_ended")
                .setEgressInfo(LivekitEgress.EgressInfo.newBuilder()
                        .setEgressId("egress-1")
                        .setStatus(LivekitEgress.EgressStatus.EGRESS_FAILED)
                        .setError("upload rejected")
                        .build())
                .build();

        deliver(JsonFormat.printer().print(event));

        OnlineClassRecording recording = recordingRepository.findByEgressId("egress-1").orElseThrow();
        assertThat(recording.getStatus()).isEqualTo(RecordingStatus.FAILED);
        assertThat(recording.getFailureReason()).contains("upload rejected");
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow().getRecordingState())
                .isEqualTo(ClassFeatureState.FAILED);
    }

    @Test
    void anEventForAnUnknownEgressIsIgnored() throws Exception {
        LivekitWebhook.WebhookEvent event = LivekitWebhook.WebhookEvent.newBuilder()
                .setEvent("egress_ended")
                .setEgressInfo(LivekitEgress.EgressInfo.newBuilder()
                        .setEgressId("egress-unknown")
                        .setStatus(LivekitEgress.EgressStatus.EGRESS_COMPLETE)
                        .build())
                .build();

        // Must not invent state from an event we cannot attribute.
        deliver(JsonFormat.printer().print(event));

        assertThat(recordingRepository.count()).isZero();
    }

    // --- Artifact access -----------------------------------------------------

    @Test
    void theTeacherGetsAShortLivedSignedUrlOnlyOnceReady() throws Exception {
        recordingService.start(teacherPrincipal, onlineClass.getId());

        assertThat(recordingService.list(teacherPrincipal, onlineClass.getId()))
                .singleElement()
                .extracting(RecordingResponse::downloadUrl)
                .isNull();

        deliver(egressBody("egress_ended", LivekitEgress.EgressStatus.EGRESS_COMPLETE,
                "classes/x/recording.mp4", 2048L));

        assertThat(recordingService.list(teacherPrincipal, onlineClass.getId()))
                .singleElement()
                .extracting(RecordingResponse::downloadUrl)
                .isNotNull();
    }

    @Test
    void participantsAcknowledgeTheRecordingNotice() {
        participantRepository.save(OnlineClassParticipant.student(onlineClass, student));

        recordingService.acknowledgeRecording(studentPrincipal, onlineClass.getId());

        assertThat(participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), student.getId())
                .orElseThrow().getRecordingAckAt()).isNotNull();
    }
}
