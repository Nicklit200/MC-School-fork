package com.mcschool.flashcard.drive;

import com.mcschool.flashcard.drive.dto.DriveItemResponse;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Creates and resolves the Google Drive layout used by Mindcrafti.
 *
 * <p>The service is intentionally idempotent: existing folders are reused even when
 * their names contain extra spaces (for example the legacy "Карточки " folders) or
 * a group name is written as "Группа1" instead of "Группа 1".</p>
 */
@Service
public class GoogleDriveStructureService {

    private static final List<String> INDIVIDUAL_FOLDERS = List.of(
            "Чистые документы",
            "Домашнее задание",
            "Таблица",
            "Транскрипции",
            "Карточки",
            "Сделанная домашка",
            "Заполненные после урока"
    );

    // Keep the established group layout exactly as it exists in the school Drive.
    private static final List<String> GROUP_FOLDERS = List.of(
            "Домашнаяя работа",
            "Таблица",
            "Чистые листы",
            "Заполненные после урока",
            "Транскрипции",
            "Карточки",
            "Сделанная домашка"
    );

    // Older student folders use these names. Reuse them instead of creating a
    // second folder that means the same thing.
    private static final Map<String, List<String>> LEGACY_FOLDER_ALIASES = Map.of(
            "Чистые документы", List.of("Чистые документы", "Чистые листы"),
            "Домашнее задание", List.of("Домашнее задание", "Домашние задания"),
            "Заполненные после урока", List.of("Заполненные после урока", "Пройденные листы")
    );

    private final GoogleDriveService googleDriveService;
    private final UserRepository userRepository;

    // Kept for tests/direct construction. Spring uses the annotated constructor.
    public GoogleDriveStructureService(GoogleDriveService googleDriveService) {
        this(googleDriveService, null);
    }

    @Autowired
    public GoogleDriveStructureService(GoogleDriveService googleDriveService,
                                       UserRepository userRepository) {
        this.googleDriveService = googleDriveService;
        this.userRepository = userRepository;
    }

    public void provisionIndividualStudent(User teacher, User student) {
        FolderContext teacherRoot = teacherRoot(teacher);
        DriveItemResponse studentRoot = ensureNamedEntityFolder(
                teacherRoot.driveId(), teacherRoot.folderId(), student.getFullName());
        Map<String, DriveItemResponse> folders = ensureFolders(
                teacherRoot.driveId(), studentRoot.id(), INDIVIDUAL_FOLDERS);

        student.changeGoogleDriveFolderUrl(folders.get("Карточки").id());
        student.changeGoogleDriveHomeworkFolderId(folders.get("Сделанная домашка").id());
        student.changeGoogleDriveTranscriptFolderId(folders.get("Транскрипции").id());
    }

    public void provisionGroup(User teacher, StudentGroup group) {
        GroupFolders folders = ensureGroup(teacher, group.getName());
        group.updateTranscriptFolder(folders.folders().get("Транскрипции").id());
    }

    public void provisionGroupMember(User teacher, StudentGroup group, User student) {
        GroupFolders groupFolders = ensureGroup(teacher, group.getName());
        group.updateTranscriptFolder(groupFolders.folders().get("Транскрипции").id());

        DriveItemResponse cardsFolder = ensureNamedEntityFolder(
                groupFolders.driveId(), groupFolders.folders().get("Карточки").id(), student.getFullName());
        DriveItemResponse submittedHomeworkFolder = ensureNamedEntityFolder(
                groupFolders.driveId(), groupFolders.folders().get("Сделанная домашка").id(), student.getFullName());

        // These are the destinations already consumed by StudyService and HomeworkDriveExportService.
        student.changeGoogleDriveFolderUrl(cardsFolder.id());
        student.changeGoogleDriveHomeworkFolderId(submittedHomeworkFolder.id());
    }

