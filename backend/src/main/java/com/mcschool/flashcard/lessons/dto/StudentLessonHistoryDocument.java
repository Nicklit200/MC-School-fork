package com.mcschool.flashcard.lessons.dto;

import java.util.UUID;

public record StudentLessonHistoryDocument(UUID id, String boardId, String filename, String savedAt) {}
