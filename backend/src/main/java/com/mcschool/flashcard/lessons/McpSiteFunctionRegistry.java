package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.cards.CardController;
import com.mcschool.flashcard.drive.GoogleDriveController;
import com.mcschool.flashcard.groups.StudentGroupController;
import com.mcschool.flashcard.homeworks.HomeworkController;
import com.mcschool.flashcard.learningtime.LearningTimeController;
import com.mcschool.flashcard.lessonboard.LessonBoardController;
import com.mcschool.flashcard.liveclasses.OnlineClassController;
import com.mcschool.flashcard.liveclasses.OnlineClassDocumentController;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanController;
import com.mcschool.flashcard.notebookcamera.NotebookCameraController;
import com.mcschool.flashcard.parents.ParentController;
import com.mcschool.flashcard.parents.ParentTeacherMessageController;
import com.mcschool.flashcard.parents.TeacherParentController;
import com.mcschool.flashcard.settings.SchoolBrandGuideController;
import com.mcschool.flashcard.settings.SchoolPromptSettingsController;
import com.mcschool.flashcard.settings.StoryTemplateMasterController;
import com.mcschool.flashcard.settings.StoryStudioProjectController;
import com.mcschool.flashcard.skills.SkillBoardController;
import com.mcschool.flashcard.skills.SkillMasteryController;
import com.mcschool.flashcard.students.StudentChatGptProjectController;
import com.mcschool.flashcard.students.StudentController;
import com.mcschool.flashcard.students.StudentStatusController;
import com.mcschool.flashcard.teachers.TeacherController;
import com.mcschool.flashcard.trialleads.SiteVisitController;
import com.mcschool.flashcard.trialleads.TrialLeadController;
import com.mcschool.flashcard.users.AdminAccountController;
import com.mcschool.flashcard.users.UserController;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;

/** Explicit, reviewed method allowlist. New HTTP endpoints never become MCP tools automatically. */
final class McpSiteFunctionRegistry {
    enum Scope { ADMIN, TEACHER, CALLER }

    record Function(String id, String domain, Class<?> controller, Method method, Scope scope,
                    boolean readOnly, boolean destructive, boolean classroomGate, boolean externalEffect, String preferredTool) {}

    private static final Set<String> DESTRUCTIVE = Set.of("deleteStudent", "deleteTeacher", "deleteCard",
            "deleteHomework", "deleteVisit", "delete", "end", "cancel", "removeParticipant", "revoke",
            "deleteMessage", "deactivate", "saveAnnotationSnapshot");
    // These may affect Drive, Push, AI, LiveKit, transcription/recording or object storage outside the DB.
    private static final Set<String> EXTERNAL_EFFECTS = Set.of(
            "students.createStudent", "groups.create", "groups.addMembers", "groups.createCard", "groups.importCards", "groups.createPdfHomework",
            "cards.createCardInHomework", "cards.importCardsIntoHomework", "homework.createPdfHomework", "homework.uploadWorksheet",
            "lesson_preparation.uploadAnswers", "lesson_preparation.archiveToDrive", "lesson_preparation.assignHomeworkSeries",
            "ai_pilot.prepare", "ai_pilot.analyze", "meet_events.ensureSubscription", "drive.upload", "notebook_camera.revoke",
            "online_classes.materializeFromCalendar", "online_classes.openLobby", "online_classes.start", "online_classes.end", "online_classes.cancel",
            "online_classes.mediaDiagnostics", "online_classes.mute", "online_classes.requestUnmute", "online_classes.removeParticipant",
            "online_classes.updatePermissions", "online_classes.muteAll", "online_classes.setStudentScreenShare",
            "online_classes.startRecording", "online_classes.stopRecording", "online_classes.startTranscription", "online_classes.stopTranscription",
            "online_classes.saveAnnotationSnapshot");
    private static final List<Function> FUNCTIONS = build();

    private McpSiteFunctionRegistry() {}

    static List<Function> functions() { return FUNCTIONS; }

