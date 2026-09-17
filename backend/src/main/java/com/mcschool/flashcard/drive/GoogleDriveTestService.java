package com.mcschool.flashcard.drive;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/** Minimal Google Drive client used to verify the service-account key and a folder URL. */
@Service
public class GoogleDriveTestService {

    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
    private static final String UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
    private static final Pattern FOLDER_URL = Pattern.compile("https://drive\\.google\\.com/(?:drive/(?:u/\\d+/)?folders/|folders/)([A-Za-z0-9_-]+)");

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String serviceAccountJson;

    private volatile String cachedAccessToken;
    private volatile long cachedAccessTokenExpiresAt;

    public GoogleDriveTestService(ObjectMapper objectMapper,
                                  @Value("${app.google-drive.service-account-json:}") String serviceAccountJson) {
        this.objectMapper = objectMapper;
        this.serviceAccountJson = serviceAccountJson;
    }

    public Map<String, String> testFolder(String folderUrl) {
        String folderId = extractFolderId(folderUrl);
        String fileName = "mindcrafti-drive-test-" + Instant.now().toString().replace(':', '-') + ".txt";
        String content = "Mindcrafti Google Drive connection test. This file can be deleted.\n";

        try {
            String boundary = "mindcrafti-" + UUID.randomUUID();
            String metadata = objectMapper.writeValueAsString(Map.of(
                    "name", fileName,
                    "parents", List.of(folderId)
            ));

            ByteArrayOutputStream body = new ByteArrayOutputStream();
            write(body, "--" + boundary + "\r\n");
            write(body, "Content-Type: application/json; charset=UTF-8\r\n\r\n");
            write(body, metadata + "\r\n");
            write(body, "--" + boundary + "\r\n");
            write(body, "Content-Type: text/plain; charset=UTF-8\r\n\r\n");
            write(body, content);
            write(body, "\r\n--" + boundary + "--\r\n");

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(UPLOAD_URL + "?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink"))
                    .header("Authorization", "Bearer " + accessToken())
                    .header("Content-Type", "multipart/related; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Google Drive returned HTTP " + response.statusCode());
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) objectMapper.readValue(response.body(), Map.class);
            return Map.of(
                    "status", "ok",
                    "fileName", String.valueOf(payload.getOrDefault("name", fileName)),
                    "fileUrl", String.valueOf(payload.getOrDefault("webViewLink", ""))
            );
        } catch (RuntimeException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("Google Drive test failed", ex);
        }
    }

    private String extractFolderId(String folderUrl) {
        if (folderUrl == null || folderUrl.isBlank()) {
            throw new IllegalArgumentException("Google Drive folder URL is required");
        }
        Matcher matcher = FOLDER_URL.matcher(folderUrl.trim());
        if (!matcher.find()) {
            throw new IllegalArgumentException("Invalid Google Drive folder URL");
        }
        return matcher.group(1);
    }

    private synchronized String accessToken() {
        long now = Instant.now().getEpochSecond();
        if (cachedAccessToken != null && now < cachedAccessTokenExpiresAt - 60) {
            return cachedAccessToken;
        }
        if (serviceAccountJson == null || serviceAccountJson.isBlank()) {
            throw new IllegalStateException("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
        }

        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> credentials = (Map<String, Object>) objectMapper.readValue(serviceAccountJson, Map.class);
            String clientEmail = required(credentials, "client_email");
            String privateKeyPem = required(credentials, "private_key");
            String tokenUri = credentials.get("token_uri") == null
                    ? "https://oauth2.googleapis.com/token"
                    : String.valueOf(credentials.get("token_uri"));

            long issuedAt = Instant.now().getEpochSecond();
            String header = base64Url(objectMapper.writeValueAsBytes(Map.of("alg", "RS256", "typ", "JWT")));
            String claims = base64Url(objectMapper.writeValueAsBytes(Map.of(
                    "iss", clientEmail,
                    "scope", DRIVE_SCOPE,
                    "aud", tokenUri,
                    "iat", issuedAt,
                    "exp", issuedAt + 3600
            )));
            String signingInput = header + "." + claims;

            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initSign(readPrivateKey(privateKeyPem));
            signature.update(signingInput.getBytes(StandardCharsets.UTF_8));
            String assertion = signingInput + "." + base64Url(signature.sign());

            String form = "grant_type=" + enc("urn:ietf:params:oauth:grant-type:jwt-bearer")
                    + "&assertion=" + enc(assertion);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(tokenUri))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(form))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Google authentication returned HTTP " + response.statusCode());
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) objectMapper.readValue(response.body(), Map.class);
            cachedAccessToken = required(payload, "access_token");
            Number expiresIn = payload.get("expires_in") instanceof Number number ? number : 3600;
            cachedAccessTokenExpiresAt = issuedAt + expiresIn.longValue();
            return cachedAccessToken;
        } catch (RuntimeException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("Google service-account authentication failed", ex);
        }
    }

    private PrivateKey readPrivateKey(String pem) throws Exception {
        String normalized = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        return KeyFactory.getInstance("RSA")
                .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(normalized)));
    }

    private String required(Map<String, Object> map, String key) {
        Object value = map.get(key);
        if (value == null || String.valueOf(value).isBlank()) {
            throw new IllegalStateException("Missing service-account field: " + key);
        }
        return String.valueOf(value);
    }

    private String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private void write(ByteArrayOutputStream output, String text) throws Exception {
        output.write(text.getBytes(StandardCharsets.UTF_8));
    }
}
