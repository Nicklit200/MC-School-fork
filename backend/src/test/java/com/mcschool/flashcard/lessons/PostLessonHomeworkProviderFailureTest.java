package com.mcschool.flashcard.lessons;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Provider failures must remain diagnosable without rendering or exposing pupil content. */
class PostLessonHomeworkProviderFailureTest {
    private static final String PRIVATE_TEXT = "private-pupil-notes-and-provider-data";
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = mock(HttpClient.class);
    private final OwnerWorkbookPdfRenderService renderer = mock(OwnerWorkbookPdfRenderService.class);
    private final PostLessonHomeworkContentService service = new PostLessonHomeworkContentService(
            "test-key", "test-model", json, renderer, http);

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void response(String body) throws Exception {
        HttpResponse<String> reply = mock(HttpResponse.class);
        when(reply.statusCode()).thenReturn(200);
        when(reply.body()).thenReturn(body);
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn(reply);
    }

    private String completed(Object parts) throws Exception {
        return json.writeValueAsString(Map.of("status", "completed", "output",
                List.of(Map.of("type", "message", "content", parts))));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private IllegalStateException failedGeneration(String expectedReason, String expectedCode) throws Exception {
        IllegalStateException failure = assertThrows(IllegalStateException.class,
                () -> service.make(Map.of("homeworkPrompt", "SCHOOL", "teacherNotes", PRIVATE_TEXT),
                        1, 7, "Fictional pupil"));
        assertEquals(expectedReason, failure.getMessage());
        assertEquals(expectedCode, PostLessonHomeworkFailure.code(failure));
        assertFalse(failure.getMessage().contains(PRIVATE_TEXT));
        assertFalse(PostLessonHomeworkFailure.origin(failure).contains(PRIVATE_TEXT));
        verify(http, times(1)).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
        verifyNoInteractions(renderer);
        return failure;
    }

    @Test void completedResponseWithoutContentHasSpecificFailure() throws Exception {
        response(json.writeValueAsString(Map.of("status", "completed", "output", List.of())));
        failedGeneration("HOMEWORK_AI_EMPTY_RESPONSE", "AI_EMPTY_RESPONSE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " \n\t"})
    void emptyTextIsNotMisreportedAsInvalidHomeworkJson(String text) throws Exception {
        response(completed(List.of(Map.of("type", "output_text", "text", text))));
        failedGeneration("HOMEWORK_AI_EMPTY_RESPONSE", "AI_EMPTY_RESPONSE");
    }

    @Test void refusalIsTerminalAndDoesNotRepeatPaidCallsOrRender() throws Exception {
        response(completed(List.of(Map.of("type", "refusal", "refusal", PRIVATE_TEXT))));
        failedGeneration("HOMEWORK_AI_REFUSED", "AI_REFUSED");
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void providerTimeoutIsDifferentFromPdfTimeout() throws Exception {
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenThrow(new HttpTimeoutException(PRIVATE_TEXT));
        failedGeneration("HOMEWORK_AI_TIMEOUT", "AI_TIMEOUT");
    }

    @ParameterizedTest
    @ValueSource(strings = {"not-json", "[1,2,3]", "null"})
    void malformedProviderEnvelopeHasSafeSpecificFailure(String envelope) throws Exception {
        response(envelope);
        failedGeneration("HOMEWORK_AI_RESPONSE_INVALID", "AI_RESPONSE_INVALID");
    }
}
