package com.mcschool.flashcard.notifications;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/** Sends an immediate push when cards are assigned for today. */
@Service
public class CardPushNotificationService {

    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");

    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;

    public CardPushNotificationService(PushSubscriptionRepository subscriptionRepository,
                                       WebPushService webPushService) {
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
    }

    @Async
    public void notifyCardsAssigned(UUID studentId, UUID homeworkId, LocalDate startDate) {
        if (!startDate.equals(LocalDate.now(SCHOOL_ZONE)) || !webPushService.isConfigured()) {
            return;
        }

        String url = "/my-cards/" + homeworkId;
        for (PushSubscription subscription : subscriptionRepository.findAllByUserId(studentId)) {
            try {
                webPushService.send(
                        subscription,
                        "Mindcrafti School",
                        "Тебе заданы новые карточки на сегодня 🧠",
                        url);
            } catch (RuntimeException ignored) {
                // A broken device subscription must never make card creation fail.
            }
        }
    }
}
