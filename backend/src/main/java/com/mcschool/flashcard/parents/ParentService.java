package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ParentService {

    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final CardRepository cardRepository;
    private final ZoneId zone;

    public ParentService(UserRepository userRepository,
                         HomeworkRepository homeworkRepository,
                         CardRepository cardRepository,
                         @Value("${app.parent-homework-reminders.zone:Europe/Berlin}") String zone) {
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.cardRepository = cardRepository;
        this.zone = ZoneId.of(zone);
    }

    @Transactional(readOnly = true)
    public List<ParentChildStatusResponse> children(AuthenticatedUser parent) {
        if (parent.role() != Role.PARENT) {
            throw new IllegalStateException("Parent role required");
        }
        LocalDate today = LocalDate.now(zone);
        return userRepository.findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parent.id()).stream()
                .map(student -> toStatus(student, today))
                .toList();
    }

    private ParentChildStatusResponse toStatus(User student, LocalDate today) {
        List<Homework> todayHomeworks = homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(student.getId())
                .stream()
                .filter(Homework::hasWorksheet)
                .filter(homework -> homework.getStartDate().equals(today))
                .toList();
        long completed = todayHomeworks.stream().filter(Homework::isSubmitted).count();
        long open = todayHomeworks.size() - completed;
        long cardsDue = cardRepository.countDueCards(student.getId(), today);
        return new ParentChildStatusResponse(
                student.getId(), student.getFullName(), todayHomeworks.size(), completed, open, cardsDue);
    }
}