    private static List<Function> build() {
        List<Function> functions = new ArrayList<>();
        add(functions, "students", StudentController.class, Scope.TEACHER,
                "createStudent listStudents getStudent updateStudentName updateLearningProfile updateDriveFolder updateHomeworkDriveFolder updateTranscriptDriveFolder reviewHistory deleteStudent");
        add(functions, "students", StudentStatusController.class, Scope.TEACHER, "deactivate reactivate");
        add(functions, "students", StudentChatGptProjectController.class, Scope.TEACHER, "updateChatGptProject");
        add(functions, "groups", StudentGroupController.class, Scope.TEACHER,
                "list get create addMembers updateTranscriptFolder createCard importCards createPdfHomework");
        add(functions, "cards", CardController.class, Scope.TEACHER,
                "createCardInHomework listCards listCardsForHomework summary previewImport importCardsIntoHomework updateCard deleteCard");
        add(functions, "homework", HomeworkController.class, Scope.TEACHER,
                "createHomework createPdfHomework listForTeacher deleteHomework uploadWorksheet downloadWorksheet teacherWorksheetPage submissionPageCount teacherSubmissionPage downloadSubmission");
        add(functions, "monthly_plans", MonthlyPlanController.class, Scope.TEACHER,
                "get save uploadDocument downloadDocument");
        add(functions, "lessons", GroupLessonController.class, Scope.TEACHER, "listGroupLessons");
        add(functions, "lesson_preparation", LessonPreparationController.class, Scope.TEACHER,
                "get update uploadWorkbook appendWorkbook workbook uploadAnswers uploadTranscript transcript answers archiveToDrive assignHomeworkSeries");
        add(functions, "completed_documents", CompletedLessonDocumentController.class, Scope.TEACHER,
                "list save uploadManual download");
        add(functions, "lesson_history", StudentLessonHistoryController.class, Scope.TEACHER,
                "list detail completedDocuments completedDocument document");
        // The private pilot checks the actual owner's identity; an admin may not delegate into that privilege.
        add(functions, "ai_pilot", AiLessonPilotController.class, Scope.CALLER,
                "status settings updateSettings prepare analyze");
        add(functions, "meet_events", GoogleMeetEventsController.class, Scope.TEACHER, "status ensureSubscription");
        add(functions, "online_classes", OnlineClassController.class, Scope.TEACHER,
                "materializeFromCalendar findByEvent createTestClass listUpcoming get openLobby start end cancel mediaDiagnostics listJoinRequests approve reject approveAll participants attendance mute requestUnmute removeParticipant updatePermissions muteAll setStudentScreenShare setWaitingRoom sendMessage messageHistory editMessage deleteMessage startRecording stopRecording listRecordings startTranscription stopTranscription transcript transcriptText transcriptVtt openAnnotationDocument listAnnotationDocuments appendAnnotation replayAnnotations saveAnnotationSnapshot");
        add(functions, "class_documents", OnlineClassDocumentController.class, Scope.TEACHER,
                "homework documentVersion document");
        add(functions, "lesson_board", LessonBoardController.class, Scope.TEACHER, "read start append");
        add(functions, "notebook_camera", NotebookCameraController.class, Scope.TEACHER, "list revoke");
        add(functions, "parents", ParentController.class, Scope.TEACHER, "managedParents");
        add(functions, "parent_accounts", TeacherParentController.class, Scope.TEACHER, "list");
        add(functions, "parent_messages", ParentTeacherMessageController.class, Scope.CALLER, "list send image");
        add(functions, "teachers", TeacherController.class, Scope.ADMIN,
                "listTeachers deleteTeacher updateTrialTranscriptFolder");
        add(functions, "admin_accounts", AdminAccountController.class, Scope.ADMIN,
                "listAccounts teacherOptions assignStudentTeacher transferStudents");
        add(functions, "admin_lessons", AdminLessonManagementController.class, Scope.ADMIN,
                "lessons preparation workbook answers transcript");
        add(functions, "trial_lessons", AdminTrialLessonController.class, Scope.ADMIN, "list");
        add(functions, "trial_leads", TrialLeadController.class, Scope.ADMIN, "list");
        add(functions, "site_visits", SiteVisitController.class, Scope.ADMIN, "analytics list deleteVisit");
        add(functions, "learning_time", LearningTimeController.class, Scope.ADMIN, "schoolSummary");
        add(functions, "learning_time", LearningTimeController.class, Scope.CALLER, "studentReport");
        // Raw Drive IDs use the school's service account, so only school administrators may access this adapter.
        add(functions, "drive", GoogleDriveController.class, Scope.ADMIN,
                "listSharedDrives listFolders listPdfFiles download upload");
        add(functions, "school_prompts", SchoolPromptSettingsController.class, Scope.CALLER, "get");
        add(functions, "school_prompts", SchoolPromptSettingsController.class, Scope.ADMIN, "update");
        add(functions, "brand_guide", SchoolBrandGuideController.class, Scope.CALLER, "get pdf");
        add(functions, "brand_guide", SchoolBrandGuideController.class, Scope.ADMIN, "update");
        add(functions, "stories_template", StoryTemplateMasterController.class, Scope.ADMIN, "info upload download");
        // Studio reads contain the real HTML/CSS/JSON project and embedded logo, not the legacy PPTX.
        // Full-document writes are deliberately not exposed through the general MCP adapter.
        add(functions, "stories_studio", StoryStudioProjectController.class, Scope.ADMIN, "info chunk download");
        add(functions, "skill_boards", SkillBoardController.class, Scope.CALLER, "get");
        add(functions, "skill_boards", SkillBoardController.class, Scope.ADMIN, "save");
        add(functions, "skill_mastery", SkillMasteryController.class, Scope.CALLER,
                "students groups boardStudents mastery history update");
        add(functions, "account", UserController.class, Scope.CALLER, "updateSettings");
        Map<String, Function> unique = new LinkedHashMap<>();
        for (Function function : functions) {
            if (unique.put(function.id(), function) != null) throw new IllegalStateException("Duplicate site function");
        }
        return List.copyOf(functions);
    }

