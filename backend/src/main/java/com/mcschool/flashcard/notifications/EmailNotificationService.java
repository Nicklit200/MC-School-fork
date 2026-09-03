package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.User;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name = "app.mail.enabled", havingValue = "true")
public class EmailNotificationService implements NotificationService {

    private static final Logger log = LoggerFactory.getLogger(EmailNotificationService.class);
    private static final URI BREVO_SEND_EMAIL_URI = URI.create("https://api.brevo.com/v3/smtp/email");
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient httpClient;
    private final AppLinks appLinks;
    private final String from;
    private final String brevoApiKey;

    @Autowired
    public EmailNotificationService(AppLinks appLinks,
                                    @Value("${app.mail.from}") String from,
                                    @Value("${app.brevo.api-key}") String brevoApiKey) {
        this(HttpClient.newBuilder().connectTimeout(REQUEST_TIMEOUT).build(), appLinks, from, brevoApiKey);
    }

    EmailNotificationService(HttpClient httpClient, AppLinks appLinks, String from, String brevoApiKey) {
        this.httpClient = httpClient;
        this.appLinks = appLinks;
        this.from = from;
        this.brevoApiKey = brevoApiKey;
    }

    @Override
    public void sendInvitation(User invitee, String invitationToken) {
        NotificationMessages.Email email = NotificationMessages.invitation(
                invitee.getPreferredLanguage(), invitee.getFullName(), appLinks.activationLink(invitationToken));
        send(invitee.getEmail(), invitee.getFullName(), email);
    }

    @Override
    public void sendDailyTaskReminder(User student, long dueCardCount, long dueHomeworkCount) {
        NotificationMessages.Email email = NotificationMessages.dailyTaskReminder(
                student.getPreferredLanguage(), student.getFullName(), dueCardCount, dueHomeworkCount,
                appLinks.todayLink());
        send(student.getEmail(), student.getFullName(), email);
    }

    @Override
    public void sendParentMissedHomework(User parent, User student, long unfinishedHomeworkCount) {
        if (parent.getEmail() == null || parent.getEmail().isBlank()) return;
        NotificationMessages.Email email = NotificationMessages.parentMissedHomework(
                parent.getPreferredLanguage(), parent.getFullName(), student.getFullName(),
                unfinishedHomeworkCount, appLinks.parentLink());
        send(parent.getEmail(), parent.getFullName(), email);
    }

    private void send(String toEmail, String toName, NotificationMessages.Email email) {
        try {
            String body = brevoRequestBody(toEmail, toName, email);
            HttpRequest request = HttpRequest.newBuilder(BREVO_SEND_EMAIL_URI)
                    .timeout(REQUEST_TIMEOUT)
                    .header("accept", "application/json")
                    .header("content-type", "application/json")
                    .header("api-key", brevoApiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                log.error("Brevo API email send failed for {}: status={} error={}", toEmail, response.statusCode(), response.body());
            }
        } catch (IOException e) {
            log.error("Brevo API email send failed for {}: {}", toEmail, e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("Brevo API email send interrupted for {}: {}", toEmail, e.getMessage());
        }
    }

    private String brevoRequestBody(String toEmail, String toName, NotificationMessages.Email email) {
        return "{"
                + "\"sender\":{\"email\":\"" + jsonEscape(from) + "\"},"
                + "\"to\":[{\"email\":\"" + jsonEscape(toEmail) + "\",\"name\":\"" + jsonEscape(toName) + "\"}],"
                + "\"subject\":\"" + jsonEscape(email.subject()) + "\","
                + "\"textContent\":\"" + jsonEscape(email.body()) + "\""
                + "}";
    }

    private String jsonEscape(String value) {
        StringBuilder escaped = new StringBuilder();
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (c < 0x20) escaped.append(String.format("\\u%04x", (int) c));
                    else escaped.append(c);
                }
            }
        }
        return escaped.toString();
    }
}
