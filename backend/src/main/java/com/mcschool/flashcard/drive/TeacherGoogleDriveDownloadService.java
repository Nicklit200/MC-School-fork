package com.mcschool.flashcard.drive;

import com.mcschool.flashcard.lessons.GoogleCalendarOAuthService;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Reads Drive PDFs for lesson preparation.
 *
 * The school service account is tried first. If it cannot see the file, the
 * selected teacher's Google OAuth token is used. ChatGPT/connector results may
 * provide a Drive URL instead of a raw file id, so URLs are normalized. If an
 * id still resolves to 404, we can fall back to the supplied filename and find
 * the accessible PDF in the teacher's Drive.
 */
@Service
public class TeacherGoogleDriveDownloadService {

    private static final String DRIVE_API = "https://www.googleapis.com/drive/v3";

    private final GoogleDriveService serviceAccountDrive;
    private final GoogleCalendarOAuthService googleOAuthService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public TeacherGoogleDriveDownloadService(
            GoogleDriveService serviceAccountDrive,
            GoogleCalendarOAuthService googleOAuthService,
            ObjectMapper objectMapper) {
        this.serviceAccountDrive = serviceAccountDrive;
        this.googleOAuthService = googleOAuthService;
        this.objectMapper = objectMapper;
    }

    public byte[] downloadForTeacher(UUID teacherId, String fileId) {
        return downloadForTeacher(teacherId, fileId, null);
    }

    public byte[] downloadForTeacher(UUID teacherId, String fileId, String fallbackFilename) {
        if (teacherId == null) throw new IllegalArgumentException("teacherId is required");
        if (fileId == null || fileId.isBlank()) throw new IllegalArgumentException("File id is required");

        String normalizedId = normalizeDriveFileId(fileId);
        RuntimeException serviceAccountFailure;
        try {
            return serviceAccountDrive.downloadFile(normalizedId);
        } catch (RuntimeException ex) {
            serviceAccountFailure = ex;
        }

        String teacherAccessToken;
        try {
            teacherAccessToken = googleOAuthService.accessTokenForTeacher(teacherId);
        } catch (RuntimeException ex) {
            throw new IllegalStateException(
                    "Mindcrafti could not read this Google Drive file with the school account, and the teacher Google connection could not be refreshed. "
                            + "Reconnect this teacher's Google account in Mindcrafti or upload the PDF directly.",
                    ex);
        }

        if (teacherAccessToken == null || teacherAccessToken.isBlank()) {
            throw new IllegalStateException(
                    "Mindcrafti could not read this Google Drive file with the school account. The selected teacher has no Google connection. "
                            + "Connect the teacher's Google account or upload the PDF directly.",
                    serviceAccountFailure);
        }

        DownloadAttempt direct = downloadWithToken(teacherAccessToken, normalizedId);
        if (direct.status() >= 200 && direct.status() < 300) return direct.body();
        if (direct.status() == 401 || direct.status() == 403) {
            throw new IllegalStateException(
                    "The teacher Google connection does not include usable Google Drive read access. "
                            + "Reconnect this teacher's Google account in Mindcrafti once, then try again.");
        }

        // Connector-generated IDs can occasionally be URLs/opaque references.
        // The filename is much more stable, so on a 404 try locating that PDF
        // in the selected teacher's accessible Drive and then download its real id.
        if (direct.status() == 404 && fallbackFilename != null && !fallbackFilename.isBlank()) {
            String foundId = findPdfIdByName(teacherAccessToken, fallbackFilename.trim());
            if (foundId != null) {
                DownloadAttempt byName = downloadWithToken(teacherAccessToken, foundId);
                if (byName.status() >= 200 && byName.status() < 300) return byName.body();
                if (byName.status() == 401 || byName.status() == 403) {
                    throw new IllegalStateException("Google Drive found the PDF but did not allow Mindcrafti to download it.");
                }
            }
        }

        if (direct.status() == 404) {
            String suffix = fallbackFilename == null || fallbackFilename.isBlank()
                    ? ""
                    : " Mindcrafti also searched the selected teacher's Drive for '" + fallbackFilename.trim() + "' and did not find an accessible PDF.";
            throw new IllegalStateException(
                    "Google Drive file is not visible to either the Mindcrafti school account or the selected teacher." + suffix
                            + " Use the real Google Drive file id/URL, share the PDF with the teacher, or upload the PDF directly.");
        }
        throw new IllegalStateException("Google Drive returned HTTP " + direct.status());
    }

    private DownloadAttempt downloadWithToken(String accessToken, String fileId) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(DRIVE_API + "/files/" + enc(fileId) + "?alt=media&supportsAllDrives=true"))
                    .header("Authorization", "Bearer " + accessToken)
                    .GET()
                    .build();
            HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
            return new DownloadAttempt(response.statusCode(), response.body());
        } catch (Exception ex) {
            throw new IllegalStateException("Google Drive download failed", ex);
        }
    }

    private String findPdfIdByName(String accessToken, String filename) {
        try {
            String cleanName = filename;
            if (!cleanName.toLowerCase().endsWith(".pdf")) cleanName += ".pdf";
            String q = "name='" + cleanName.replace("'", "\\'") + "' and mimeType='application/pdf' and trashed=false";
            String url = DRIVE_API + "/files"
                    + "?q=" + enc(q)
                    + "&spaces=drive"
                    + "&includeItemsFromAllDrives=true"
                    + "&supportsAllDrives=true"
                    + "&pageSize=20"
                    + "&orderBy=modifiedTime%20desc"
                    + "&fields=files(id,name,mimeType,modifiedTime)";
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Bearer " + accessToken)
                    .GET()
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 401 || response.statusCode() == 403) {
                throw new IllegalStateException("The teacher Google connection does not include usable Google Drive read access.");
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) return null;

            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) objectMapper.readValue(response.body(), Map.class);
            Object rawFiles = payload.get("files");
            if (!(rawFiles instanceof List<?> files)) return null;
            for (Object raw : files) {
                if (raw instanceof Map<?, ?> file) {
                    Object id = file.get("id");
                    if (id != null && !String.valueOf(id).isBlank()) return String.valueOf(id);
                }
            }
            return null;
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("Google Drive filename lookup failed", ex);
        }
    }

    private String normalizeDriveFileId(String value) {
        String raw = value == null ? "" : value.trim();
        int d = raw.indexOf("/d/");
        if (d >= 0) {
            String remainder = raw.substring(d + 3);
            int slash = remainder.indexOf('/');
            int question = remainder.indexOf('?');
            int end = remainder.length();
            if (slash >= 0) end = Math.min(end, slash);
            if (question >= 0) end = Math.min(end, question);
            if (end > 0) return remainder.substring(0, end);
        }
        int idParam = raw.indexOf("id=");
        if (idParam >= 0) {
            String remainder = raw.substring(idParam + 3);
            int amp = remainder.indexOf('&');
            return amp >= 0 ? remainder.substring(0, amp) : remainder;
        }
        return raw;
    }

    private String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private record DownloadAttempt(int status, byte[] body) {}
}
