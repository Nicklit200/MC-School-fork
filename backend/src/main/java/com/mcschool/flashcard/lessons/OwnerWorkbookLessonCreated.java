package com.mcschool.flashcard.lessons;

import java.util.UUID;

/** Emitted inside the schedule transaction, handled only after commit. */
public record OwnerWorkbookLessonCreated(UUID teacherId, String eventId) {}
