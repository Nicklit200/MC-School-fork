package com.mcschool.flashcard.liveclasses.provider;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

/** Used when object storage has no credentials. Never pretends to store anything. */
public class UnconfiguredArtifactStorage implements ClassArtifactStorage {

    private static final String MESSAGE = "Class artifact storage is not configured";

    @Override
    public boolean isConfigured() {
        return false;
    }

    @Override
    public String buildObjectKey(String classId, String artifactName) {
        return "classes/" + classId + "/" + UUID.randomUUID() + "-" + artifactName;
    }

    @Override
    public void put(String objectKey, byte[] content, String contentType) {
        throw new MediaProviderException(MESSAGE);
    }

    @Override
    public Optional<String> createSignedDownloadUrl(String objectKey, Duration ttl) {
        return Optional.empty();
    }

    /** Deleting from storage that does not exist is a no-op, not a failure. */
    @Override
    public void delete(String objectKey) {
        // no-op
    }

    @Override
    public boolean exists(String objectKey) {
        return false;
    }
}
