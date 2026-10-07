package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/trial-lessons")
@PreAuthorize("hasRole('ADMIN')")
public class AdminTrialLessonController {

    private final UserRepository userRepository;
    private final GoogleCalendarLessonService lessonService;
    private final LessonPreparationRepository preparationRepository;

    public AdminTrialLessonController(
            UserRepository userRepository,
            GoogleCalendarLessonService lessonService,
            LessonPreparationRepository preparationRepository) {
        this.userRepository = userRepository;
        this.lessonService = lessonService;
        this.preparationRepository = preparationRepository;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        List<Map<String, Object>> result = new ArrayList<>();

        for (User teacher : userRepository.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.TEACHER, UserStatus.ACTIVE)) {
            AuthenticatedUser principal = new AuthenticatedUser(
                    teacher.getId(), teacher.getEmail(), teacher.getRole());

            List<GroupLessonResponse> lessons;
            try {
                lessons = lessonService.listGroupLessons(principal);
            } catch (RuntimeException ignored) {
                continue;
            }

            for (GroupLessonResponse lesson : lessons) {
                if (lesson.groupId() != null || lesson.studentId() != null) continue;

                LessonPreparation preparation = preparationRepository
                        .findByTeacherIdAndEventId(teacher.getId(), lesson.eventId())
                        .orElse(null);
                boolean hasTranscript = preparation != null && preparation.hasTranscriptPdf();

                if (!hasTranscript && !looksLikeTrialTitle(lesson.title())) continue;

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("teacherId", teacher.getId().toString());
                item.put("teacherName", teacher.getFullName());
                item.put("eventId", lesson.eventId());
                item.put("title", lesson.title());
                item.put("startsAt", lesson.startsAt() == null ? null : lesson.startsAt().toString());
                item.put("endsAt", lesson.endsAt() == null ? null : lesson.endsAt().toString());
                item.put("calendarUrl", lesson.calendarUrl());
                item.put("hasTranscript", hasTranscript);
                item.put("transcriptFilename", preparation == null ? null : preparation.getTranscriptFilename());
                result.add(item);
            }
        }

        result.sort((left, right) -> String.valueOf(right.get("startsAt"))
                .compareTo(String.valueOf(left.get("startsAt"))));
        return result;
    }

    static boolean looksLikeTrialTitle(String title) {
        String value = title == null ? "" : title.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
        return value.contains("probe")
                || value.contains("проб")
                || value.contains("trial")
                || value.contains("diagnost")
                || value.contains("диагност");
    }
}
