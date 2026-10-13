package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.common.ConflictException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

/**
 * Annotation payloads come from participants' browsers and are untrusted.
 * These are the malformed and hostile cases.
 */
class AnnotationPayloadValidatorTest {

    private final AnnotationPayloadValidator validator =
            new AnnotationPayloadValidator(new ObjectMapper());

    private void accepts(String payload) {
        assertThatCode(() -> validator.validate(AnnotationOperationType.ADD, payload))
                .doesNotThrowAnyException();
    }

    private void rejects(String payload) {
        assertThatThrownBy(() -> validator.validate(AnnotationOperationType.ADD, payload))
                .isInstanceOf(ConflictException.class);
    }

    // --- Accepted shapes -----------------------------------------------------

    @Test
    void acceptsEverySupportedShape() {
        accepts("{\"kind\":\"pen\",\"color\":\"#112233\",\"width\":0.004,\"points\":[[0,0],[1,1]]}");
        accepts("{\"kind\":\"highlighter\",\"width\":0.01,\"points\":[[0.5,0.5]]}");
        accepts("{\"kind\":\"line\",\"x1\":0,\"y1\":0,\"x2\":1,\"y2\":1}");
        accepts("{\"kind\":\"arrow\",\"x1\":0.1,\"y1\":0.2,\"x2\":0.3,\"y2\":0.4}");
        accepts("{\"kind\":\"rect\",\"x\":0.1,\"y\":0.1,\"w\":0.4,\"h\":0.2}");
        accepts("{\"kind\":\"ellipse\",\"x\":0.1,\"y\":0.1,\"w\":0.4,\"h\":0.2}");
        accepts("{\"kind\":\"text\",\"x\":0.1,\"y\":0.1,\"text\":\"hello\",\"size\":0.03}");
        accepts("{\"kind\":\"erase\",\"width\":0.02,\"points\":[[0.2,0.2]]}");
    }

    @Test
    void allowsAnExtentDrawnRightToLeft() {
        // A rectangle dragged backwards has a negative extent; that is normal.
        accepts("{\"kind\":\"rect\",\"x\":0.5,\"y\":0.5,\"w\":-0.3,\"h\":-0.2}");
    }

    @Test
    void clearOperationsCarryNoGeometry() {
        assertThatCode(() ->
                validator.validate(AnnotationOperationType.CLEAR_ALL, "{\"scope\":\"all\"}"))
                .doesNotThrowAnyException();
        assertThatCode(() ->
                validator.validate(AnnotationOperationType.CLEAR_LAYER, "{}"))
                .doesNotThrowAnyException();
    }

    // --- Structural rejection ------------------------------------------------

    @Test
    void rejectsBlankOrNonJsonPayloads() {
        rejects("");
        rejects("   ");
        rejects("{not json");
        rejects("[1,2,3]");
        rejects("\"a string\"");
    }

    @Test
    void rejectsAnUnknownKind() {
        rejects("{\"kind\":\"nuke\",\"points\":[[0,0]]}");
        rejects("{\"points\":[[0,0]]}");
    }

    @Test
    void rejectsAnOversizedPayload() {
        String huge = "{\"kind\":\"text\",\"x\":0,\"y\":0,\"text\":\""
                + "a".repeat(AnnotationPayloadValidator.MAX_PAYLOAD_BYTES) + "\"}";

        rejects(huge);
    }

    // --- Coordinate range ----------------------------------------------------

    @Test
    void rejectsCoordinatesOutsideTheNormalizedSurface() {
        // Coordinates are normalized to 0..1, so these are malformed rather
        // than merely off-screen.
        rejects("{\"kind\":\"pen\",\"points\":[[1.5,0.5]]}");
        rejects("{\"kind\":\"pen\",\"points\":[[-0.1,0.5]]}");
        rejects("{\"kind\":\"line\",\"x1\":0,\"y1\":0,\"x2\":2,\"y2\":1}");
        rejects("{\"kind\":\"text\",\"x\":5,\"y\":0.1,\"text\":\"hi\"}");
    }

