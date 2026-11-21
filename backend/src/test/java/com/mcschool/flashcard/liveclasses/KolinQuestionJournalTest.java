package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;

class KolinQuestionJournalTest {
    private final KolinTeacherQuestionRepository repository = mock(KolinTeacherQuestionRepository.class);
    private final KolinQuestionJournal journal = new KolinQuestionJournal(repository);

    @Test void storesOnlyQuestionRoutingFieldsAndDeduplicatesBrowserRetries() {
        UUID teacherId=UUID.randomUUID(),classId=UUID.randomUUID(),clientId=UUID.randomUUID(),studentId=UUID.randomUUID();
        when(repository.save(any())).thenAnswer(call->call.getArgument(0));

        UUID id=journal.record(teacherId,classId,clientId,"Проверь решение","student",studentId,4,"interactive");

        var captured=ArgumentCaptor.forClass(KolinTeacherQuestion.class);
        verify(repository).save(captured.capture());
        var saved=captured.getValue();
        assertThat(saved.getId()).isEqualTo(id);
        assertThat(saved.getTeacherId()).isEqualTo(teacherId);
        assertThat(saved.getClassId()).isEqualTo(classId);
        assertThat(saved.getQuestionText()).isEqualTo("Проверь решение");
        assertThat(saved.getTargetType()).isEqualTo("student");
        assertThat(saved.getStudentId()).isEqualTo(studentId);
        assertThat(saved.getCurrentWorkbookPage()).isEqualTo(4);
        assertThat(saved.getFormat()).isEqualTo("interactive");
        assertThat(saved.getStatus()).isEqualTo(KolinTeacherQuestion.Status.RECEIVED);

        when(repository.findByTeacherIdAndClassIdAndClientMessageId(teacherId,classId,clientId))
                .thenReturn(Optional.of(saved));
        assertThat(journal.record(teacherId,classId,clientId,"другой текст","group",null,null,null))
                .isEqualTo(id);
        verify(repository,times(1)).save(any());
    }

    @Test void successfulQuestionCannotBeDowngradedByALateFailedRetry() {
        var saved=KolinTeacherQuestion.received(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),
                "Вопрос","group",null,null,"pdf");
        when(repository.findById(saved.getId())).thenReturn(Optional.of(saved));

        journal.answered(saved.getId());
        assertThat(saved.getStatus()).isEqualTo(KolinTeacherQuestion.Status.ANSWERED);
        assertThat(saved.getProcessedAt()).isNotNull();

        journal.failed(saved.getId());
        assertThat(saved.getStatus()).isEqualTo(KolinTeacherQuestion.Status.ANSWERED);
    }

    @Test void recentQuestionsAreAlwaysBoundedToTeacherAndClass() {
        UUID teacherId=UUID.randomUUID(),classId=UUID.randomUUID();
        when(repository.findByTeacherIdAndClassIdOrderByCreatedAtDescIdDesc(
                eq(teacherId),eq(classId),any(Pageable.class))).thenReturn(List.of());

        assertThat(journal.recent(teacherId,classId)).isEmpty();

        verify(repository).findByTeacherIdAndClassIdOrderByCreatedAtDescIdDesc(
                eq(teacherId),eq(classId),argThat(page->page.getPageNumber()==0&&page.getPageSize()==100));
    }
}
