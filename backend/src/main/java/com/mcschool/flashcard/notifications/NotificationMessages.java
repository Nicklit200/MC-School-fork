package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.Language;

/** Subject/body text for transactional notification emails. */
final class NotificationMessages {

    record Email(String subject, String body) {
    }

    private NotificationMessages() {
    }

    static Email invitation(Language language, String fullName, String activationLink) {
        if (language == Language.DE) {
            return new Email(
                    "Willkommen bei Mindcraft School",
                    "Hallo " + fullName + ",\n\n"
                            + "es wurde ein Konto für dich erstellt. Öffne den folgenden Link, "
                            + "um dein Passwort festzulegen und dich anzumelden:\n\n"
                            + activationLink + "\n\n"
                            + "Der Link ist 7 Tage gültig.\n\n"
                            + "Mindcraft School");
        }
        return new Email(
                "Добро пожаловать в Mindcraft School",
                "Здравствуйте, " + fullName + "!\n\n"
                        + "Для вас создан аккаунт. Перейдите по ссылке ниже, чтобы задать "
                        + "пароль и войти:\n\n"
                        + activationLink + "\n\n"
                        + "Ссылка действительна 7 дней.\n\n"
                        + "Mindcraft School");
    }

    static Email dailyTaskReminder(Language language, String fullName, long cards, long homeworks, String todayLink) {
        if (language == Language.DE) {
            return new Email(
                    "Deine Aufgaben für heute",
                    "Hallo " + fullName + ",\n\n"
                            + dailyLineDe(cards, homeworks) + "\n\n"
                            + "Öffne Mindcrafti, um die Aufgaben zu erledigen:\n\n"
                            + todayLink + "\n\n"
                            + "Mindcraft School");
        }
        return new Email(
                "Твои задания на сегодня",
                "Здравствуйте, " + fullName + "!\n\n"
                        + dailyLineRu(cards, homeworks) + "\n\n"
                        + "Откройте Mindcrafti, чтобы выполнить задания:\n\n"
                        + todayLink + "\n\n"
                        + "Mindcraft School");
    }

    private static String dailyLineRu(long cards, long homeworks) {
        if (cards > 0 && homeworks > 0) return "На сегодня: " + cards + " карточек и " + homeworks + " домашка.";
        if (cards > 0) return "На сегодня нужно повторить " + cards + " карточек.";
        return "На сегодня есть домашка: " + homeworks + ".";
    }

    private static String dailyLineDe(long cards, long homeworks) {
        if (cards > 0 && homeworks > 0) return "Für heute: " + cards + " Karte(n) und " + homeworks + " Hausaufgabe(n).";
        if (cards > 0) return "Für heute sind " + cards + " Karte(n) zur Wiederholung fällig.";
        return "Für heute gibt es " + homeworks + " Hausaufgabe(n).";
    }
}
