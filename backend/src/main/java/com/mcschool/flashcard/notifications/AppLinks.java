package com.mcschool.flashcard.notifications;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AppLinks {

    private final String frontendBaseUrl;

    public AppLinks(@Value("${app.frontend.base-url}") String frontendBaseUrl) {
        this.frontendBaseUrl = frontendBaseUrl.endsWith("/")
                ? frontendBaseUrl.substring(0, frontendBaseUrl.length() - 1)
                : frontendBaseUrl;
    }

    public String activationLink(String invitationToken) {
        return frontendBaseUrl + "/activate?token="
                + URLEncoder.encode(invitationToken, StandardCharsets.UTF_8);
    }

    public String todayLink() {
        return frontendBaseUrl + "/today";
    }

    public String parentLink() {
        return frontendBaseUrl + "/parent";
    }
}
