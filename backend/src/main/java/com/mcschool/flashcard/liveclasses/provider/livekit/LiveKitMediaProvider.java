package com.mcschool.flashcard.liveclasses.provider.livekit;

import com.mcschool.flashcard.liveclasses.OnlineClassProperties;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaGrant;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import io.livekit.server.AccessToken;
import io.livekit.server.CanPublish;
import io.livekit.server.CanPublishData;
import io.livekit.server.CanPublishSources;
import io.livekit.server.CanSubscribe;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import io.livekit.server.RoomServiceClient;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import livekit.LivekitModels;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import retrofit2.Call;
import retrofit2.Response;

/**
 * LiveKit implementation of the realtime media port.
 *
 * <p>All provider credentials stay here. The browser only ever receives the
 * public {@code wss://} URL and a short-lived token scoped to one room and one
 * identity — never the API secret and never a room-admin grant.
 *
 * <p>Verified against server-sdk-kotlin 0.16.0: {@code AccessToken.ttl} is in
 * milliseconds, and {@code RoomServiceClient} returns Retrofit {@code Call}s.
 */
public class LiveKitMediaProvider implements LiveClassMediaProvider {

    private static final Logger log = LoggerFactory.getLogger(LiveKitMediaProvider.class);

    /** Track sources, as named by the LiveKit protocol. */
    private static final String SOURCE_CAMERA = "camera";
    private static final String SOURCE_MICROPHONE = "microphone";
    private static final String SOURCE_SCREEN_SHARE = "screen_share";
    private static final String SOURCE_SCREEN_SHARE_AUDIO = "screen_share_audio";

    private final OnlineClassProperties properties;
    private final RoomServiceClient roomServiceClient;

    public LiveKitMediaProvider(OnlineClassProperties properties) {
        this.properties = properties;
        this.roomServiceClient = RoomServiceClient.createClient(
                toHttpUrl(properties.livekitUrl()),
                properties.livekitApiKey(),
                properties.livekitApiSecret());
    }

    @Override
    public boolean isConfigured() {
        return properties.isMediaConfigured();
    }

    @Override
    public ParticipantConnection createConnection(String roomName, String identity, String displayName,
                                                  MediaGrant grant, Duration ttl) {
        AccessToken token = new AccessToken(properties.livekitApiKey(), properties.livekitApiSecret());
        token.setIdentity(identity);
        token.setName(displayName);
        token.setTtl(ttl.toMillis());

        List<io.livekit.server.VideoGrant> grants = new ArrayList<>();
        grants.add(new RoomJoin(true));
        grants.add(new RoomName(roomName));
        grants.add(new CanSubscribe(grant.canSubscribe()));
        grants.add(new CanPublish(grant.canPublishAnything()));
        grants.add(new CanPublishData(grant.canPublishData()));
        grants.add(new CanPublishSources(allowedSources(grant)));
        // Deliberately absent: RoomAdmin, RoomRecord, RoomCreate, RoomList.
        // Moderation and recording are performed by the backend, never by a client.
        token.addGrants(grants.toArray(new io.livekit.server.VideoGrant[0]));

        return new ParticipantConnection(
                toWebSocketUrl(properties.livekitUrl()),
                token.toJwt(),
                identity,
                roomName,
                Instant.now().plus(ttl));
    }

    /** Per-source publishing rights, so a student cannot screen-share unless allowed. */
    private static List<String> allowedSources(MediaGrant grant) {
        List<String> sources = new ArrayList<>();
        if (grant.canPublishCamera()) {
            sources.add(SOURCE_CAMERA);
        }
        if (grant.canPublishMicrophone()) {
            sources.add(SOURCE_MICROPHONE);
        }
        if (grant.canPublishScreenShare()) {
            sources.add(SOURCE_SCREEN_SHARE);
            sources.add(SOURCE_SCREEN_SHARE_AUDIO);
        }
        return sources;
    }

    @Override
    public void ensureRoom(String roomName) {
        try {
            execute(roomServiceClient.createRoom(roomName));
        } catch (MediaProviderException e) {
            // Creating an existing room is not an error for our purposes; the
            // room is ensured either way.
            log.debug("ensureRoom: room {} already present or create rejected", safe(roomName));
        }
    }

