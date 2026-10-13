package com.mcschool.flashcard.liveclasses;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * S3-compatible object storage for class recordings and exported artifacts.
 *
 * <p>Works with AWS S3, Cloudflare R2 and MinIO. Credentials here are
 * server-side only and must never reach a browser, a response or a log line.
 */
@ConfigurationProperties(prefix = "app.class-storage")
public record ClassStorageProperties(
        String endpoint,
        String region,
        String bucket,
        String accessKey,
        String secretKey,
        boolean pathStyle,
        Duration signedUrlTtl,
        int recordingRetentionDays,
        int transcriptRetentionDays
) {

    public ClassStorageProperties {
        region = (region == null || region.isBlank()) ? "auto" : region;
        // Signed URLs are credentials: keep their lifetime short.
        signedUrlTtl = signedUrlTtl == null ? Duration.ofMinutes(10) : signedUrlTtl;
        recordingRetentionDays = recordingRetentionDays <= 0 ? 90 : recordingRetentionDays;
        transcriptRetentionDays = transcriptRetentionDays <= 0 ? 365 : transcriptRetentionDays;
    }

    public boolean isConfigured() {
        return hasText(bucket) && hasText(accessKey) && hasText(secretKey);
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
