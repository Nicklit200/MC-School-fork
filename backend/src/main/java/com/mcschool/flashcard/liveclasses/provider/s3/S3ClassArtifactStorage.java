package com.mcschool.flashcard.liveclasses.provider.s3;

import com.mcschool.flashcard.liveclasses.ClassStorageProperties;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import java.net.URI;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/**
 * S3-compatible storage adapter.
 *
 * <p>Path-style addressing and a custom endpoint make this work unchanged
 * against AWS S3, Cloudflare R2 and MinIO.
 */
public class S3ClassArtifactStorage implements ClassArtifactStorage {

    private static final Logger log = LoggerFactory.getLogger(S3ClassArtifactStorage.class);

    private final ClassStorageProperties properties;
    private final S3Client client;
    private final S3Presigner presigner;

    public S3ClassArtifactStorage(ClassStorageProperties properties) {
        this.properties = properties;
        StaticCredentialsProvider credentials = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(properties.accessKey(), properties.secretKey()));
        Region region = Region.of(properties.region());
        S3Configuration serviceConfiguration = S3Configuration.builder()
                .pathStyleAccessEnabled(properties.pathStyle())
                .build();

        var clientBuilder = S3Client.builder()
                .region(region)
                .credentialsProvider(credentials)
                .serviceConfiguration(serviceConfiguration);
        var presignerBuilder = S3Presigner.builder()
                .region(region)
                .credentialsProvider(credentials)
                .serviceConfiguration(serviceConfiguration);

        if (properties.endpoint() != null && !properties.endpoint().isBlank()) {
            URI endpoint = URI.create(properties.endpoint());
            clientBuilder.endpointOverride(endpoint);
            presignerBuilder.endpointOverride(endpoint);
        }
        this.client = clientBuilder.build();
        this.presigner = presignerBuilder.build();
    }

    @Override
    public boolean isConfigured() {
        return properties.isConfigured();
    }

    /**
     * Class-scoped, opaque key. The random suffix stops one class's artifact
     * names being guessable from another's, and no name or e-mail appears.
     */
    @Override
    public String buildObjectKey(String classId, String artifactName) {
        String safeName = artifactName.replaceAll("[^A-Za-z0-9._-]", "-");
        return "classes/" + classId + "/" + UUID.randomUUID() + "-" + safeName;
    }

    @Override
    public void put(String objectKey, byte[] content, String contentType) {
        client.putObject(
                PutObjectRequest.builder()
                        .bucket(properties.bucket())
                        .key(objectKey)
                        .contentType(contentType)
                        .build(),
                RequestBody.fromBytes(content));
    }

    /**
     * A short-lived download URL.
     *
     * <p>The returned URL carries a signature and is therefore a credential: it
     * must never be logged or stored.
     */
    @Override
    public Optional<String> createSignedDownloadUrl(String objectKey, Duration ttl) {
        if (objectKey == null || objectKey.isBlank()) {
            return Optional.empty();
        }
        Duration effective = ttl == null ? properties.signedUrlTtl() : ttl;
        try {
            var presigned = presigner.presignGetObject(GetObjectPresignRequest.builder()
                    .signatureDuration(effective)
                    .getObjectRequest(GetObjectRequest.builder()
                            .bucket(properties.bucket())
                            .key(objectKey)
                            .build())
                    .build());
            return Optional.of(presigned.url().toString());
        } catch (RuntimeException e) {
            // Never log the exception body: it can echo the signed URL.
            log.warn("Could not sign a download URL for a class artifact");
            return Optional.empty();
        }
    }

    /** Deleting an object that is already gone is success, not an error. */
    @Override
    public void delete(String objectKey) {
        try {
            client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(properties.bucket())
                    .key(objectKey)
                    .build());
        } catch (NoSuchKeyException e) {
            log.debug("Artifact already absent during delete");
        }
    }

    @Override
    public boolean exists(String objectKey) {
        try {
            client.headObject(HeadObjectRequest.builder()
                    .bucket(properties.bucket())
                    .key(objectKey)
                    .build());
            return true;
        } catch (NoSuchKeyException e) {
            return false;
        } catch (RuntimeException e) {
            log.warn("Could not check a class artifact's existence");
            return false;
        }
    }
}
