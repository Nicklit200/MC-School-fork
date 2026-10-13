package com.mcschool.flashcard.liveclasses.provider.livekit;

import com.mcschool.flashcard.liveclasses.ClassStorageProperties;
import com.mcschool.flashcard.liveclasses.OnlineClassProperties;
import com.mcschool.flashcard.liveclasses.provider.ClassRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import io.livekit.server.EgressServiceClient;
import livekit.LivekitEgress;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import retrofit2.Call;
import retrofit2.Response;

/**
 * LiveKit Egress implementation of server-side recording.
 *
 * <p>Starts a room-composite recording writing MP4 straight to S3-compatible
 * storage — recordings never pass through this application's heap.
 *
 * <p>The returned egress id is only a handle: completion is authoritative only
 * when the signature-verified webhook arrives.
 */
public class LiveKitRecordingProvider implements ClassRecordingProvider {

    private static final Logger log = LoggerFactory.getLogger(LiveKitRecordingProvider.class);

    private final OnlineClassProperties properties;
    private final ClassStorageProperties storageProperties;
    private final EgressServiceClient egressClient;

    public LiveKitRecordingProvider(OnlineClassProperties properties,
                                    ClassStorageProperties storageProperties) {
        this.properties = properties;
        this.storageProperties = storageProperties;
        this.egressClient = EgressServiceClient.createClient(
                LiveKitMediaProvider.toHttpUrl(properties.livekitUrl()),
                properties.livekitApiKey(),
                properties.livekitApiSecret());
    }

    @Override
    public boolean isConfigured() {
        return properties.isRecordingAvailable() && storageProperties.isConfigured();
    }

    @Override
    public String startRoomRecording(String roomName, String objectKey) {
        LivekitEgress.S3Upload.Builder upload = LivekitEgress.S3Upload.newBuilder()
                .setAccessKey(storageProperties.accessKey())
                .setSecret(storageProperties.secretKey())
                .setBucket(storageProperties.bucket())
                .setRegion(storageProperties.region())
                .setForcePathStyle(storageProperties.pathStyle());
        if (storageProperties.endpoint() != null && !storageProperties.endpoint().isBlank()) {
            upload.setEndpoint(storageProperties.endpoint());
        }

        LivekitEgress.EncodedFileOutput output = LivekitEgress.EncodedFileOutput.newBuilder()
                .setFileType(LivekitEgress.EncodedFileType.MP4)
                .setFilepath(objectKey)
                .setS3(upload.build())
                .build();

        LivekitEgress.EgressInfo info = execute(
                egressClient.startRoomCompositeEgress(roomName, output));
        if (info == null) {
            throw new MediaProviderException("Recording did not start");
        }
        log.info("Recording started for room, egressId={}", info.getEgressId());
        return info.getEgressId();
    }

    @Override
    public void stopRecording(String egressId) {
        try {
            execute(egressClient.stopEgress(egressId));
        } catch (MediaProviderException e) {
            // Already stopped or already completing: the webhook remains the
            // authority on the final state, so this is not fatal.
            log.debug("Stop recording was a no-op for egressId={}", egressId);
        }
    }

    private static <T> T execute(Call<T> call) {
        try {
            Response<T> response = call.execute();
            if (!response.isSuccessful()) {
                throw new MediaProviderException("LiveKit Egress request failed with HTTP "
                        + response.code());
            }
            return response.body();
        } catch (java.io.IOException e) {
            throw new MediaProviderException("LiveKit Egress request failed", e);
        }
    }
}
