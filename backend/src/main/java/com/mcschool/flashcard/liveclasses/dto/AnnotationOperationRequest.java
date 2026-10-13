package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.AnnotationOperationType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * One annotation operation.
 *
 * <p>Note there is no layer-owner field: the layer is always the actor's own.
 * Accepting one from the client would let a participant draw into, or clear,
 * someone else's layer.
 *
 * @param operationId client-generated idempotency key, shared with the realtime copy
 */
public record AnnotationOperationRequest(
        @NotNull UUID operationId,
        @NotNull AnnotationOperationType operationType,
        @NotBlank @Size(max = 16384) String payload
) {
}
