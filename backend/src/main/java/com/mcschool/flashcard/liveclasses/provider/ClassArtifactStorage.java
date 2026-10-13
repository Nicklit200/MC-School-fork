package com.mcschool.flashcard.liveclasses.provider;

import java.time.Duration;
import java.util.Optional;

/**
 * Port for S3-compatible object storage (AWS S3, Cloudflare R2, MinIO).
 *
 * <p>Recordings and exported artifacts live here, never as BYTEA in PostgreSQL.
 */
public interface ClassArtifactStorage {

    boolean isConfigured();

    /** Bucket-relative key for an artifact, scoped to its class. */
    String buildObjectKey(String classId, String artifactName);

    /** Stores a small artifact such as an annotation snapshot or transcript export. */
    void put(String objectKey, byte[] content, String contentType);

    /**
     * A short-lived authorized URL for download/playback.
     *
     * @param ttl kept short; these URLs are credentials
     */
    Optional<String> createSignedDownloadUrl(String objectKey, Duration ttl);

    /** Deletes an object. Must be retryable and must not fail if already gone. */
    void delete(String objectKey);

    boolean exists(String objectKey);
}
