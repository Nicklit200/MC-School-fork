package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentRequest;
import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentResponse;
import com.mcschool.flashcard.liveclasses.provider.ClassTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Transcription control, worker ingestion, exports and failure isolation. */
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.online-classes.livekit-url=wss://test.invalid",
        "app.online-classes.livekit-api-key=test-key",
        "app.online-classes.livekit-api-secret=test-secret",
        "app.online-classes.transcription-enabled=true",
        "app.online-classes.transcription-internal-token="
                + OnlineClassTranscriptIntegrationTest.INTERNAL_TOKEN
})
class OnlineClassTranscriptIntegrationTest extends AbstractIntegrationTest {

    static final String INTERNAL_TOKEN = "internal-worker-token-not-a-real-secret";

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    @Autowired
    private OnlineClassTranscriptService transcriptService;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassTranscriptSegmentRepository segmentRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ClassTranscriptionProvider transcriptionProvider;

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

        when(transcriptionProvider.isConfigured()).thenReturn(true);
        when(transcriptionProvider.startTranscription(anyString(), anyString(), any()))
                .thenReturn("dispatch-1");
    }

    private TranscriptSegmentRequest segment(String id, long startMs, long endMs, String text) {
        return new TranscriptSegmentRequest(id,
                ParticipantIdentity.of(student.getId(), "tab-1"),
                "Student", "de", startMs, endMs, text, 0.93);
    }

    // --- Teacher control -----------------------------------------------------

    @Test
    void theTeacherStartsAndStopsTranscription() {
        transcriptService.start(teacherPrincipal, onlineClass.getId(), List.of("de"));

        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow()
                .getTranscriptionState()).isEqualTo(ClassFeatureState.ACTIVE);

        transcriptService.stop(teacherPrincipal, onlineClass.getId());
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow()
                .getTranscriptionState()).isEqualTo(ClassFeatureState.INACTIVE);
    }

    @Test
    void startingTwiceIsANoOp() {
        transcriptService.start(teacherPrincipal, onlineClass.getId(), List.of("de"));
        transcriptService.start(teacherPrincipal, onlineClass.getId(), List.of("de"));

        org.mockito.Mockito.verify(transcriptionProvider, org.mockito.Mockito.times(1))
                .startTranscription(anyString(), anyString(), any());
    }

    @Test
    void bothProductLanguagesAreHintedWhenNoneAreGiven() {
        transcriptService.start(teacherPrincipal, onlineClass.getId(), null);

        org.mockito.Mockito.verify(transcriptionProvider)
                .startTranscription(anyString(), anyString(),
                        org.mockito.ArgumentMatchers.eq(List.of("ru", "de")));
    }

    @Test
    void aStudentCannotControlOrReadTheTranscript() {
        assertThatThrownBy(() ->
                transcriptService.start(studentPrincipal, onlineClass.getId(), List.of("de")))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> transcriptService.segments(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aProviderFailureDoesNotEndTheClass() {
        when(transcriptionProvider.startTranscription(anyString(), anyString(), any()))
                .thenThrow(new MediaProviderException("agent unavailable"));

        assertThatThrownBy(() ->
                transcriptService.start(teacherPrincipal, onlineClass.getId(), List.of("de")))
                .isInstanceOf(ConflictException.class);

        OnlineClass reloaded = classRepository.findById(onlineClass.getId()).orElseThrow();
        // Transcription failed; the class is untouched and still live.
        assertThat(reloaded.getTranscriptionState()).isEqualTo(ClassFeatureState.FAILED);
        assertThat(reloaded.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
    }

    // --- Worker ingestion ----------------------------------------------------

    @Test
    void aResentSegmentDoesNotDuplicate() {
        transcriptService.ingest(onlineClass.getId(), segment("seg-1", 0, 1000, "Guten Tag"));
        TranscriptSegmentResponse resent =
                transcriptService.ingest(onlineClass.getId(), segment("seg-1", 0, 1000, "Guten Tag"));

        assertThat(segmentRepository.count()).isEqualTo(1);
        assertThat(resent.text()).isEqualTo("Guten Tag");
    }

    @Test
    void theSpeakerIsResolvedFromTheIdentityNotFromWorkerInput() {
        TranscriptSegmentResponse stored =
                transcriptService.ingest(onlineClass.getId(), segment("seg-1", 0, 1000, "Hallo"));

        assertThat(stored.userId()).isEqualTo(student.getId());
    }

    @Test
    void anUnknownIdentityStillProducesALine() {
        TranscriptSegmentResponse stored = transcriptService.ingest(onlineClass.getId(),
                new TranscriptSegmentRequest("seg-x", "not-a-uuid", "Guest", "de",
                        0, 500, "anonymous speech", null));

        assertThat(stored.userId()).isNull();
        assertThat(stored.text()).isEqualTo("anonymous speech");
    }

    @Test
    void overlongSegmentTextIsTruncatedRatherThanRejected() {
        TranscriptSegmentResponse stored = transcriptService.ingest(onlineClass.getId(),
                segment("seg-long", 0, 1000, "a".repeat(9000)));

        assertThat(stored.text()).hasSize(OnlineClassTranscriptService.MAX_SEGMENT_TEXT_LENGTH);
    }

    // --- Internal token ------------------------------------------------------

    @Test
    void ingestionRequiresTheInternalToken() throws Exception {
        String body = """
                {"providerSegmentId":"seg-1","participantIdentity":"x","speakerLabel":"S",
                 "language":"de","startMs":0,"endMs":10,"text":"hi","confidence":0.9}
                """;
        String path = "/api/v1/internal/online-classes/" + onlineClass.getId() + "/transcript-segments";

        // No token at all.
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());

        // Wrong token.
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body)
                        .header("X-Internal-Token", "wrong-token"))
                .andExpect(status().isUnauthorized());

        // Correct token — note this is not an end-user JWT.
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body)
                        .header("X-Internal-Token", INTERNAL_TOKEN))
                .andExpect(status().isOk());
    }

    @Test
    void theInternalTokenDoesNotUnlockUserEndpoints() throws Exception {
        // The worker credential authorizes ingestion and nothing else.
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/v1/online-classes/upcoming")
                        .header("X-Internal-Token", INTERNAL_TOKEN))
                .andExpect(status().isUnauthorized());
    }

    // --- Exports -------------------------------------------------------------

    @Test
    void segmentsComeBackInPlaybackOrder() {
        transcriptService.ingest(onlineClass.getId(), segment("seg-2", 2000, 3000, "zweite"));
        transcriptService.ingest(onlineClass.getId(), segment("seg-1", 0, 1000, "erste"));

        assertThat(transcriptService.segments(teacherPrincipal, onlineClass.getId()))
                .extracting(TranscriptSegmentResponse::text)
                .containsExactly("erste", "zweite");
    }

    @Test
    void textExportIsSpeakerPrefixed() {
        transcriptService.ingest(onlineClass.getId(), segment("seg-1", 0, 1000, "erste"));

        assertThat(transcriptService.exportText(teacherPrincipal, onlineClass.getId()))
                .isEqualTo("Student: erste\n");
    }

    @Test
    void vttExportCarriesUsableTimings() {
        transcriptService.ingest(onlineClass.getId(), segment("seg-1", 0, 1500, "erste"));
        transcriptService.ingest(onlineClass.getId(), segment("seg-2", 2000, 3250, "zweite"));

        String vtt = transcriptService.exportVtt(teacherPrincipal, onlineClass.getId());

        assertThat(vtt).startsWith("WEBVTT");
        assertThat(vtt).contains("00:00:00.000 --> 00:00:01.500");
        assertThat(vtt).contains("00:00:02.000 --> 00:00:03.250");
        assertThat(vtt).contains("<v Student>erste");
    }

    @Test
    void vttTimestampsFormatHoursCorrectly() {
        assertThat(OnlineClassTranscriptService.formatTimestamp(3_723_456L))
                .isEqualTo("01:02:03.456");
        assertThat(OnlineClassTranscriptService.formatTimestamp(0L)).isEqualTo("00:00:00.000");
    }
}
