package com.mcschool.flashcard.liveclasses;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Stores only the teacher's question and its small routing context. Prompt
 * instructions, transcript text, chat history and AI answers are deliberately
 * excluded.
 */
@Service
public class KolinQuestionJournal {
    private static final int MAX_RECENT_QUESTIONS = 100;
    private final KolinTeacherQuestionRepository questions;

    public KolinQuestionJournal(KolinTeacherQuestionRepository questions) {
        this.questions = questions;
    }

    @Transactional
    public UUID record(UUID teacherId, UUID classId, UUID clientMessageId, String text,
                       String targetType, UUID studentId, Integer currentWorkbookPage, String format) {
        if (clientMessageId != null) {
            var existing = questions.findByTeacherIdAndClassIdAndClientMessageId(
                    teacherId, classId, clientMessageId);
            if (existing.isPresent()) return existing.get().getId();
        }
        return questions.save(KolinTeacherQuestion.received(classId, teacherId, clientMessageId,
                text, targetType, studentId, currentWorkbookPage, format)).getId();
    }

    @Transactional
    public void answered(UUID id) {
        questions.findById(id).ifPresent(KolinTeacherQuestion::markAnswered);
    }

    @Transactional
    public void failed(UUID id) {
        questions.findById(id).ifPresent(KolinTeacherQuestion::markFailed);
    }

    @Transactional(readOnly = true)
    public List<View> recent(UUID teacherId, UUID classId) {
        return questions.findByTeacherIdAndClassIdOrderByCreatedAtDescIdDesc(
                        teacherId, classId, PageRequest.of(0, MAX_RECENT_QUESTIONS))
                .stream().map(View::from).toList();
    }

    public record View(UUID id, UUID clientMessageId, String text, String targetType,
                       UUID studentId, Integer currentWorkbookPage, String format,
                       KolinTeacherQuestion.Status status, Instant createdAt, Instant processedAt) {
        static View from(KolinTeacherQuestion question) {
            return new View(question.getId(), question.getClientMessageId(), question.getQuestionText(),
                    question.getTargetType(), question.getStudentId(), question.getCurrentWorkbookPage(),
                    question.getFormat(), question.getStatus(), question.getCreatedAt(), question.getProcessedAt());
        }
    }
}
