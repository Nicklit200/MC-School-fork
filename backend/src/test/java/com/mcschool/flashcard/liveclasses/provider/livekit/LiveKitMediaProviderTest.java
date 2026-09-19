package com.mcschool.flashcard.liveclasses.provider.livekit;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mcschool.flashcard.liveclasses.OnlineClassProperties;
import com.mcschool.flashcard.liveclasses.provider.MediaGrant;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import org.junit.jupiter.api.Test;

/**
 * Verifies the contents of a minted participant token without contacting
 * LiveKit. Token signing is local, so this runs deterministically in CI with a
 * throw-away key/secret and no credentials.
 */
class LiveKitMediaProviderTest {

    private static final String API_KEY = "test-api-key";
    private static final String API_SECRET = "test-api-secret-value-not-a-real-credential";
    private static final String ROOM = "mcs-6f1f8b0e-0000-0000-0000-000000000000";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private LiveKitMediaProvider provider() {
        OnlineClassProperties properties = new OnlineClassProperties(
                true, "wss://example.livekit.cloud", API_KEY, API_SECRET,
                false, false, null, null, Duration.ofMinutes(10), null, null, false);
        return new LiveKitMediaProvider(properties);
    }

    private static JsonNode claims(String jwt) throws Exception {
        String payload = jwt.split("\\.")[1];
        byte[] decoded = Base64.getUrlDecoder().decode(payload);
        return MAPPER.readTree(new String(decoded, StandardCharsets.UTF_8));
    }

    @Test
    void connectionExposesOnlyThePublicWebSocketUrlAndAToken() {
        ParticipantConnection connection = provider().createConnection(
                ROOM, "user-1|device-a", "Teacher", MediaGrant.host(), Duration.ofMinutes(10));

        assertThat(connection.serverUrl()).isEqualTo("wss://example.livekit.cloud");
        assertThat(connection.roomName()).isEqualTo(ROOM);
        assertThat(connection.identity()).isEqualTo("user-1|device-a");
        // The API secret must never travel to the browser.
        assertThat(connection.token()).doesNotContain(API_SECRET);
        assertThat(connection.serverUrl()).doesNotContain(API_SECRET);
    }

    @Test
    void tokenIsScopedToASingleRoomAndIdentity() throws Exception {
        ParticipantConnection connection = provider().createConnection(
                ROOM, "user-1|device-a", "Teacher", MediaGrant.host(), Duration.ofMinutes(10));

        JsonNode claims = claims(connection.token());

        assertThat(claims.get("sub").asText()).isEqualTo("user-1|device-a");
        assertThat(claims.get("iss").asText()).isEqualTo(API_KEY);
        JsonNode video = claims.get("video");
        assertThat(video.get("room").asText()).isEqualTo(ROOM);
        assertThat(video.get("roomJoin").asBoolean()).isTrue();
    }

    @Test
    void tokenNeverCarriesRoomAdminOrRecordingRights() throws Exception {
        ParticipantConnection connection = provider().createConnection(
                ROOM, "user-1|device-a", "Teacher", MediaGrant.host(), Duration.ofMinutes(10));

        JsonNode video = claims(connection.token()).get("video");

        // Moderation and recording are performed by the backend with server
        // credentials; a browser token must never be able to do either.
        assertThat(video.hasNonNull("roomAdmin") && video.get("roomAdmin").asBoolean()).isFalse();
        assertThat(video.hasNonNull("roomRecord") && video.get("roomRecord").asBoolean()).isFalse();
        assertThat(video.hasNonNull("roomCreate") && video.get("roomCreate").asBoolean()).isFalse();
        assertThat(video.hasNonNull("roomList") && video.get("roomList").asBoolean()).isFalse();
    }

    @Test
    void tokenTtlIsShort() throws Exception {
        ParticipantConnection connection = provider().createConnection(
                ROOM, "user-1|device-a", "Teacher", MediaGrant.host(), Duration.ofMinutes(10));

        // The SDK emits iss/exp/sub/name/video only — there is no nbf or iat —
        // so the lifetime is measured against the current clock.
        JsonNode claims = claims(connection.token());
        long lifetimeSeconds = claims.get("exp").asLong() - java.time.Instant.now().getEpochSecond();

        assertThat(lifetimeSeconds)
                .isPositive()
                .isLessThanOrEqualTo(Duration.ofMinutes(15).toSeconds());
        assertThat(connection.expiresAt()).isNotNull();
    }

    @Test
    void studentWithoutScreenSharePermissionCannotPublishIt() throws Exception {
        ParticipantConnection connection = provider().createConnection(
                ROOM, "user-2|device-b", "Student", MediaGrant.student(false), Duration.ofMinutes(10));

        JsonNode sources = claims(connection.token()).get("video").get("canPublishSources");

        assertThat(sources).isNotNull();
        assertThat(sources.toString()).contains("camera").contains("microphone");
        assertThat(sources.toString()).doesNotContain("screen_share");
    }

    @Test
    void studentWithScreenSharePermissionMayPublishIt() throws Exception {
        ParticipantConnection connection = provider().createConnection(
                ROOM, "user-2|device-b", "Student", MediaGrant.student(true), Duration.ofMinutes(10));

        JsonNode sources = claims(connection.token()).get("video").get("canPublishSources");

        assertThat(sources.toString()).contains("screen_share");
    }

    @Test
    void urlsAreConvertedBetweenWebSocketAndHttpForms() {
        assertThat(LiveKitMediaProvider.toHttpUrl("wss://x.livekit.cloud"))
                .isEqualTo("https://x.livekit.cloud");
        assertThat(LiveKitMediaProvider.toHttpUrl("ws://localhost:7880"))
                .isEqualTo("http://localhost:7880");
        assertThat(LiveKitMediaProvider.toWebSocketUrl("https://x.livekit.cloud"))
                .isEqualTo("wss://x.livekit.cloud");
        assertThat(LiveKitMediaProvider.toWebSocketUrl("http://localhost:7880"))
                .isEqualTo("ws://localhost:7880");
        // An already-correct URL passes through untouched.
        assertThat(LiveKitMediaProvider.toWebSocketUrl("wss://x.livekit.cloud"))
                .isEqualTo("wss://x.livekit.cloud");
    }
}
