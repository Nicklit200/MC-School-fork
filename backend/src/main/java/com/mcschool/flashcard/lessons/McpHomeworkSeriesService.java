package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkPdfService;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.homeworks.dto.HomeworkResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class McpHomeworkSeriesService {

    private static final int MAX_DAYS = 31;
    private static final long MAX_PDF_BYTES = 25L * 1024L * 1024L;

    private final UserRepository userRepository;
    private final StudentGroupRepository groupRepository;
    private final StudentGroupMemberRepository groupMemberRepository;
    private final HomeworkRepository homeworkRepository;
    private final HomeworkPdfService homeworkPdfService;
    private final GoogleDriveService googleDriveService;

    public McpHomeworkSeriesService(
            UserRepository userRepository,
            StudentGroupRepository groupRepository,
            StudentGroupMemberRepository groupMemberRepository,
            HomeworkRepository homeworkRepository,
            HomeworkPdfService homeworkPdfService,
            GoogleDriveService googleDriveService) {
        this.userRepository = userRepository;
        this.groupRepository = groupRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.homeworkRepository = homeworkRepository;
        this.homeworkPdfService = homeworkPdfService;
        this.googleDriveService = googleDriveService;
    }

    public Map<String, Object> findTargets(AuthenticatedUser teacher, String query) {
        String q = normalize(query);
        List<Map<String, Object>> targets = new ArrayList<>();

        for (User student : userRepository.findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(teacher.id())) {
            if (student.getRole() != Role.STUDENT) continue;
            if (!q.isBlank() && !normalize(student.getFullName()).contains(q)) continue;
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("type", "student");
            item.put("id", student.getId().toString());
            item.put("name", student.getFullName());
            targets.add(item);
        }

        for (StudentGroup group : groupRepository.findAllByTeacherIdOrderByNameAsc(teacher.id())) {
            List<User> members = activeOwnedMembers(teacher, group.getId());
            String searchable = group.getName() + " " + members.stream().map(User::getFullName).reduce("", (a, b) -> a + " " + b);
            if (!q.isBlank() && !normalize(searchable).contains(q)) continue;

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("type", "group");
            item.put("id", group.getId().toString());
            item.put("name", group.getName());
            item.put("memberCount", members.size());
            item.put("students", members.stream().map(student -> Map.of(
                    "id", student.getId().toString(),
                    "name", student.getFullName())).toList());
            targets.add(item);
        }

        return Map.of("targets", targets);
    }

    public Map<String, Object> assignSeries(
            AuthenticatedUser teacher,
            String targetType,
            UUID targetId,
            LocalDate startDate,
            int days,
            List<String> driveFileIds,
            List<String> filenames) throws Exception {

        if (days < 1 || days > MAX_DAYS) {
            throw new IllegalArgumentException("days must be between 1 and " + MAX_DAYS);
        }
        if (driveFileIds == null || driveFileIds.isEmpty()) {
            throw new IllegalArgumentException("driveFileIds must contain at least one Google Drive PDF file ID");
        }
        List<String> files = driveFileIds.stream().map(this::clean).filter(value -> !value.isBlank()).toList();
        if (files.size() != 1 && files.size() != days) {
            throw new IllegalArgumentException("Provide either one PDF for all days or exactly one PDF per day");
        }

        List<String> names = filenames == null
                ? List.of()
                : filenames.stream().map(this::clean).filter(value -> !value.isBlank()).toList();
        if (!names.isEmpty() && names.size() != 1 && names.size() != days) {
            throw new IllegalArgumentException("filenames must be empty, contain one name, or contain one name per day");
        }

        Target target = resolveTarget(teacher, targetType, targetId);
        if (target.students().isEmpty()) throw new IllegalArgumentException("The selected group has no active students");

        Map<String, byte[]> pdfCache = new HashMap<>();
        for (String fileId : new HashSet<>(files)) {
            byte[] bytes = googleDriveService.downloadFile(fileId);
            validatePdf(bytes, fileId);
            pdfCache.put(fileId, bytes);
        }

        Map<UUID, Set<LocalDate>> existingDates = new HashMap<>();
        for (User student : target.students()) {
            Set<LocalDate> dates = new HashSet<>();
            for (Homework homework : homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(student.getId())) {
                if (homework.hasWorksheet()) dates.add(homework.getStartDate());
            }
            existingDates.put(student.getId(), dates);
        }

        List<Map<String, Object>> assignments = new ArrayList<>();
        int created = 0;
        int skipped = 0;

        for (int dayIndex = 0; dayIndex < days; dayIndex++) {
            LocalDate date = startDate.plusDays(dayIndex);
            String fileId = files.size() == 1 ? files.get(0) : files.get(dayIndex);
            String filename = chooseFilename(names, dayIndex, date);
            byte[] pdf = pdfCache.get(fileId);

            for (User student : target.students()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("date", date.toString());
                row.put("studentId", student.getId().toString());
                row.put("studentName", student.getFullName());
                row.put("driveFileId", fileId);
                row.put("filename", filename);

                if (existingDates.get(student.getId()).contains(date)) {
                    row.put("status", "skipped_existing");
                    skipped++;
                    assignments.add(row);
                    continue;
                }

                HomeworkResponse homework = homeworkPdfService.createWorksheetHomework(
                        teacher,
                        student.getId(),
                        date,
                        new ByteArrayPdfMultipartFile(filename, pdf));
                existingDates.get(student.getId()).add(date);
                row.put("status", "created");
                row.put("homeworkId", homework.id().toString());
                created++;
                assignments.add(row);
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("targetType", target.type());
        result.put("targetId", target.id().toString());
        result.put("targetName", target.name());
        result.put("startDate", startDate.toString());
        result.put("days", days);
        result.put("studentCount", target.students().size());
        result.put("created", created);
        result.put("skippedExisting", skipped);
        result.put("assignments", assignments);
        return result;
    }

    private Target resolveTarget(AuthenticatedUser teacher, String type, UUID targetId) {
        String normalizedType = normalize(type);
        if ("student".equals(normalizedType)) {
            User student = userRepository.findById(targetId)
                    .filter(user -> user.getRole() == Role.STUDENT)
                    .filter(user -> !user.isArchived())
                    .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(teacher.id()))
                    .orElseThrow(() -> new IllegalArgumentException("Student not found"));
            return new Target("student", student.getId(), student.getFullName(), List.of(student));
        }
        if ("group".equals(normalizedType)) {
            StudentGroup group = groupRepository.findByIdAndTeacherId(targetId, teacher.id())
                    .orElseThrow(() -> new IllegalArgumentException("Group not found"));
            return new Target("group", group.getId(), group.getName(), activeOwnedMembers(teacher, group.getId()));
        }
        throw new IllegalArgumentException("targetType must be 'student' or 'group'");
    }

    private List<User> activeOwnedMembers(AuthenticatedUser teacher, UUID groupId) {
        return groupMemberRepository.findAllByGroupIdOrderByStudentFullNameAsc(groupId).stream()
                .map(member -> member.getStudent())
                .filter(student -> student.getRole() == Role.STUDENT)
                .filter(student -> !student.isArchived())
                .filter(student -> student.getTeacher() != null && student.getTeacher().getId().equals(teacher.id()))
                .toList();
    }

    private String chooseFilename(List<String> names, int dayIndex, LocalDate date) {
        String value;
        if (names.isEmpty()) value = "homework-" + date + ".pdf";
        else value = names.size() == 1 ? names.get(0) : names.get(dayIndex);
        return value.toLowerCase(Locale.ROOT).endsWith(".pdf") ? value : value + ".pdf";
    }

    private void validatePdf(byte[] bytes, String fileId) {
        if (bytes == null || bytes.length == 0) throw new IllegalArgumentException("Google Drive file is empty: " + fileId);
        if (bytes.length > MAX_PDF_BYTES) throw new IllegalArgumentException("PDF is too large: " + fileId);
        try (PDDocument document = Loader.loadPDF(bytes)) {
            if (document.getNumberOfPages() == 0) throw new IllegalArgumentException("PDF has no pages: " + fileId);
        } catch (IOException e) {
            throw new IllegalArgumentException("Google Drive file is not a readable PDF: " + fileId, e);
        }
    }

    private String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private String normalize(String value) {
        return clean(value).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private record Target(String type, UUID id, String name, List<User> students) {}

    private static final class ByteArrayPdfMultipartFile implements MultipartFile {
        private final String filename;
        private final byte[] bytes;

        private ByteArrayPdfMultipartFile(String filename, byte[] bytes) {
            this.filename = filename;
            this.bytes = bytes;
        }

        @Override
        public String getName() {
            return "file";
        }

        @Override
        public String getOriginalFilename() {
            return filename;
        }

        @Override
        public String getContentType() {
            return "application/pdf";
        }

        @Override
        public boolean isEmpty() {
            return bytes.length == 0;
        }

        @Override
        public long getSize() {
            return bytes.length;
        }

        @Override
        public byte[] getBytes() {
            return bytes;
        }

        @Override
        public InputStream getInputStream() {
            return new ByteArrayInputStream(bytes);
        }

        @Override
        public void transferTo(File dest) throws IOException {
            Files.write(dest.toPath(), bytes);
        }
    }
}