    private static void add(List<Function> functions, String domain, Class<?> controller,
                            Scope scope, String methods) {
        for (String name : methods.split(" ")) {
            List<Method> candidates = Arrays.stream(controller.getDeclaredMethods())
                    .filter(method -> method.getName().equals(name) && java.lang.reflect.Modifier.isPublic(method.getModifiers()))
                    .toList();
            if (candidates.size() != 1) throw new IllegalStateException("Review allowlist method: " + controller.getSimpleName() + "." + name);
            Method method = candidates.get(0);
            boolean readOnly = method.isAnnotationPresent(GetMapping.class) || name.equals("previewImport");
            // These GET handlers create the preparation row when absent.
            if ((controller == LessonPreparationController.class && name.equals("get"))
                    || (controller == AdminLessonManagementController.class && name.equals("preparation"))) readOnly = false;
            functions.add(new Function(domain + "." + name, domain, controller, method, scope, readOnly,
                    method.isAnnotationPresent(DeleteMapping.class) || DESTRUCTIVE.contains(name),
                    domain.equals("lesson_board") || domain.equals("notebook_camera") || domain.equals("online_classes") || domain.equals("class_documents"),
                    EXTERNAL_EFFECTS.contains(domain + "." + name),
                    preferred(domain)));
        }
    }

    private static String preferred(String domain) {
        return switch (domain) {
            case "lesson_preparation" -> "get_lesson_preparation / prepare_lesson / attach_lesson_answers / attach_lesson_transcript";
            case "monthly_plans" -> "get_month_plan / update_month_plan";
            case "homework" -> "assign_homework_series / update_homework / delete_homework / find_student_homeworks / get_recent_homework_submissions";
            case "skill_boards" -> "get_skill_board / edit_skill_board";
            case "skill_mastery" -> "get_skill_mastery / update_skill_mastery";
            case "brand_guide" -> "get_brand_guide / update_brand_guide";
            case "stories_template" -> "get_story_template_info / get_story_template_chunk / update_story_template_master";
            default -> "";
        };
    }
}
