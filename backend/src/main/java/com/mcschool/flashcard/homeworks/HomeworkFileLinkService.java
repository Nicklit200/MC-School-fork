package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.config.JwtProperties;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Short-lived bearer links. Call linksFor only after authorizing access to the homework. */
@Service
public class HomeworkFileLinkService {

    public enum Kind {
        SUBMISSION("submission"), WORKSHEET("worksheet");
        private final String path;
        Kind(String path) { this.path = path; }
        public String path() { return path; }
    }

    private static final String PURPOSE = "mindcrafti-homework-files-v1";
    private final HomeworkRepository repository;
    private final byte[] signingKey;
    private final String baseUrl;
    private final long ttlSeconds;
    private final Clock clock;

    @Autowired
    public HomeworkFileLinkService(
            HomeworkRepository repository,
            JwtProperties jwtProperties,
            @Value("${PUBLIC_BASE_URL:${MINDCRAFTI_PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}}") String baseUrl,
            @Value("${app.homeworks.signed-link-ttl-minutes:60}") long ttlMinutes) {
        this(repository, jwtProperties, baseUrl, ttlMinutes, Clock.systemUTC());
    }

    HomeworkFileLinkService(HomeworkRepository repository, JwtProperties jwtProperties,
                            String baseUrl, long ttlMinutes, Clock clock) {
        if (ttlMinutes < 1 || ttlMinutes > 1440) {
            throw new IllegalArgumentException("Homework link TTL must be between 1 and 1440 minutes");
        }
        URI uri = URI.create(baseUrl);
        boolean local = "localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost());
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null
                || uri.getFragment() != null || (!"https".equals(uri.getScheme())
                && !(local && "http".equals(uri.getScheme())))) {
            throw new IllegalArgumentException("Homework links require an HTTPS public base URL");
        }
        this.repository = repository;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.ttlSeconds = ttlMinutes * 60;
        this.clock = clock;
        String secret = jwtProperties.secret();
        // Do not expose bearer URLs signed with the repository's known development key.
        // Other application functions remain available if signing is not configured safely.
        boolean secure = secret != null && secret.getBytes(StandardCharsets.UTF_8).length >= 32
                && !secret.startsWith("local-dev-only-");
        this.signingKey = secure ? hmac(secret.getBytes(StandardCharsets.UTF_8), PURPOSE) : null;
    }

    public Map<String, Object> linksFor(Homework homework) {
        Map<String, Object> result = new LinkedHashMap<>();
        long expires = clock.instant().getEpochSecond() + ttlSeconds;
        addLink(result, "submittedPdfUrl", homework, Kind.SUBMISSION, homework.isSubmitted(), expires);
        addLink(result, "originalAssignmentUrl", homework, Kind.WORKSHEET, homework.hasWorksheet(), expires);
        result.put("fileLinksAvailable", signingKey != null);
        return result;
    }

    private void addLink(Map<String, Object> result, String field, Homework homework,
                         Kind kind, boolean present, long expires) {
        boolean available = present && signingKey != null;
        String url = null;
        if (available) {
            String revision = revision(homework, kind);
            String signature = sign(homework.getId(), kind, revision, expires);
            url = baseUrl + "/api/v1/public/homework-files/" + homework.getId()
                    + "/" + kind.path() + ".pdf?expires=" + expires
                    + "&revision=" + revision + "&signature=" + signature;
        }
        result.put(field, url);
        result.put(field + "ExpiresAt", available ? Instant.ofEpochSecond(expires).toString() : null);
    }

    @Transactional(readOnly = true)
    public Download download(UUID homeworkId, Kind kind, long expires, String revision, String signature) {
        if (signingKey == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Homework file links are unavailable");
        }
        long now = clock.instant().getEpochSecond();
        if (expires <= now || expires > now + 86400 || revision == null
                || !revision.matches("[a-f0-9]{64}") || signature == null
                || !signature.matches("[A-Za-z0-9_-]{43}")
                || !constantTimeEquals(sign(homeworkId, kind, revision, expires), signature)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid or expired homework file link");
        }
        // Validate the signature before any database lookup. Guessing UUIDs grants no access.
        Homework homework = repository.findById(homeworkId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Homework file not found"));
        boolean present = kind == Kind.SUBMISSION ? homework.isSubmitted() : homework.hasWorksheet();
        if (!present || homework.getStudent().isArchived()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Homework file not found");
        }
        if (!constantTimeEquals(revision(homework, kind), revision)) {
            throw new ResponseStatusException(HttpStatus.GONE, "Homework file changed; request a new link");
        }
        byte[] bytes = kind == Kind.SUBMISSION ? homework.getSubmittedPdf() : homework.getWorksheetPdf();
        String filename = kind == Kind.SUBMISSION ? homework.getSubmittedFilename() : homework.getWorksheetFilename();
        if (filename == null || filename.isBlank()) filename = "homework-" + kind.path() + ".pdf";
        // Never substitute the original worksheet when a submission is absent.
        return new Download(bytes, filename);
    }

    private String revision(Homework homework, Kind kind) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String owner = homework.getStudent().getTeacher() == null ? ""
                    : homework.getStudent().getTeacher().getId().toString();
            String filename = kind == Kind.SUBMISSION ? homework.getSubmittedFilename() : homework.getWorksheetFilename();
            String submittedAt = kind == Kind.SUBMISSION ? String.valueOf(homework.getSubmittedAt()) : "";
            String metadata = homework.getStudent().getId() + "\n" + owner + "\n"
                    + kind.path() + "\n" + submittedAt + "\n" + String.valueOf(filename) + "\n";
            digest.update(metadata.getBytes(StandardCharsets.UTF_8));
            digest.update(kind == Kind.SUBMISSION ? homework.getSubmittedPdf() : homework.getWorksheetPdf());
            return HexFormat.of().formatHex(digest.digest());
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("Could not fingerprint homework file", ex);
        }
    }

    private String sign(UUID id, Kind kind, String revision, long expires) {
        String payload = PURPOSE + "\n" + id + "\n" + kind.path() + "\n" + revision + "\n" + expires;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(signingKey, payload));
    }

    private static byte[] hmac(byte[] key, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("Could not sign homework file link", ex);
        }
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
    }

    public record Download(byte[] bytes, String filename) {}
}
