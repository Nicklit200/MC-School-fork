package com.mcschool.flashcard.liveclasses;

/** Kind of annotation operation recorded in the revision stream. */
public enum AnnotationOperationType {
    ADD,
    UPDATE,
    ERASE,
    CLEAR_LAYER,
    CLEAR_ALL,
    /** Hides a previous operation; carries {@code targetOperationId}, no geometry. */
    UNDO,
    /** Re-applies a previously undone operation. */
    REDO
}