    /**
     * Returns semantic destinations so MCP/ChatGPT can save generated files without
     * the user ever writing or knowing a Google Drive path.
     */
    public Map<String, String> resolveStudentDocumentFolders(User teacher, User student) {
        FolderContext teacherRoot = teacherRoot(teacher);
        DriveItemResponse studentRoot = ensureNamedEntityFolder(
                teacherRoot.driveId(), teacherRoot.folderId(), student.getFullName());
        Map<String, DriveItemResponse> folders = ensureFolders(
                teacherRoot.driveId(), studentRoot.id(), INDIVIDUAL_FOLDERS);
        return semanticDestinations(
                folders.get("Чистые документы"),
                folders.get("Домашнее задание"),
                folders.get("Таблица"),
                folders.get("Транскрипции"),
                folders.get("Карточки"),
                folders.get("Сделанная домашка"),
                folders.get("Заполненные после урока"));
    }

    /** Same semantic keys as the individual map, backed by the established group layout. */
    public Map<String, String> resolveGroupDocumentFolders(User teacher, StudentGroup group) {
        GroupFolders groupFolders = ensureGroup(teacher, group.getName());
        Map<String, DriveItemResponse> folders = groupFolders.folders();
        return semanticDestinations(
                folders.get("Чистые листы"),
                folders.get("Домашнаяя работа"),
                folders.get("Таблица"),
                folders.get("Транскрипции"),
                folders.get("Карточки"),
                folders.get("Сделанная домашка"),
                folders.get("Заполненные после урока"));
    }

    public String resolveStudentDocumentFolder(User teacher, User student, String documentType) {
        FolderContext teacherRoot = teacherRoot(teacher);
        DriveItemResponse studentRoot = ensureNamedEntityFolder(
                teacherRoot.driveId(), teacherRoot.folderId(), student.getFullName());
        Map<String, DriveItemResponse> folders = ensureFolders(
                teacherRoot.driveId(), studentRoot.id(), INDIVIDUAL_FOLDERS);
        return folders.get(individualFolderName(documentType)).id();
    }

    public String resolveGroupDocumentFolder(User teacher, StudentGroup group, String documentType) {
        GroupFolders groupFolders = ensureGroup(teacher, group.getName());
        return groupFolders.folders().get(groupFolderName(documentType)).id();
    }

    private Map<String, String> semanticDestinations(DriveItemResponse clean,
                                                     DriveItemResponse homework,
                                                     DriveItemResponse table,
                                                     DriveItemResponse transcript,
                                                     DriveItemResponse cards,
                                                     DriveItemResponse submittedHomework,
                                                     DriveItemResponse lessonCompleted) {
        Map<String, String> result = new LinkedHashMap<>();
        result.put("clean", clean.id());
        result.put("homework", homework.id());
        result.put("table", table.id());
        result.put("transcript", transcript.id());
        result.put("cards", cards.id());
        result.put("submitted_homework", submittedHomework.id());
        result.put("lesson_completed", lessonCompleted.id());
        return result;
    }

    private GroupFolders ensureGroup(User teacher, String groupName) {
        FolderContext teacherRoot = teacherRoot(teacher);
        DriveItemResponse groupRoot = ensureFolder(
                teacherRoot.driveId(), teacherRoot.folderId(), groupName);
        Map<String, DriveItemResponse> folders = ensureFolders(
                teacherRoot.driveId(), groupRoot.id(), GROUP_FOLDERS);
        return new GroupFolders(teacherRoot.driveId(), groupRoot.id(), folders);
    }

