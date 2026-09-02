package com.mcschool.flashcard.drive;

import com.mcschool.flashcard.drive.dto.DriveItemResponse;
import com.mcschool.flashcard.drive.dto.DriveUploadResponse;
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
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

@Service
public class GoogleDriveService {

    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
    private static final String DRIVE_API = "https://www.googleapis.com/drive/v3";
    private static final String DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final String serviceAccountJson;

    private volatile String cachedAccessToken;
    private volatile long accessTokenExpiresAtEpochSecond;

    public GoogleDriveService(ObjectMapper objectMapper,
                              @Value("${app.google-drive.service-account-json:}") String serviceAccountJson) {
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newHttpClient();
        this.serviceAccountJson = serviceAccountJson;
    }

    public List<DriveItemResponse> listSharedDrives() {
        Map<String, Object> payload = getJson(DRIVE_API + "/drives?pageSize=100&fields=drives(id,name)");
        return toItems(payload.get("drives"));
    }

    public List<DriveItemResponse> listFolders(String driveId, String parentId) {
        String effectiveParent = parentId == null || parentId.isBlank() ? driveId : parentId;
        String q = "'" + effectiveParent.replace("'", "\\'")
                + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";

        String url = DRIVE_API + "/files"
                + "?corpora=drive"
                + "&driveId=" + enc(driveId)
                + "&includeItemsFromAllDrives=true"
                + "&supportsAllDrives=true"
                + "&pageSize=1000"
                + "&orderBy=name"
                + "&q=" + enc(q)
                + "&fields=files(id,name)";

        Map<String, Object> payload = getJson(url);
        return toItems(payload.get("files"));
    }

    public DriveUploadResponse upload(String folderId, MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("File is required");
        }
        try {
            String mimeType = file.getContentType() == null || file.getContentType().isBlank()
                    ? "application/octet-stream"
                    : file.getContentType();
            String fileName = file.getOriginalFilename() == null || file.getOriginalFilename().isBlank()
                    ? "upload"
                    : file.getOriginalFilename();
            return uploadBytes(folderId, fileName, mimeType, file.getBytes());
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException("Google Drive upload failed", ex);
        }
    }

    public DriveUploadResponse uploadBytes(String folderId, String fileName, String mimeType, byte[] bytes) {
        if (folderId == null || folderId.isBlank()) {
            throw new IllegalArgumentException("Folder id is required");
        }
        if (fileName == null || fileName.isBlank()) {
            throw new IllegalArgumentException("File name is required");
        }
        try {
            String boundary = "mindcrafti-" + UUID.randomUUID();
            String metadata = objectMapper.writeValueAsString(Map.of(
                    "name", fileName,
                    "parents", List.of(folderId)
            ));

            ByteArrayOutputStream body = new ByteArrayOutputStream();
            writeUtf8(body, "--" + boundary + "\r\n");
            writeUtf8(body, "Content-Type: application/json; charset=UTF-8\r\n\r\n");
            writeUtf8(body, metadata + "\r\n");
            writeUtf8(body, "--" + boundary + "\r\n");
            writeUtf8(body, "Content-Type: " + (mimeType == null || mimeType.isBlank() ? "application/octet-stream" : mimeType) + "\r\n\r\n");
            body.write(bytes == null ? new byte[0] : bytes);
            writeUtf8(body, "\r\n--" + boundary + "--\r\n");

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(DRIVE_UPLOAD_API
                            + "/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink"))
                    .header("Authorization", "Bearer " + accessToken())
                    .header("Content-Type", "multipart/related; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                    .build();

            HttpResponse<String> response = send(request);
            Map<String, Object> payload = asMap(objectMapper.readValue(response.body(), Map.class));
            return new DriveUploadResponse(
                    stringValue(payload.get("id")),
                    stringValue(payload.get("name")),
                    stringValue(payload.get("webViewLink"))
            );
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException("Google Drive upload failed", ex);
        }
    }

    private Map<String, Object> getJson(String url) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Bearer " + accessToken())
                    .GET()
                    .build();
            HttpResponse<String> response = send(request);
            return asMap(objectMapper.readValue(response.body(), Map.class));
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException("Google Drive request failed", ex);
        }
    }

    private synchronized String accessToken() {
        long now = Instant.now().getEpochSecond();
        if (cachedAccessToken != null && now < accessTokenExpiresAtEpochSecond - 60) {
            return cachedAccessToken;
        }
        if (serviceAccountJson == null || serviceAccountJson.isBlank()) {
            throw new IllegalStateException("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
        }

        try {
            Map<String, Object> credentials = asMap(objectMapper.readValue(serviceAccountJson, Map.class));
            String clientEmail = required(credentials, "client_email");
            String privateKeyPem = required(credentials, "private_key");
            String tokenUri = credentials.get("token_uri") == null
                    ? "https://oauth2.googleapis.com/token"
                    : stringValue(credentials.get("token_uri"));

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

            HttpResponse<String> response = send(request);
            Map<String, Object> payload = asMap(objectMapper.readValue(response.body(), Map.class));
            cachedAccessToken = required(payload, "access_token");
            Number expiresIn = payload.get("expires_in") instanceof Number number ? number : 3600;
            accessTokenExpiresAtEpochSecond = issuedAt + expiresIn.longValue();
            return cachedAccessToken;
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException("Google service-account authentication failed", ex);
        }
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("Google API returned HTTP " + response.statusCode());
        }
        return response;
    }

    private PrivateKey readPrivateKey(String pem) throws Exception {
        String normalized = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(normalized);
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    private List<DriveItemResponse> toItems(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<DriveItemResponse> result = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                result.add(new DriveItemResponse(
                        stringValue(map.get("id")),
                        stringValue(map.get("name"))
                ));
            }
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(Object value) {
        return (Map<String, Object>) value;
    }

    private String required(Map<String, Object> map, String key) {
        String value = stringValue(map.get(key));
        if (value.isBlank()) {
            throw new IllegalStateException("Missing service-account field: " + key);
        }
        return value;
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private void writeUtf8(ByteArrayOutputStream output, String text) throws Exception {
        output.write(text.getBytes(StandardCharsets.UTF_8));
    }
}