    @Override
    public void closeRoom(String roomName) {
        try {
            execute(roomServiceClient.deleteRoom(roomName));
        } catch (MediaProviderException e) {
            log.debug("closeRoom: room {} already gone", safe(roomName));
        }
    }

    @Override
    public void muteParticipantAudio(String roomName, String identity) {
        LivekitModels.ParticipantInfo participant =
                execute(roomServiceClient.getParticipant(roomName, identity));
        if (participant == null) {
            return;
        }
        for (LivekitModels.TrackInfo track : participant.getTracksList()) {
            if (track.getType() == LivekitModels.TrackType.AUDIO && !track.getMuted()) {
                execute(roomServiceClient.mutePublishedTrack(roomName, identity, track.getSid(), true));
            }
        }
    }

    @Override
    public void removeParticipant(String roomName, String identity) {
        // revokeTokenTs invalidates tokens issued up to now, so a removed
        // participant cannot rejoin with the token they already hold.
        execute(roomServiceClient.removeParticipant(roomName, identity, Instant.now().toEpochMilli()));
    }

    @Override
    public void updatePublishPermissions(String roomName, String identity, MediaGrant grant) {
        LivekitModels.ParticipantPermission permission = LivekitModels.ParticipantPermission.newBuilder()
                .setCanSubscribe(grant.canSubscribe())
                .setCanPublish(grant.canPublishAnything())
                .setCanPublishData(grant.canPublishData())
                .addAllCanPublishSources(toProtoSources(grant))
                .build();
        execute(roomServiceClient.updateParticipant(roomName, identity, null, null, permission, null));
    }

    private static List<LivekitModels.TrackSource> toProtoSources(MediaGrant grant) {
        List<LivekitModels.TrackSource> sources = new ArrayList<>();
        if (grant.canPublishCamera()) {
            sources.add(LivekitModels.TrackSource.CAMERA);
        }
        if (grant.canPublishMicrophone()) {
            sources.add(LivekitModels.TrackSource.MICROPHONE);
        }
        if (grant.canPublishScreenShare()) {
            sources.add(LivekitModels.TrackSource.SCREEN_SHARE);
            sources.add(LivekitModels.TrackSource.SCREEN_SHARE_AUDIO);
        }
        return sources;
    }

    @Override
    public List<String> listParticipantIdentities(String roomName) {
        List<LivekitModels.ParticipantInfo> participants =
                execute(roomServiceClient.listParticipants(roomName));
        if (participants == null) {
            return List.of();
        }
        return participants.stream().map(LivekitModels.ParticipantInfo::getIdentity).toList();
    }

    @Override
    public void sendControlPacket(String roomName, String topic, byte[] payload) {
        execute(roomServiceClient.sendData(roomName, payload, LivekitModels.DataPacket.Kind.RELIABLE,
                List.of(), List.of(), topic));
    }

    /**
     * Unwraps a Retrofit call. Provider errors are rethrown without the response
     * body, which can echo request details; tokens are never logged.
     */
    private static <T> T execute(Call<T> call) {
        try {
            Response<T> response = call.execute();
            if (!response.isSuccessful()) {
                throw new MediaProviderException(
                        "LiveKit request failed with HTTP " + response.code());
            }
            return response.body();
        } catch (java.io.IOException e) {
            throw new MediaProviderException("LiveKit request failed", e);
        }
    }

    /** RoomServiceClient talks HTTPS; browsers get the wss:// form. */
    static String toHttpUrl(String url) {
        if (url == null) {
            return null;
        }
        if (url.startsWith("wss://")) {
            return "https://" + url.substring("wss://".length());
        }
        if (url.startsWith("ws://")) {
            return "http://" + url.substring("ws://".length());
        }
        return url;
    }

    static String toWebSocketUrl(String url) {
        if (url == null) {
            return null;
        }
        if (url.startsWith("https://")) {
            return "wss://" + url.substring("https://".length());
        }
        if (url.startsWith("http://")) {
            return "ws://" + url.substring("http://".length());
        }
        return url;
    }

    /** Room names are opaque, but keep log lines defensive regardless. */
    private static String safe(String roomName) {
        return roomName == null ? "unknown" : roomName;
    }
}
