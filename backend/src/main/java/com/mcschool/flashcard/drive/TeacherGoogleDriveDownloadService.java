package com.mcschool.flashcard.drive;

import com.mcschool.flashcard.lessons.GoogleCalendarOAuthService;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Reads a Drive file for lesson preparation.
 *
 * First we keep the existing school service-account path because files inside
 * the school Shared Drive already work there. If that account cannot see the
 * file, we retry with the selected teacher's Google OAuth token. This lets an
 * ADMIN prepare any teacher's lesson while Google still enforces that the
 * target teacher has access to the source file.
 */
@Service
public class TeacherGoogleDriveDownloadService {

    private static final String DRIVE_API = "https://www.googleapis.com/drive/v3";

    private final GoogleDriveService serviceAccountDrive;
    private final GoogleCalendarOAuthService googleOAuthService;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public TeacherGoogleDriveDownloadService(
            GoogleDriveService serviceAccountDrive,
            GoogleCalendarOAuthService googleOAuthService) {
        this.serviceAccountDrive = serviceAccountDrive;
        this.googleOAuthService = googleOAuthService;
    }

    public byte[] downloadForTeacher(UUID teacherId, String fileId) {
        if (teacherId == null) throw new IllegalArgumentException("teacherId is required");
        if (fileId == null || fileId.isBlank()) throw new IllegalArgumentException("File id is required");

        RuntimeException serviceAccountFailure;
        try {
            return serviceAccountDrive.downloadFile(fileId);
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

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(DRIVE_API + "/files/" + enc(fileId) + "?alt=media&supportsAllDrives=true"))
                    .header("Authorization", "Bearer " + teacherAccessToken)
                    .GET()
                    .build();
            HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                return response.body();
            }
            if (response.statusCode() == 401 || response.statusCode() == 403) {
                throw new IllegalStateException(
                        "The teacher Google connection does not yet include Google Drive read access. "
                                + "Reconnect this teacher's Google account in Mindcrafti once, then try again.");
            }
            if (response.statusCode() == 404) {
                throw new IllegalStateException(
                        "Google Drive file is not visible to either the Mindcrafti school account or the selected teacher. "
                                + "Share the source file with the teacher, put it in the school Shared Drive, or upload the PDF directly.");
            }
            throw new IllegalStateException("Google Drive returned HTTP " + response.statusCode());
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("Google Drive download failed", ex);
        }
    }

    private String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
