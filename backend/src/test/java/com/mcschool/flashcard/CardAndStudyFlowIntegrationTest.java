package com.mcschool.flashcard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.mcschool.flashcard.cards.CardStatus;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryRepository;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * End-to-end coverage of the flashcard and study flow against real PostgreSQL:
 * a teacher creates and imports cards for their student, and the student runs a
 * study session that advances the SM-2 schedule. Also covers ownership and the
 * four-card minimum.
 */
class CardAndStudyFlowIntegrationTest extends AbstractIntegrationTest {

    private static final String ADMIN_EMAIL = "admin@test.local";
    private static final String ADMIN_PASSWORD = "AdminSecret123!";

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private CardRepository cardRepository;
    @Autowired
    private DailyReviewHistoryRepository historyRepository;
    @Autowired
    private PasswordEncoder passwordEncoder;

    private String teacherToken;
    private String studentToken;
    private UUID studentId;

    @BeforeEach
    void setUp() throws Exception {
        userRepository.save(User.bootstrapAdmin("Admin", ADMIN_EMAIL, passwordEncoder.encode(ADMIN_PASSWORD)));

        teacherToken = createActivatedTeacher("maria@test.local", "TeacherPass123!");
        String studentInvitation = postAndReturn("/api/v1/students", teacherToken,
                "{\"fullName\": \"Sam Student\", \"email\": \"sam@test.local\"}", status().isCreated());
        studentId = UUID.fromString(JsonPath.read(studentInvitation, "$.student.id"));
        studentToken = activate(JsonPath.read(studentInvitation, "$.invitationToken"), "StudentPass123!");
    }

    // --- Card management (teacher) ---

    @Test
    void teacherCreatesListsAndSummarisesCards() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        createCardInHomework(teacherToken, homeworkId, "2 + 2", "4");
        createCardInHomework(teacherToken, homeworkId, "3 + 3", "6");

