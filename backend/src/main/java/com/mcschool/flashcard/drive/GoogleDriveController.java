package com.mcschool.flashcard.drive;

import com.mcschool.flashcard.drive.dto.DriveItemResponse;
import com.mcschool.flashcard.drive.dto.DriveUploadResponse;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/drive")
@PreAuthorize("hasRole('TEACHER')")
public class GoogleDriveController {

    private final GoogleDriveService googleDriveService;

    public GoogleDriveController(GoogleDriveService googleDriveService) {
        this.googleDriveService = googleDriveService;
    }

    @GetMapping("/shared-drives")
    public List<DriveItemResponse> listSharedDrives() {
        return googleDriveService.listSharedDrives();
    }

    @GetMapping("/folders")
    public List<DriveItemResponse> listFolders(@RequestParam String driveId,
                                               @RequestParam(required = false) String parentId) {
        return googleDriveService.listFolders(driveId, parentId);
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public DriveUploadResponse upload(@RequestParam String folderId,
                                      @RequestParam("file") MultipartFile file) {
        return googleDriveService.upload(folderId, file);
    }
}
