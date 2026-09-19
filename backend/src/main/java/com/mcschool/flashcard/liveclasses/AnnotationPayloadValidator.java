package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.common.ConflictException;
import java.util.Set;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Validates an annotation operation payload.
 *
 * <p>Payloads arrive from participants' browsers and are untrusted. Everything
 * is checked before persistence: shape kind, coordinate range, point count,
 * text length and overall size. Coordinates are <em>normalized</em> to the
 * target surface (0..1) rather than CSS pixels, so a value outside that range is
 * malformed rather than merely off-screen.
 */
@Component
public class AnnotationPayloadValidator {

    /** Keeps one stroke from becoming an unbounded row. */
    static final int MAX_POINTS = 1000;
    static final int MAX_TEXT_LENGTH = 500;
    static final int MAX_PAYLOAD_BYTES = OnlineClassAnnotationEvent.MAX_PAYLOAD_LENGTH;

    private static final Set<String> KINDS =
            Set.of("pen", "highlighter", "line", "arrow", "rect", "ellipse", "text", "erase");

    /** Hex colours only — never arbitrary CSS, which can carry a payload. */
    private static final java.util.regex.Pattern COLOR =
            java.util.regex.Pattern.compile("^#[0-9a-fA-F]{6}$");

    private final ObjectMapper objectMapper;

    public AnnotationPayloadValidator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Returns the canonical payload to store, or throws when it is malformed.
     *
     * @param operationType the declared operation; CLEAR_* carry no geometry
     */
    public String validate(AnnotationOperationType operationType, String payload) {
        if (payload == null || payload.isBlank()) {
            throw new ConflictException("Annotation payload must not be blank");
        }
        if (payload.length() > MAX_PAYLOAD_BYTES) {
            throw new ConflictException("Annotation payload is too large");
        }

        JsonNode root;
        try {
            root = objectMapper.readTree(payload);
        } catch (RuntimeException e) {
            throw new ConflictException("Annotation payload is not valid JSON");
        }
        if (!root.isObject()) {
            throw new ConflictException("Annotation payload must be an object");
        }

        // Clear operations are structural: they carry no geometry to validate.
        if (operationType == AnnotationOperationType.CLEAR_LAYER
                || operationType == AnnotationOperationType.CLEAR_ALL) {
            return payload;
        }

        // Undo/redo reference another operation instead of describing geometry.
        if (operationType == AnnotationOperationType.UNDO
                || operationType == AnnotationOperationType.REDO) {
            requireTargetOperationId(root);
            return payload;
        }

        String kind = root.path("kind").asString("");
        if (!KINDS.contains(kind)) {
            throw new ConflictException("Unsupported annotation kind");
        }

        validateColor(root);
        validateStrokeWidth(root);

        switch (kind) {
            case "pen", "highlighter", "erase" -> validatePoints(root);
            case "line", "arrow" -> {
                requireNormalized(root, "x1");
                requireNormalized(root, "y1");
                requireNormalized(root, "x2");
                requireNormalized(root, "y2");
            }
            case "rect", "ellipse" -> {
                requireNormalized(root, "x");
                requireNormalized(root, "y");
                requireNormalizedExtent(root, "w");
                requireNormalizedExtent(root, "h");
            }
            case "text" -> {
                requireNormalized(root, "x");
                requireNormalized(root, "y");
                validateText(root);
            }
            default -> throw new ConflictException("Unsupported annotation kind");
        }
        return payload;
    }

    /** Undo/redo must name a real operation id, not arbitrary text. */
    private void requireTargetOperationId(JsonNode root) {
        JsonNode target = root.get("targetOperationId");
        if (target == null || !target.isString()) {
            throw new ConflictException("Undo must reference an operation");
        }
        try {
            java.util.UUID.fromString(target.asString(""));
        } catch (IllegalArgumentException e) {
            throw new ConflictException("Undo target is not a valid operation id");
        }
    }

    private void validateColor(JsonNode root) {
        JsonNode color = root.get("color");
        if (color == null || color.isNull()) {
            return;
        }
        if (!color.isString() || !COLOR.matcher(color.asString("")).matches()) {
            throw new ConflictException("Annotation colour must be a hex value");
        }
    }

    private void validateStrokeWidth(JsonNode root) {
        JsonNode width = root.get("width");
        if (width == null || width.isNull()) {
            return;
        }
        if (!width.isNumber()) {
            throw new ConflictException("Annotation stroke width must be a number");
        }
        double value = width.asDouble();
        // Width is normalized too, so a sane stroke is a small fraction of the
        // surface. This also stops a single stroke covering everything.
        if (value <= 0 || value > 0.5) {
            throw new ConflictException("Annotation stroke width is out of range");
        }
    }

    private void validatePoints(JsonNode root) {
        JsonNode points = root.get("points");
        if (points == null || !points.isArray() || points.isEmpty()) {
            throw new ConflictException("Annotation stroke must contain points");
        }
        if (points.size() > MAX_POINTS) {
            throw new ConflictException("Annotation stroke has too many points");
        }
        for (JsonNode point : points) {
            if (!point.isArray() || point.size() != 2) {
                throw new ConflictException("Annotation point must be a [x, y] pair");
            }
            requireNormalizedValue(point.get(0));
            requireNormalizedValue(point.get(1));
        }
    }

    private void validateText(JsonNode root) {
        JsonNode text = root.get("text");
        if (text == null || !text.isString()) {
            throw new ConflictException("Annotation text is required");
        }
        if (text.asString("").length() > MAX_TEXT_LENGTH) {
            throw new ConflictException("Annotation text is too long");
        }
        JsonNode size = root.get("size");
        if (size != null && !size.isNull()) {
            if (!size.isNumber() || size.asDouble() <= 0 || size.asDouble() > 0.5) {
                throw new ConflictException("Annotation text size is out of range");
            }
        }
    }

    private void requireNormalized(JsonNode root, String field) {
        requireNormalizedValue(root.get(field));
    }

    /** Extents may be negative (drawn right-to-left) but bounded in magnitude. */
    private void requireNormalizedExtent(JsonNode root, String field) {
        JsonNode value = root.get(field);
        if (value == null || !value.isNumber()) {
            throw new ConflictException("Annotation geometry is incomplete");
        }
        double number = value.asDouble();
        if (Double.isNaN(number) || Double.isInfinite(number) || Math.abs(number) > 1.0) {
            throw new ConflictException("Annotation geometry is out of range");
        }
    }

    private void requireNormalizedValue(JsonNode value) {
        if (value == null || !value.isNumber()) {
            throw new ConflictException("Annotation geometry is incomplete");
        }
        double number = value.asDouble();
        if (Double.isNaN(number) || Double.isInfinite(number) || number < 0.0 || number > 1.0) {
            throw new ConflictException("Annotation geometry is out of range");
        }
    }
}
