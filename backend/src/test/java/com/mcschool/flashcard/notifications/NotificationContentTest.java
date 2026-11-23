package com.mcschool.flashcard.notifications;

import static org.assertj.core.api.Assertions.assertThat;

import com.mcschool.flashcard.users.Language;
import org.junit.jupiter.api.Test;

class NotificationContentTest {

    @Test
    void activationLinkPointsAtTheFrontendAndEncodesTheToken() {
        AppLinks links = new AppLinks("http://localhost:5173/");

        // Trailing slash is trimmed; the token is URL-encoded.
        assertThat(links.activationLink("ab/cd+ef"))
                .isEqualTo("http://localhost:5173/activate?token=ab%2Fcd%2Bef");
        assertThat(links.todayLink()).isEqualTo("http://localhost:5173/today");
    }

    @Test
    void invitationEmailIsLocalisedAndContainsTheLink() {
        String link = "http://app/activate?token=x";

        NotificationMessages.Email de = NotificationMessages.invitation(Language.DE, "Maria", link);
        assertThat(de.subject()).contains("Mindcraft School");
        assertThat(de.body()).contains("Maria").contains(link).contains("Passwort");

        NotificationMessages.Email ru = NotificationMessages.invitation(Language.RU, "Иван", link);
        assertThat(ru.body()).contains("Иван").contains(link).contains("пароль");
    }

    @Test
    void workbookFailuresContainSafeStaffLinksAndStateWhenRetriesAreExhausted() {
        AppLinks links = new AppLinks("https://school.test/");
        java.util.UUID teacherId = java.util.UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
        String link = links.staffLessonLink(teacherId, "local-event-7", true);
        assertThat(link).isEqualTo("https://school.test/admin/teachers/" + teacherId + "/lessons/local-event-7");
        assertThat(links.staffLessonLink(teacherId, "local-event-7", false))
                .isEqualTo("https://school.test/teacher/lessons/local-event-7");
        NotificationMessages.Email ru = NotificationMessages.ownerWorkbookFailure(
                Language.RU, "local-event-7", 4, "WORKBOOK_LAYOUT_QA", link);
        assertThat(ru.subject()).contains("Mindcrafti");
        assertThat(ru.body()).contains("попытки").contains("WORKBOOK_LAYOUT_QA").contains(link);
        NotificationMessages.Email de = NotificationMessages.ownerWorkbookFailure(
                Language.DE, "local-event-7", 1, "WORKBOOK_LAYOUT_QA", link);
        assertThat(de.body()).contains("automatische Korrektur").contains(link);
    }

    @Test
    void reminderEmailIncludesTaskCountsAndLoginLink() {
        NotificationMessages.Email de = NotificationMessages.dailyTaskReminder(
                Language.DE, "Sam", 5, 1, "http://app/today");

        assertThat(de.body())
                .contains("Sam")
                .contains("5")
                .contains("1")
                .contains("http://app/today");
    }
}
