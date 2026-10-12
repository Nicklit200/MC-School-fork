package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.Role;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class StoryTemplateDownloadLinkService {
    private final StoryTemplateMasterService masterService;
    private final byte[] key;
    private final String publicBaseUrl;

    public StoryTemplateDownloadLinkService(
            StoryTemplateMasterService masterService,
            @Value("${app.security.jwt.secret}") String jwtSecret,
            @Value("${PUBLIC_BASE_URL:${MINDCRAFTI_PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}}") String publicBaseUrl) {
        this.masterService = masterService;
        this.key = jwtSecret.getBytes(StandardCharsets.UTF_8);
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    public Map<String, Object> create(User user, boolean apiKey) {
        if (!apiKey && (user == null || user.getRole() != Role.ADMIN)) {
            throw new IllegalArgumentException("Administrator access required");
        }
        Map<String, Object> info = masterService.infoForMcp(user, apiKey);
        if (!Boolean.TRUE.equals(info.get("configured"))) {
            throw new IllegalArgumentException("Story master is not uploaded yet");
        }
        long expires = Instant.now().plusSeconds(300).getEpochSecond();
        String payload = info.get("version") + ":" + expires + ":" + info.get("sha256");
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        String token = encoded + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(sign(encoded));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("downloadUrl", publicBaseUrl + "/api/v1/public/story-template/download?token=" + token);
        result.put("expiresAt", Instant.ofEpochSecond(expires).toString());
        result.put("version", info.get("version"));
        result.put("sha256", info.get("sha256"));
        result.put("filename", info.get("filename"));
        result.put("sizeBytes", info.get("sizeBytes"));
        result.put("usage", "Download immediately before expiry, compare SHA256, edit only text in cloned PPTX, preserve all other original slide data.");
        return result;
    }

    public byte[] validatedDownload(String token) {
        if (token == null || token.length() > 512 || token.isBlank()) {
            throw new IllegalArgumentException("Invalid download token");
        }
        String[] parts = token.split("\\.", -1);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid download token");
        byte[] given;
        try {
            given = Base64.getUrlDecoder().decode(parts[1]);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid download token");
        }
        if (!MessageDigest.isEqual(sign(parts[0]), given)) {
            throw new IllegalArgumentException("Invalid download token");
        }
        String[] fields;
        try {
            fields = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8).split(":", -1);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid download token");
        }
        if (fields.length != 3) throw new IllegalArgumentException("Invalid download token");
        long version;
        long expiry;
        try {
            version = Long.parseLong(fields[0]);
            expiry = Long.parseLong(fields[1]);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Invalid download token");
        }
        if (expiry < Instant.now().getEpochSecond() || expiry > Instant.now().plusSeconds(300).getEpochSecond()) {
            throw new IllegalArgumentException("Download link expired");
        }
        // Protect against a replaced master while a short-lived URL is still valid.
        Map<String, Object> info = masterService.infoForMcp(null, true);
        if (!Boolean.TRUE.equals(info.get("configured"))
                || ((Number) info.get("version")).longValue() != version
                || !fields[2].equals(info.get("sha256"))) {
            throw new IllegalArgumentException("Template version changed");
        }
        return masterService.downloadForValidatedLink();
    }

    private byte[] sign(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("Download signing failed", e);
        }
    }
}