    private FolderContext teacherRoot(User teacher) {
        if (teacher == null || teacher.getFullName() == null || teacher.getFullName().isBlank()) {
            throw new IllegalArgumentException("Teacher is required for Google Drive provisioning");
        }

        List<DriveItemResponse> drives = googleDriveService.listSharedDrives();
        if (drives.isEmpty()) {
            throw new IllegalStateException("No shared Google Drive is available to the Mindcrafti service account");
        }

        // Existing student links are the strongest source of truth. They keep working
        // even when the teacher's account name and Drive folder name differ (e.g. Nick/Nikolay).
        FolderContext linkedRoot = teacherRootFromExistingStudentLinks(teacher, drives);
        if (linkedRoot != null) {
            return linkedRoot;
        }

        for (DriveItemResponse drive : drives) {
            DriveItemResponse folder = findFolder(
                    googleDriveService.listFolders(drive.id(), null), teacher.getFullName());
            if (folder != null) {
                return new FolderContext(drive.id(), folder.id());
            }
        }

        // Only a genuinely new teacher with no existing linked Drive data gets a new root.
        if (drives.size() == 1) {
            DriveItemResponse created = googleDriveService.createFolder(drives.get(0).id(), teacher.getFullName().trim());
            return new FolderContext(drives.get(0).id(), created.id());
        }

        throw new IllegalStateException("Teacher Google Drive folder was not found and several shared drives are available");
    }

    private FolderContext teacherRootFromExistingStudentLinks(User teacher, List<DriveItemResponse> drives) {
        if (userRepository == null || teacher.getId() == null) {
            return null;
        }
        for (User student : userRepository.findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(teacher.getId())) {
            FolderContext root = rootFromKnownFolder(drives, student.getGoogleDriveFolderUrl());
            if (root != null) return root;
            root = rootFromKnownFolder(drives, student.getGoogleDriveHomeworkFolderId());
            if (root != null) return root;
            root = rootFromKnownFolder(drives, student.getGoogleDriveTranscriptFolderId());
            if (root != null) return root;
        }
        return null;
    }

    private FolderContext rootFromKnownFolder(List<DriveItemResponse> drives, String linkedFolderId) {
        if (linkedFolderId == null || linkedFolderId.isBlank()) {
            return null;
        }
        Set<String> driveIds = new HashSet<>();
        for (DriveItemResponse drive : drives) driveIds.add(drive.id());

        String current = linkedFolderId.trim();
        Set<String> visited = new HashSet<>();
        for (int depth = 0; depth < 12 && visited.add(current); depth++) {
            try {
                List<String> parents = googleDriveService.getParentIds(current);
                if (parents.isEmpty()) return null;
                String parent = parents.get(0);
                if (driveIds.contains(parent)) {
                    return new FolderContext(parent, current);
                }
                current = parent;
            } catch (RuntimeException ignored) {
                return null;
            }
        }
        return null;
    }

    private Map<String, DriveItemResponse> ensureFolders(String driveId,
                                                          String parentId,
                                                          List<String> requiredNames) {
        List<DriveItemResponse> existing = googleDriveService.listFolders(driveId, parentId);
        Map<String, DriveItemResponse> byKey = new LinkedHashMap<>();
        for (DriveItemResponse item : existing) {
            byKey.putIfAbsent(nameKey(item.name()), item);
        }

        Map<String, DriveItemResponse> result = new LinkedHashMap<>();
        for (String requiredName : requiredNames) {
            DriveItemResponse item = findByAliases(byKey, requiredName);
            if (item == null) {
                item = googleDriveService.createFolder(parentId, requiredName);
                byKey.put(nameKey(requiredName), item);
            }
            result.put(requiredName, item);
        }
        return result;
    }

    private DriveItemResponse findByAliases(Map<String, DriveItemResponse> byKey, String requiredName) {
        for (String alias : LEGACY_FOLDER_ALIASES.getOrDefault(requiredName, List.of(requiredName))) {
            DriveItemResponse match = byKey.get(nameKey(alias));
            if (match != null) return match;
        }
        return null;
    }

    private DriveItemResponse ensureFolder(String driveId, String parentId, String name) {
        DriveItemResponse existing = findFolder(googleDriveService.listFolders(driveId, parentId), name);
        return existing == null ? googleDriveService.createFolder(parentId, name.trim()) : existing;
    }

