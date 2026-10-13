package com.mcschool.flashcard.liveclasses;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.mcschool.flashcard.AbstractIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Date;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Verifies the webhook endpoint's exposure in {@code SecurityConfig}: reachable
 * without a user JWT, but never without a valid provider signature.
 */
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.online-classes.livekit-url=wss://test.invalid",
        "app.online-classes.livekit-api-key=" + LiveKitWebhookEndpointIntegrationTest.API_KEY,
        "app.online-classes.livekit-api-secret=" + LiveKitWebhookEndpointIntegrationTest.API_SECRET
})
class LiveKitWebhookEndpointIntegrationTest extends AbstractIntegrationTest {

    static final String API_KEY = "test-api-key";
    static final String API_SECRET = "test-api-secret-value-not-a-real-credential";

    private static final String PATH = "/api/v1/online-classes/webhooks/livekit";

    @Autowired
    private MockMvc mockMvc;

    private static String signedHeader(String body, String secret) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(body.getBytes(StandardCharsets.UTF_8));
        return JWT.create()
                .withIssuer(API_KEY)
                .withExpiresAt(new Date(System.currentTimeMillis() + 60_000))
                .withClaim("sha256", Base64.getEncoder().encodeToString(digest))
                .sign(Algorithm.HMAC256(secret));
    }

    @Test
    void aProperlySignedWebhookIsAcceptedWithoutAUserToken() throws Exception {
        String body = "{\"event\":\"room_started\"}";

        mockMvc.perform(post(PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .header("Authorization", signedHeader(body, API_SECRET)))
                .andExpect(status().isOk());
    }

    @Test
    void anUnsignedWebhookIsRejected() throws Exception {
        mockMvc.perform(post(PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"event\":\"room_started\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aWebhookSignedWithTheWrongSecretIsRejected() throws Exception {
        String body = "{\"event\":\"room_started\"}";

        mockMvc.perform(post(PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .header("Authorization", signedHeader(body, "attacker-secret")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aTamperedBodyIsRejected() throws Exception {
        String original = "{\"event\":\"room_started\"}";
        String header = signedHeader(original, API_SECRET);

        mockMvc.perform(post(PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"event\":\"room_finished\"}")
                        .header("Authorization", header))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void theWebhookPathIsNotABroadlyOpenPrefix() throws Exception {
        // The permit rule is scoped to POST on this exact path; sibling class
        // endpoints must still require authentication.
        mockMvc.perform(get("/api/v1/online-classes/upcoming"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get(PATH))
                .andExpect(status().isUnauthorized());
    }
}