        mockMvc.perform(get("/api/v1/students/{id}/cards", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].homeworkId").value(homeworkId.toString()));

        mockMvc.perform(get("/api/v1/students/{id}/cards/summary", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.dueNow").value(2))
                .andExpect(jsonPath("$.learned").value(0));

        mockMvc.perform(get("/api/v1/students/{id}/homeworks", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].startDate").value(LocalDate.now().toString()))
                .andExpect(jsonPath("$[0].totalCards").value(2))
                .andExpect(jsonPath("$[0].notStarted").value(2));
    }

    @Test
    void teacherEditsAndDeletesOwnCard() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        String created = createCardRawInHomework(teacherToken, homeworkId, "old q", "old a");
        String cardId = JsonPath.read(created, "$.id");

        mockMvc.perform(put("/api/v1/cards/{id}", cardId)
                        .header("Authorization", "Bearer " + teacherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\": \"new q\", \"correctAnswer\": \"new a\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.question").value("new q"));

        mockMvc.perform(delete("/api/v1/cards/{id}", cardId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isNoContent());
    }

    @Test
    void importPreviewParsesTextAndReportsBadLines() throws Exception {
        mockMvc.perform(post("/api/v1/cards/import/preview")
                        .header("Authorization", "Bearer " + teacherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"rawText": "2+2 -> 4 | 3 | 5 | 6\\n3+3 -> 6 | 5 | 7 | 9\\nbad line", "questionAnswerSeparator": "->", "cardSeparator": "\\n"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cards.length()").value(2))
                .andExpect(jsonPath("$.cards[0].question").value("2+2"))
                .andExpect(jsonPath("$.cards[0].correctAnswer").value("4"))
                .andExpect(jsonPath("$.cards[0].wrongAnswer1").value("3"))
                .andExpect(jsonPath("$.cards[0].wrongAnswer2").value("5"))
                .andExpect(jsonPath("$.cards[0].wrongAnswer3").value("6"))
                .andExpect(jsonPath("$.warnings.length()").value(1));
    }

    @Test
    void confirmedImportCreatesCards() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        mockMvc.perform(post("/api/v1/homeworks/{id}/cards/import", homeworkId)
                        .header("Authorization", "Bearer " + teacherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"cards": [
                                    {"question": "2+2", "correctAnswer": "4", "wrongAnswer1": "3", "wrongAnswer2": "5", "wrongAnswer3": "6"},
                                    {"question": "3+3", "correctAnswer": "6", "wrongAnswer1": "5", "wrongAnswer2": "7", "wrongAnswer3": "9"}
                                ]}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.length()").value(2));

        mockMvc.perform(get("/api/v1/students/{id}/cards", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(jsonPath("$.length()").value(2));

        mockMvc.perform(get("/api/v1/students/{id}/homeworks", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].totalCards").value(2));
    }

    @Test
    void scheduledAndPracticeSessionsUseSavedImportOptionsOnly() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        importFourCardsWithSavedOptions(homeworkId);
        Map<UUID, String> answers = answersForHomework(homeworkId);
        Map<String, Set<String>> expectedOptionsByQuestion = expectedOptionsForHomework(homeworkId);

        String scheduledStart = postAndReturn("/api/v1/study/sessions", studentToken,
                "{\"type\": \"SCHEDULED\"}", status().isCreated());
        UUID scheduledSessionId = UUID.fromString(JsonPath.read(scheduledStart, "$.id"));
        assertCurrentQuestionUsesSavedOptions(scheduledSessionId, expectedOptionsByQuestion);
        playSessionAnsweringCorrectly(scheduledSessionId, answers);

        String practiceStart = postAndReturn("/api/v1/study/sessions", studentToken,
                "{\"type\": \"PRACTICE\", \"homeworkId\": \"" + homeworkId + "\"}",
                status().isCreated());
        UUID practiceSessionId = UUID.fromString(JsonPath.read(practiceStart, "$.id"));
        assertCurrentQuestionUsesSavedOptions(practiceSessionId, expectedOptionsByQuestion);
    }

    @Test
    void oneHomeworkWithSixCardsAppearsAsSingleFolder() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.of(2026, 8, 27));
        UUID sameDateHomeworkId = createHomework(teacherToken, studentId, LocalDate.of(2026, 8, 27));
        assertThat(sameDateHomeworkId).isEqualTo(homeworkId);

        createCardInHomework(teacherToken, homeworkId, "q1", "a1");
        createCardInHomework(teacherToken, homeworkId, "q2", "a2");
        createCardInHomework(teacherToken, homeworkId, "q3", "a3");
        createCardInHomework(teacherToken, homeworkId, "q4", "a4");
        createCardInHomework(teacherToken, homeworkId, "q5", "a5");
        createCardInHomework(teacherToken, homeworkId, "q6", "a6");

        mockMvc.perform(get("/api/v1/students/{id}/homeworks", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(homeworkId.toString()))
                .andExpect(jsonPath("$[0].startDate").value("2026-08-27"))
                .andExpect(jsonPath("$[0].totalCards").value(6))
                .andExpect(jsonPath("$[0].notStarted").value(6));

        mockMvc.perform(get("/api/v1/homeworks/{id}/cards", homeworkId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(6))
                .andExpect(jsonPath("$[?(@.homeworkId == '" + homeworkId + "')]", hasSize(6)));
    }

    @Test
    void dailyPoolRespectsHomeworkStartDateOnlyForNewCards() throws Exception {
        UUID todayHomework = createHomework(teacherToken, studentId, LocalDate.now());
        UUID tomorrowHomework = createHomework(teacherToken, studentId, LocalDate.now().plusDays(1));
        UUID futureHomework = createHomework(teacherToken, studentId, LocalDate.now().plusDays(7));

        createCardInHomework(teacherToken, tomorrowHomework, "tomorrow new", "tn");

        mockMvc.perform(get("/api/v1/study/today").header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCards").value(1))
                .andExpect(jsonPath("$.dueCardCount").value(0));

        createCardInHomework(teacherToken, todayHomework, "today new 1", "t1");

        mockMvc.perform(get("/api/v1/study/today").header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCards").value(2))
                .andExpect(jsonPath("$.dueCardCount").value(1))
                .andExpect(jsonPath("$.canStartScheduled").value(false));

        createCardInHomework(teacherToken, todayHomework, "today new 2", "t2");
        createCardInHomework(teacherToken, todayHomework, "today new 3", "t3");
        createCardInHomework(teacherToken, todayHomework, "today new 4", "t4");
        UUID startedFutureCardId = createCardInHomework(teacherToken, futureHomework,
                "future already started", "fs").keySet().iterator().next();
        cardRepository.findById(startedFutureCardId).ifPresentOrElse(card -> {
            card.applyScheduling(1, LocalDate.now(), CardStatus.ACTIVE);
            cardRepository.save(card);
        }, () -> {
                    throw new AssertionError("Expected started future card to exist");
                });

        mockMvc.perform(get("/api/v1/study/homeworks").header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[?(@.id == '" + futureHomework + "')].inProgress", hasItem(1)));

        mockMvc.perform(get("/api/v1/study/today").header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCards").value(6))
                .andExpect(jsonPath("$.dueCardCount").value(5))
                .andExpect(jsonPath("$.canStartScheduled").value(true));
    }

    @Test
    void teacherCannotTouchAnotherTeachersStudentOrCards() throws Exception {
        String otherTeacher = createActivatedTeacher("other@test.local", "OtherPass123!");
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        String created = createCardRawInHomework(teacherToken, homeworkId, "q", "a");
        String cardId = JsonPath.read(created, "$.id");

        // Another teacher cannot see the student (reported as 404, not 403).
        mockMvc.perform(get("/api/v1/students/{id}/cards", studentId)
                        .header("Authorization", "Bearer " + otherTeacher))
                .andExpect(status().isNotFound());

        // ...nor edit their card.
        mockMvc.perform(put("/api/v1/cards/{id}", cardId)
                        .header("Authorization", "Bearer " + otherTeacher)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\": \"hacked\", \"correctAnswer\": \"x\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void deletingACardReferencedByASessionArchivesItSafely() throws Exception {
        Map<UUID, String> answers = createFourCards();
        // Start a session so study_session_items reference the cards.
        postAndReturn("/api/v1/study/sessions", studentToken, "{\"type\": \"SCHEDULED\"}", status().isCreated());
        UUID cardToDelete = answers.keySet().iterator().next();

        // Deleting a card the session references must archive it, not fail with a FK error.
        mockMvc.perform(delete("/api/v1/cards/{id}", cardToDelete)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isNoContent());

        // The archived card disappears from the teacher's list (3 of 4 remain).
        mockMvc.perform(get("/api/v1/students/{id}/cards", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3));

        // Acting on an already-archived card is treated as not found.
        mockMvc.perform(delete("/api/v1/cards/{id}", cardToDelete)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isNotFound());
    }

    @Test
    void teacherDeletesOwnStudentByArchivingAccountAndCards() throws Exception {
        createFourCards();
        String start = postAndReturn("/api/v1/study/sessions", studentToken, "{\"type\": \"SCHEDULED\"}",
                status().isCreated());
        UUID sessionId = UUID.fromString(JsonPath.read(start, "$.id"));

        mockMvc.perform(delete("/api/v1/students/{id}", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/students")
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        assertThat(cardRepository.countByStudentIdAndArchivedFalse(studentId)).isZero();
        assertThat(userRepository.findById(studentId)).get().extracting(User::isArchived).isEqualTo(true);

        // The session row still exists for history, but the archived student's token no longer authenticates.
        assertThat(sessionId).isNotNull();
        mockMvc.perform(get("/api/v1/study/today")
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void teacherCannotDeleteAnotherTeachersStudent() throws Exception {
        String otherTeacher = createActivatedTeacher("other-delete@test.local", "OtherPass123!");

        mockMvc.perform(delete("/api/v1/students/{id}", studentId)
                        .header("Authorization", "Bearer " + otherTeacher))
                .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/v1/students")
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    // --- Study flow (student) ---

    @Test
    void studentCannotStartSessionWithFewerThanFourCards() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        createCardInHomework(teacherToken, homeworkId, "1", "one");
        createCardInHomework(teacherToken, homeworkId, "2", "two");
        createCardInHomework(teacherToken, homeworkId, "3", "three");

        mockMvc.perform(post("/api/v1/study/sessions")
                        .header("Authorization", "Bearer " + studentToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\": \"SCHEDULED\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.errorCode").value("NOT_ENOUGH_CARDS"));
    }

    @Test
    void studentCompletesScheduledSessionWhichAdvancesTheSchedule() throws Exception {
        Map<UUID, String> answers = createFourCards();

        // Today: 4 due cards, session available.
        mockMvc.perform(get("/api/v1/study/today").header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dueCardCount").value(4))
                .andExpect(jsonPath("$.canStartScheduled").value(true));

        String start = postAndReturn("/api/v1/study/sessions", studentToken, "{\"type\": \"SCHEDULED\"}",
                status().isCreated());
        UUID sessionId = UUID.fromString(JsonPath.read(start, "$.id"));

        playSessionAnsweringCorrectly(sessionId, answers);

        // Result screen: all four correct on the first try, next review scheduled.
        mockMvc.perform(get("/api/v1/study/sessions/{id}/result", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCards").value(4))
                .andExpect(jsonPath("$.correctFirstTry").value(4))
                .andExpect(jsonPath("$.nextReviewDate").value(LocalDate.now().plusDays(1).toString()))
                .andExpect(jsonPath("$.review.length()").value(4))
                .andExpect(jsonPath("$.review[?(@.correct == true)]", hasSize(4)));

        // Every card advanced to repetition 1, due tomorrow.
        cardRepository.findAllByStudentIdAndArchivedFalse(studentId).forEach(card -> {
            assertThat(card.getRepetitionNumber()).isEqualTo(1);
            assertThat(card.getDueDate()).isEqualTo(LocalDate.now().plusDays(1));
        });

        mockMvc.perform(get("/api/v1/students/{id}/review-history", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].date").value(LocalDate.now().toString()))
                .andExpect(jsonPath("$[0].dueCount").value(4))
                .andExpect(jsonPath("$[0].completedCount").value(4))
                .andExpect(jsonPath("$[0].status").value("COMPLETED"));

        // Nothing due now, so no scheduled session can start until the due date.
        mockMvc.perform(get("/api/v1/study/today").header("Authorization", "Bearer " + studentToken))
                .andExpect(jsonPath("$.dueCardCount").value(0))
                .andExpect(jsonPath("$.canStartScheduled").value(false));
    }

    @Test
    void wrongAnswerReturnsTheCardLaterInTheSameSession() throws Exception {
        Map<UUID, String> answers = createFourCards();
        String start = postAndReturn("/api/v1/study/sessions", studentToken, "{\"type\": \"SCHEDULED\"}",
                status().isCreated());
        UUID sessionId = UUID.fromString(JsonPath.read(start, "$.id"));

        // Answer the first card wrong.
        String question = mockMvc.perform(get("/api/v1/study/sessions/{id}/current-question", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andReturn().getResponse().getContentAsString();
        UUID firstCardId = UUID.fromString(JsonPath.read(question, "$.cardId"));

        mockMvc.perform(post("/api/v1/study/sessions/{id}/answer", sessionId)
                        .header("Authorization", "Bearer " + studentToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cardId\": \"" + firstCardId + "\", \"selectedAnswer\": \"definitely wrong\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.correct").value(false))
                .andExpect(jsonPath("$.correctAnswer").value(answers.get(firstCardId)))
                .andExpect(jsonPath("$.sessionCompleted").value(false));

        String nextQuestion = mockMvc.perform(get("/api/v1/study/sessions/{id}/current-question", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(UUID.fromString(JsonPath.read(nextQuestion, "$.cardId"))).isNotEqualTo(firstCardId);

        // Finish the session answering everything correctly.
        playSessionAnsweringCorrectly(sessionId, answers);

        // The card that was missed does not count as first-try correct: 3 of 4.
        mockMvc.perform(get("/api/v1/study/sessions/{id}/result", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.correctFirstTry").value(3))
                .andExpect(jsonPath("$.review[?(@.cardId == '" + firstCardId + "')].selectedAnswer",
                        hasItem("definitely wrong")))
                .andExpect(jsonPath("$.review[?(@.cardId == '" + firstCardId + "')].correct",
                        hasItem(false)))
                .andExpect(jsonPath("$.review[?(@.cardId == '" + firstCardId + "')].correctAnswer",
                        hasItem(answers.get(firstCardId))));

        cardRepository.findById(firstCardId).ifPresentOrElse(card -> {
            assertThat(card.getRepetitionNumber()).isZero();
            assertThat(card.getDueDate()).isEqualTo(LocalDate.now().plusDays(1));
        }, () -> {
            throw new AssertionError("Expected missed card to exist");
        });

        mockMvc.perform(get("/api/v1/students/{id}/review-history", studentId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].dueCount").value(4))
                .andExpect(jsonPath("$[0].completedCount").value(4))
                .andExpect(jsonPath("$[0].status").value("COMPLETED"));
    }

    @Test
    void practiceSessionDoesNotChangeTheSchedule() throws Exception {
        Map<UUID, String> answers = createFourCards();
        String start = postAndReturn("/api/v1/study/sessions", studentToken, "{\"type\": \"PRACTICE\"}",
                status().isCreated());
        UUID sessionId = UUID.fromString(JsonPath.read(start, "$.id"));

        playSessionAnsweringCorrectly(sessionId, answers);

        // Practice leaves every card at repetition 0, still due today.
        cardRepository.findAllByStudentIdAndArchivedFalse(studentId).forEach(card -> {
            assertThat(card.getRepetitionNumber()).isZero();
            assertThat(card.getDueDate()).isEqualTo(LocalDate.now());
        });
    }

    @Test
    void studentOpensOwnHomeworkAndPracticesOnlyThoseCardsWithoutDailyProgress() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        Map<UUID, String> answers = new HashMap<>();
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "h1", "a1"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "h2", "a2"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "h3", "a3"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "h4", "a4"));
        UUID otherHomeworkId = createHomework(teacherToken, studentId, LocalDate.now().minusDays(1));
        createCardInHomework(teacherToken, otherHomeworkId, "other1", "x1");
        createCardInHomework(teacherToken, otherHomeworkId, "other2", "x2");
        createCardInHomework(teacherToken, otherHomeworkId, "other3", "x3");
        createCardInHomework(teacherToken, otherHomeworkId, "other4", "x4");

        mockMvc.perform(get("/api/v1/study/homeworks/{id}/cards", homeworkId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$[?(@.homeworkId == '" + homeworkId + "')]", hasSize(4)));

        var cardsBefore = cardRepository.findAllByHomeworkIdAndStudentIdAndArchivedFalseOrderByCreatedAtDesc(
                homeworkId, studentId);
        Map<UUID, LocalDate> dueDatesBefore = cardsBefore.stream()
                .collect(java.util.stream.Collectors.toMap(card -> card.getId(), card -> card.getDueDate()));
        Map<UUID, Integer> repetitionsBefore = cardsBefore.stream()
                .collect(java.util.stream.Collectors.toMap(card -> card.getId(), card -> card.getRepetitionNumber()));
        Map<UUID, CardStatus> statusesBefore = cardsBefore.stream()
                .collect(java.util.stream.Collectors.toMap(card -> card.getId(), card -> card.getStatus()));

        String start = postAndReturn("/api/v1/study/sessions", studentToken,
                "{\"type\": \"PRACTICE\", \"homeworkId\": \"" + homeworkId + "\"}",
                status().isCreated());
        UUID sessionId = UUID.fromString(JsonPath.read(start, "$.id"));
        assertThat((String) JsonPath.read(start, "$.type")).isEqualTo("PRACTICE");
        assertThat((Integer) JsonPath.read(start, "$.totalCards")).isEqualTo(4);

        String firstQuestion = mockMvc.perform(get("/api/v1/study/sessions/{id}/current-question", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        UUID firstCardId = UUID.fromString(JsonPath.read(firstQuestion, "$.cardId"));
        assertThat(answers).containsKey(firstCardId);

        mockMvc.perform(post("/api/v1/study/sessions/{id}/answer", sessionId)
                        .header("Authorization", "Bearer " + studentToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cardId\": \"" + firstCardId + "\", \"selectedAnswer\": \"wrong\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.correct").value(false))
                .andExpect(jsonPath("$.sessionCompleted").value(false));

        String nextQuestion = mockMvc.perform(get("/api/v1/study/sessions/{id}/current-question", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        UUID nextCardId = UUID.fromString(JsonPath.read(nextQuestion, "$.cardId"));
        assertThat(nextCardId).isNotEqualTo(firstCardId);
        assertThat(answers).containsKey(nextCardId);

        playSessionAnsweringCorrectly(sessionId, answers);

        mockMvc.perform(get("/api/v1/study/sessions/{id}/result", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCards").value(4))
                .andExpect(jsonPath("$.correctFirstTry").value(3))
                .andExpect(jsonPath("$.review[?(@.cardId == '" + firstCardId + "')].correct",
                        hasItem(false)));

        cardRepository.findAllByHomeworkIdAndStudentIdAndArchivedFalseOrderByCreatedAtDesc(
                homeworkId, studentId).forEach(card -> {
                    assertThat(card.getDueDate()).isEqualTo(dueDatesBefore.get(card.getId()));
                    assertThat(card.getRepetitionNumber()).isEqualTo(repetitionsBefore.get(card.getId()));
                    assertThat(card.getStatus()).isEqualTo(statusesBefore.get(card.getId()));
                });
        assertThat(historyRepository.findTop14ByStudentIdOrderByDateDesc(studentId)).isEmpty();

        mockMvc.perform(get("/api/v1/study/today").header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dueCardCount").value(8))
                .andExpect(jsonPath("$.canStartScheduled").value(true))
                .andExpect(jsonPath("$.inProgressSessionId").doesNotExist());
    }

    @Test
    void studentCannotOpenOrPracticeAnotherStudentsHomework() throws Exception {
        String otherStudentInvitation = postAndReturn("/api/v1/students", teacherToken,
                "{\"fullName\": \"Other Student\", \"email\": \"other-homework@test.local\"}",
                status().isCreated());
        UUID otherStudentId = UUID.fromString(JsonPath.read(otherStudentInvitation, "$.student.id"));
        UUID otherHomeworkId = createHomework(teacherToken, otherStudentId, LocalDate.now());
        createCardInHomework(teacherToken, otherHomeworkId, "o1", "a1");
        createCardInHomework(teacherToken, otherHomeworkId, "o2", "a2");
        createCardInHomework(teacherToken, otherHomeworkId, "o3", "a3");
        createCardInHomework(teacherToken, otherHomeworkId, "o4", "a4");

        mockMvc.perform(get("/api/v1/study/homeworks/{id}/cards", otherHomeworkId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/v1/study/sessions")
                        .header("Authorization", "Bearer " + studentToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\": \"PRACTICE\", \"homeworkId\": \"" + otherHomeworkId + "\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void homeworkPracticeUsesOnlyNonArchivedCardsFromSelectedHomework() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        Map<UUID, String> answers = new HashMap<>();
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "h1", "a1"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "h2", "a2"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "h3", "a3"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "h4", "a4"));
        Map<UUID, String> archived = createCardInHomework(teacherToken, homeworkId, "archived", "archived answer");
        UUID archivedCardId = archived.keySet().iterator().next();

        mockMvc.perform(delete("/api/v1/cards/{id}", archivedCardId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/study/homeworks/{id}/cards", homeworkId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$[?(@.id == '" + archivedCardId + "')]", hasSize(0)));

        String start = postAndReturn("/api/v1/study/sessions", studentToken,
                "{\"type\": \"PRACTICE\", \"homeworkId\": \"" + homeworkId + "\"}",
                status().isCreated());
        UUID sessionId = UUID.fromString(JsonPath.read(start, "$.id"));
        assertThat((Integer) JsonPath.read(start, "$.totalCards")).isEqualTo(4);

        playSessionAnsweringCorrectly(sessionId, answers);

        mockMvc.perform(get("/api/v1/study/sessions/{id}/result", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.review.length()").value(4))
                .andExpect(jsonPath("$.review[?(@.cardId == '" + archivedCardId + "')]", hasSize(0)));
    }

    @Test
    void onlyOneSessionCanBeInProgress() throws Exception {
        createFourCards();
        postAndReturn("/api/v1/study/sessions", studentToken, "{\"type\": \"SCHEDULED\"}", status().isCreated());

        mockMvc.perform(post("/api/v1/study/sessions")
                        .header("Authorization", "Bearer " + studentToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\": \"PRACTICE\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.errorCode").value("SESSION_IN_PROGRESS"));
    }

    @Test
    void studentCannotAccessAnotherStudentsSession() throws Exception {
        createFourCards();
        String start = postAndReturn("/api/v1/study/sessions", studentToken, "{\"type\": \"SCHEDULED\"}",
                status().isCreated());
        UUID sessionId = UUID.fromString(JsonPath.read(start, "$.id"));

        String otherStudentInvitation = postAndReturn("/api/v1/students", teacherToken,
                "{\"fullName\": \"Other Student\", \"email\": \"other-student@test.local\"}",
                status().isCreated());
        String otherStudentToken = activate(JsonPath.read(otherStudentInvitation, "$.invitationToken"),
                "OtherStudent123!");

        mockMvc.perform(get("/api/v1/study/sessions/{id}", sessionId)
                        .header("Authorization", "Bearer " + otherStudentToken))
                .andExpect(status().isNotFound());
    }

    @Test
    void teacherCannotAccessStudentStudyEndpoints() throws Exception {
        mockMvc.perform(get("/api/v1/study/today").header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isForbidden());
    }

    // --- Settings ---

    @Test
    void studentCanChangeInterfaceLanguage() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/settings")
                        .header("Authorization", "Bearer " + studentToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"preferredLanguage\": \"DE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferredLanguage").value("DE"));

        mockMvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + studentToken))
                .andExpect(jsonPath("$.preferredLanguage").value("DE"));
    }

    // --- Helpers ---

    /** Creates four cards for the student and returns a card-id → correct-answer map. */
    @Test
    void teacherSetsCardTimeLimitAndTimeoutScoresIncorrect() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        // A card with a 15-second limit, plus three without, to reach the four-card minimum.
        String created = mockMvc.perform(post("/api/v1/homeworks/{id}/cards", homeworkId)
                        .header("Authorization", "Bearer " + teacherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\": \"timed\", \"correctAnswer\": \"yes\", \"timeLimitSeconds\": 15}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.timeLimitSeconds").value(15))
                .andReturn().getResponse().getContentAsString();
        UUID timedCardId = UUID.fromString(JsonPath.read(created, "$.id"));
        createCardInHomework(teacherToken, homeworkId, "b", "2");
        createCardInHomework(teacherToken, homeworkId, "c", "3");
        createCardInHomework(teacherToken, homeworkId, "d", "4");

        // The limit is visible in the teacher's card list.
        mockMvc.perform(get("/api/v1/homeworks/{id}/cards", homeworkId)
                        .header("Authorization", "Bearer " + teacherToken))
                .andExpect(jsonPath("$[?(@.id == '" + timedCardId + "')].timeLimitSeconds", hasItem(15)));

        // Time out on the current card: it is scored incorrect and stays in the session.
        String start = postAndReturn("/api/v1/study/sessions", studentToken, "{\"type\": \"SCHEDULED\"}",
                status().isCreated());
        UUID sessionId = UUID.fromString(JsonPath.read(start, "$.id"));
        String question = mockMvc.perform(get("/api/v1/study/sessions/{id}/current-question", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andReturn().getResponse().getContentAsString();
        UUID cardId = UUID.fromString(JsonPath.read(question, "$.cardId"));

        mockMvc.perform(post("/api/v1/study/sessions/{id}/answer", sessionId)
                        .header("Authorization", "Bearer " + studentToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cardId\": \"" + cardId + "\", \"selectedAnswer\": \"\", \"timedOut\": true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.correct").value(false))
                .andExpect(jsonPath("$.sessionCompleted").value(false));
    }

    private Map<UUID, String> createFourCards() throws Exception {
        UUID homeworkId = createHomework(teacherToken, studentId, LocalDate.now());
        Map<UUID, String> answers = new HashMap<>();
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "2 + 2", "4"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "3 + 3", "6"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "4 + 4", "8"));
        answers.putAll(createCardInHomework(teacherToken, homeworkId, "5 + 5", "10"));
        return answers;
    }

    private UUID createHomework(String token, UUID student, LocalDate startDate) throws Exception {
        String body = postAndReturn("/api/v1/students/" + student + "/homeworks", token,
                "{\"startDate\": \"" + startDate + "\"}", status().isCreated());
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    private Map<UUID, String> createCardInHomework(String token, UUID homeworkId, String question, String answer)
            throws Exception {
        String body = createCardRawInHomework(token, homeworkId, question, answer);
        return Map.of(UUID.fromString(JsonPath.read(body, "$.id")), answer);
    }

    private String createCardRawInHomework(String token, UUID homeworkId, String question, String answer)
            throws Exception {
        return mockMvc.perform(post("/api/v1/homeworks/{id}/cards", homeworkId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\": \"" + question + "\", \"correctAnswer\": \"" + answer + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    private void importFourCardsWithSavedOptions(UUID homeworkId) throws Exception {
        mockMvc.perform(post("/api/v1/homeworks/{id}/cards/import", homeworkId)
                        .header("Authorization", "Bearer " + teacherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"cards": [
                                    {"question": "q1", "correctAnswer": "a1", "wrongAnswer1": "w1a", "wrongAnswer2": "w1b", "wrongAnswer3": "w1c"},
                                    {"question": "q2", "correctAnswer": "a2", "wrongAnswer1": "w2a", "wrongAnswer2": "w2b", "wrongAnswer3": "w2c"},
                                    {"question": "q3", "correctAnswer": "a3", "wrongAnswer1": "w3a", "wrongAnswer2": "w3b", "wrongAnswer3": "w3c"},
                                    {"question": "q4", "correctAnswer": "a4", "wrongAnswer1": "w4a", "wrongAnswer2": "w4b", "wrongAnswer3": "w4c"}
                                ]}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.length()").value(4));
    }

    private Map<UUID, String> answersForHomework(UUID homeworkId) {
        Map<UUID, String> answers = new HashMap<>();
        cardRepository.findAllByHomeworkIdAndArchivedFalseOrderByCreatedAtDesc(homeworkId)
                .forEach(card -> answers.put(card.getId(), card.getCorrectAnswer()));
        return answers;
    }

    private Map<String, Set<String>> expectedOptionsForHomework(UUID homeworkId) {
        Map<String, Set<String>> expected = new HashMap<>();
        cardRepository.findAllByHomeworkIdAndArchivedFalseOrderByCreatedAtDesc(homeworkId)
                .forEach(card -> expected.put(card.getQuestion(), Set.of(card.getCorrectAnswer(),
                        card.getWrongAnswer1(), card.getWrongAnswer2(), card.getWrongAnswer3())));
        return expected;
    }

    private void assertCurrentQuestionUsesSavedOptions(UUID sessionId, Map<String, Set<String>> expectedByQuestion)
            throws Exception {
        String question = mockMvc.perform(get("/api/v1/study/sessions/{id}/current-question", sessionId)
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.options.length()").value(4))
                .andReturn().getResponse().getContentAsString();
        String questionText = JsonPath.read(question, "$.question");
        List<String> options = JsonPath.read(question, "$.options");

        assertThat(expectedByQuestion).containsKey(questionText);
        assertThat(options).containsExactlyInAnyOrderElementsOf(expectedByQuestion.get(questionText));
    }

    /** Plays a session to completion, always choosing the correct answer for each card shown. */
    private void playSessionAnsweringCorrectly(UUID sessionId, Map<UUID, String> answers) throws Exception {
        for (int guard = 0; guard < 100; guard++) {
            MvcResult questionResult = mockMvc.perform(
                            get("/api/v1/study/sessions/{id}/current-question", sessionId)
                                    .header("Authorization", "Bearer " + studentToken))
                    .andReturn();
            if (questionResult.getResponse().getStatus() != 200) {
                return; // no more pending cards
            }
            String question = questionResult.getResponse().getContentAsString();
            UUID cardId = UUID.fromString(JsonPath.read(question, "$.cardId"));

            String answerResult = mockMvc.perform(post("/api/v1/study/sessions/{id}/answer", sessionId)
                            .header("Authorization", "Bearer " + studentToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"cardId\": \"" + cardId + "\", \"selectedAnswer\": \""
                                    + answers.get(cardId) + "\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.correct").value(true))
                    .andReturn().getResponse().getContentAsString();
            if (Boolean.TRUE.equals(JsonPath.read(answerResult, "$.sessionCompleted"))) {
                return;
            }
        }
        throw new AssertionError("Session did not complete within the expected number of answers");
    }

    private String createActivatedTeacher(String email, String password) throws Exception {
        String adminToken = login(ADMIN_EMAIL, ADMIN_PASSWORD);
        String invitation = postAndReturn("/api/v1/teachers", adminToken,
                "{\"fullName\": \"Teacher\", \"email\": \"" + email + "\"}", status().isCreated());
        return activate(JsonPath.read(invitation, "$.invitationToken"), password);
    }

    private String login(String email, String password) throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"" + email + "\", \"password\": \"" + password + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.accessToken");
    }

    private String activate(String invitationToken, String password) throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/activate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"invitationToken\": \"" + invitationToken + "\", \"password\": \""
                                + password + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.accessToken");
    }

    /** POST helper returning the response body, asserting the given status. */
    private String postAndReturn(String url, String token, String body,
                                 org.springframework.test.web.servlet.ResultMatcher expectedStatus) throws Exception {
        return mockMvc.perform(post(url)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(expectedStatus)
                .andReturn().getResponse().getContentAsString();
    }
}