    private DriveItemResponse ensureNamedEntityFolder(String driveId, String parentId, String name) {
        List<DriveItemResponse> folders = googleDriveService.listFolders(driveId, parentId);
        DriveItemResponse exact = findFolder(folders, name);
        if (exact != null) return exact;

        DriveItemResponse near = findUniqueOneEditMatch(folders, name);
        return near == null ? googleDriveService.createFolder(parentId, name.trim()) : near;
    }

    private DriveItemResponse findFolder(List<DriveItemResponse> folders, String expectedName) {
        String expectedKey = nameKey(expectedName);
        return folders.stream()
                .filter(folder -> nameKey(folder.name()).equals(expectedKey))
                .findFirst()
                .orElse(null);
    }

    /**
     * Reuses a single legacy typo such as Меллисса/Мелисса, but refuses an
     * ambiguous fuzzy match if two sibling folders are equally close.
     */
    private DriveItemResponse findUniqueOneEditMatch(List<DriveItemResponse> folders, String expectedName) {
        String expectedKey = nameKey(expectedName);
        if (expectedKey.length() < 4) return null;

        DriveItemResponse match = null;
        for (DriveItemResponse folder : folders) {
            String candidateKey = nameKey(folder.name());
            if (!isAtMostOneEditAway(expectedKey, candidateKey)) continue;
            if (match != null) return null;
            match = folder;
        }
        return match;
    }

    private boolean isAtMostOneEditAway(String first, String second) {
        if (first.equals(second)) return true;
        if (Math.abs(first.length() - second.length()) > 1) return false;

        if (first.length() == second.length()) {
            int mismatches = 0;
            for (int i = 0; i < first.length(); i++) {
                if (first.charAt(i) != second.charAt(i) && ++mismatches > 1) return false;
            }
            return true;
        }

        String shorter = first.length() < second.length() ? first : second;
        String longer = first.length() < second.length() ? second : first;
        int shortIndex = 0;
        int longIndex = 0;
        boolean skipped = false;
        while (shortIndex < shorter.length() && longIndex < longer.length()) {
            if (shorter.charAt(shortIndex) == longer.charAt(longIndex)) {
                shortIndex++;
                longIndex++;
                continue;
            }
            if (skipped) return false;
            skipped = true;
            longIndex++;
        }
        return true;
    }

    private String individualFolderName(String documentType) {
        return switch (normalizeDocumentType(documentType)) {
            case "clean", "clean_document", "clean_documents", "worksheet", "workbook" -> "Чистые документы";
            case "homework", "homework_assignment", "assignment" -> "Домашнее задание";
            case "table" -> "Таблица";
            case "transcript", "transcription" -> "Транскрипции";
            case "cards" -> "Карточки";
            case "submitted_homework" -> "Сделанная домашка";
            case "lesson_completed", "filled_after_lesson", "completed_lesson" -> "Заполненные после урока";
            default -> throw new IllegalArgumentException("Unsupported documentType: " + documentType);
        };
    }

    private String groupFolderName(String documentType) {
        return switch (normalizeDocumentType(documentType)) {
            case "clean", "clean_document", "clean_documents", "worksheet", "workbook" -> "Чистые листы";
            case "homework", "homework_assignment", "assignment" -> "Домашнаяя работа";
            case "table" -> "Таблица";
            case "transcript", "transcription" -> "Транскрипции";
            case "cards" -> "Карточки";
            case "submitted_homework" -> "Сделанная домашка";
            case "lesson_completed", "filled_after_lesson", "completed_lesson" -> "Заполненные после урока";
            default -> throw new IllegalArgumentException("Unsupported documentType: " + documentType);
        };
    }

    private String normalizeDocumentType(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("documentType is required");
        }
        return value.trim().toLowerCase(Locale.ROOT).replace('-', '_').replace(' ', '_');
    }

    private String nameKey(String value) {
        if (value == null) return "";
        return value.trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^\\p{L}\\p{N}]+", "");
    }

    private record FolderContext(String driveId, String folderId) {}
    private record GroupFolders(String driveId,
                                String rootFolderId,
                                Map<String, DriveItemResponse> folders) {}
}