    @Test
    void rejectsNonFiniteCoordinates() {
        // JSON has no NaN/Infinity literal, so these arrive as strings — which
        // must not be coerced into numbers.
        rejects("{\"kind\":\"pen\",\"points\":[[\"NaN\",0.5]]}");
        rejects("{\"kind\":\"pen\",\"points\":[[\"1e999\",0.5]]}");
        rejects("{\"kind\":\"pen\",\"points\":[[null,0.5]]}");
    }

    @Test
    void rejectsMalformedPointPairs() {
        rejects("{\"kind\":\"pen\",\"points\":[[0.5]]}");
        rejects("{\"kind\":\"pen\",\"points\":[[0.1,0.2,0.3]]}");
        rejects("{\"kind\":\"pen\",\"points\":[0.5]}");
        rejects("{\"kind\":\"pen\",\"points\":[]}");
        rejects("{\"kind\":\"pen\"}");
    }

    @Test
    void rejectsIncompleteGeometry() {
        rejects("{\"kind\":\"line\",\"x1\":0,\"y1\":0,\"x2\":1}");
        rejects("{\"kind\":\"rect\",\"x\":0.1,\"y\":0.1,\"w\":0.2}");
        rejects("{\"kind\":\"text\",\"x\":0.1,\"y\":0.1}");
    }

    // --- Resource bounds -----------------------------------------------------

    @Test
    void rejectsAStrokeWithTooManyPoints() {
        StringBuilder points = new StringBuilder("{\"kind\":\"pen\",\"points\":[");
        for (int i = 0; i <= AnnotationPayloadValidator.MAX_POINTS; i++) {
            points.append(i > 0 ? "," : "").append("[0.5,0.5]");
        }
        points.append("]}");

        rejects(points.toString());
    }

    @Test
    void rejectsOverlongText() {
        rejects("{\"kind\":\"text\",\"x\":0,\"y\":0,\"text\":\""
                + "a".repeat(AnnotationPayloadValidator.MAX_TEXT_LENGTH + 1) + "\"}");
    }

    @Test
    void rejectsAStrokeWideEnoughToCoverTheSurface() {
        rejects("{\"kind\":\"pen\",\"width\":5,\"points\":[[0.5,0.5]]}");
        rejects("{\"kind\":\"pen\",\"width\":0,\"points\":[[0.5,0.5]]}");
        rejects("{\"kind\":\"pen\",\"width\":-1,\"points\":[[0.5,0.5]]}");
    }

    @Test
    void rejectsAnOutOfRangeTextSize() {
        rejects("{\"kind\":\"text\",\"x\":0,\"y\":0,\"text\":\"hi\",\"size\":9}");
        rejects("{\"kind\":\"text\",\"x\":0,\"y\":0,\"text\":\"hi\",\"size\":0}");
    }

    // --- Colour --------------------------------------------------------------

    @Test
    void rejectsAnythingButAHexColour() {
        // Arbitrary CSS can carry a payload (url(), expression()), so only a
        // plain hex triple is accepted.
        rejects("{\"kind\":\"pen\",\"color\":\"url(javascript:alert(1))\",\"points\":[[0,0]]}");
        rejects("{\"kind\":\"pen\",\"color\":\"red\",\"points\":[[0,0]]}");
        rejects("{\"kind\":\"pen\",\"color\":\"#fff\",\"points\":[[0,0]]}");
        rejects("{\"kind\":\"pen\",\"color\":123,\"points\":[[0,0]]}");
    }

    @Test
    void colourIsOptional() {
        accepts("{\"kind\":\"pen\",\"points\":[[0,0]]}");
        accepts("{\"kind\":\"pen\",\"color\":null,\"points\":[[0,0]]}");
    }

    @Test
    void textIsStoredVerbatimAndEscapedAtRenderTime() {
        // Markup is legitimate content on a whiteboard (a teacher writing HTML
        // in a lesson); it is kept as text and escaped when rendered.
        accepts("{\"kind\":\"text\",\"x\":0.1,\"y\":0.1,\"text\":\"<script>alert(1)</script>\"}");
    }
}
