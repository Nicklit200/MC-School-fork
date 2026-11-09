package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.skills.SkillBoardMcpService;
import com.mcschool.flashcard.skills.SkillMasteryMcpService;
import org.springframework.beans.factory.annotation.Autowired;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.McpOAuthService;
import com.mcschool.flashcard.drive.TeacherGoogleDriveDownloadService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanService;
import com.mcschool.flashcard.monthlyplans.dto.MonthlyPlanResponse;
import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import com.mcschool.flashcard.settings.StoryTemplateMasterService;
import com.mcschool.flashcard.settings.StoryTemplateDownloadLinkService;
import com.mcschool.flashcard.settings.SchoolPromptSettingsResponse;
import com.mcschool.flashcard.settings.SchoolPromptSettingsService;
import com.mcschool.flashcard.trialleads.FunnelAnalyticsService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** Remote MCP server for the Mindcrafti ChatGPT app. */
@RestController
@RequestMapping("/api/v1/mcp")
public class MindcraftiMcpController {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(MindcraftiMcpController.class);

    private static final String API_KEY_HEADER = "X-Mindcrafti-Api-Key";
    private static final String SERVER_NAME = "mindcrafti-lessons";
    private static final String SERVER_VERSION = "1.36.0";
    private static final int MAX_DIRECT_PDF_BYTES = 15 * 1024 * 1024;
    private static final String FILE_TRANSFER_RESOURCE = "ui://mindcrafti/lesson-file-transfer-v2.html";
    private static final String FILE_TRANSFER_MIME = "text/html;profile=mcp-app";
    private static final String UI_DIAGNOSTIC_MODERN_RESOURCE = "ui://mindcrafti/ui-diagnostic-modern-v1.html";
    private static final String UI_DIAGNOSTIC_LEGACY_RESOURCE = "ui://mindcrafti/ui-diagnostic-legacy-v1.html";
    private static final String UI_DIAGNOSTIC_LEGACY_MIME = "text/html+skybridge";
    private static final Set<String> FILE_TRANSFER_OPERATIONS = Set.of("prepare_lesson",
            "upload_personal_lesson_workbook", "upload_personal_lesson_answers",
            "lesson_preparation.uploadWorkbook", "lesson_preparation.uploadAnswers");

    private final String apiKey;
    private final ObjectMapper objectMapper;
    private final UserRepository userRepository;
    private final McpOAuthService oauthService;
    private final GoogleCalendarLessonService calendarLessonService;
    private final LessonPreparationService preparationService;
    private final LessonPreparationRepository preparationRepository;
    private final TranscriptLessonGuard transcriptLessonGuard;
    private final TeacherGoogleDriveDownloadService teacherDriveDownloadService;
    private final McpHomeworkSeriesService homeworkSeriesService;
    private final McpAnalyticsService analyticsService;
    private final McpHomeworkReadService homeworkReadService;
    private final McpHomeworkWriteService homeworkWriteService;
    private final MonthlyPlanService monthlyPlanService;
    private final SchoolPromptSettingsService schoolPromptSettingsService;
    private final SchoolBrandGuideService schoolBrandGuideService;
    private final LessonPdfDraftService lessonPdfDraftService;
    private OwnerWorkbookGeneratorService ownerWorkbookGeneratorService;
    private OwnerWorkbookPdfRenderService ownerWorkbookPdfRenderService;
    private WorkbookContentService workbookContentService;
    private WorkbookDraftDownloadService workbookDraftDownloads;
    private WorkbookGenerationJobService workbookJobs;
    private PersonalWorkbookDraftService personalDrafts;
    private com.mcschool.flashcard.skills.SkillBoardService workbookBoards;
    private com.mcschool.flashcard.skills.SkillMasteryService workbookMastery;
    private final StoryTemplateMasterService storyTemplateMasterService;
    private final StoryTemplateDownloadLinkService storyTemplateDownloadLinkService;
    private final FunnelAnalyticsService funnelAnalyticsService;

    public MindcraftiMcpController(
            @Value("${MINDCRAFTI_LESSON_IMPORT_API_KEY:}") String apiKey,
            ObjectMapper objectMapper,
            UserRepository userRepository,
            McpOAuthService oauthService,
            GoogleCalendarLessonService calendarLessonService,
            LessonPreparationService preparationService,
            LessonPreparationRepository preparationRepository,
            TranscriptLessonGuard transcriptLessonGuard,
            TeacherGoogleDriveDownloadService teacherDriveDownloadService,
            McpHomeworkSeriesService homeworkSeriesService,
            McpAnalyticsService analyticsService,
            McpHomeworkReadService homeworkReadService,
            McpHomeworkWriteService homeworkWriteService,
            MonthlyPlanService monthlyPlanService,
            SchoolPromptSettingsService schoolPromptSettingsService,
            SchoolBrandGuideService schoolBrandGuideService,
            LessonPdfDraftService lessonPdfDraftService,
            StoryTemplateMasterService storyTemplateMasterService,
            StoryTemplateDownloadLinkService storyTemplateDownloadLinkService,
            FunnelAnalyticsService funnelAnalyticsService) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.objectMapper = objectMapper;
        this.userRepository = userRepository;
        this.oauthService = oauthService;
        this.calendarLessonService = calendarLessonService;
        this.preparationService = preparationService;
        this.preparationRepository = preparationRepository;
        this.transcriptLessonGuard = transcriptLessonGuard;
        this.teacherDriveDownloadService = teacherDriveDownloadService;
        this.homeworkSeriesService = homeworkSeriesService;
        this.analyticsService = analyticsService;
        this.homeworkReadService = homeworkReadService;
        this.homeworkWriteService = homeworkWriteService;
        this.monthlyPlanService = monthlyPlanService;
        this.schoolPromptSettingsService = schoolPromptSettingsService;
        this.schoolBrandGuideService = schoolBrandGuideService;
        this.lessonPdfDraftService = lessonPdfDraftService;
        this.storyTemplateMasterService = storyTemplateMasterService;
        this.storyTemplateDownloadLinkService = storyTemplateDownloadLinkService;
        this.funnelAnalyticsService = funnelAnalyticsService;
    }

    private SkillBoardMcpService skillBoardMcpService;
    private PersonalNutritionMcpService personalNutritionMcpService;
    private SkillMasteryMcpService skillMasteryMcpService;
    private McpLessonScheduleService lessonScheduleService;
    private McpSiteFunctionsService siteFunctionsService;
    private McpTeacherGuideService teacherGuideService;

    @Autowired
    public void setTeacherGuideService(McpTeacherGuideService service) { this.teacherGuideService=service; }
    private PersonalLessonWorkbookService personalLessonWorkbookService;
    private PersonalLessonAnswersService personalLessonAnswersService;
    private McpAccessService personalWorkbookAccess;
    private McpOperationReceiptService personalWorkbookReceipts;
    private ChatGptPdfResolver chatGptPdfResolver;

    @Autowired
    public void setChatGptPdfResolver(ChatGptPdfResolver resolver) {
        this.chatGptPdfResolver = resolver;
    }

    @Autowired
    public void setPersonalLessonWorkbookService(PersonalLessonWorkbookService service) {
        this.personalLessonWorkbookService = service;
    }

    @Autowired
    public void setPersonalLessonAnswersService(PersonalLessonAnswersService service) {
        this.personalLessonAnswersService = service;
    }

    @Autowired
    public void setPersonalWorkbookAccess(McpAccessService service) {
        this.personalWorkbookAccess = service;
    }

    @Autowired
    public void setPersonalWorkbookReceipts(McpOperationReceiptService service) {
        this.personalWorkbookReceipts = service;
    }

    @Autowired
    public void setLessonScheduleService(McpLessonScheduleService service) {
        this.lessonScheduleService = service;
    }

    @Autowired
    public void setSiteFunctionsService(McpSiteFunctionsService service) {
        this.siteFunctionsService = service;
    }

    @Autowired
    public void setOwnerWorkbookPdfRenderService(OwnerWorkbookPdfRenderService service) {
        this.ownerWorkbookPdfRenderService = service;
    }

    @Autowired
    public void setWorkbookContentService(WorkbookContentService service) {
        this.workbookContentService = service;
    }

    @Autowired
    public void setWorkbookJobs(WorkbookGenerationJobService service) {
        this.workbookJobs=service;
        service.setGenerator((actor,args)->{
            User user=userRepository.findById(actor.id()).orElseThrow(()->new IllegalArgumentException("School account is unavailable"));
            return generateLessonWorkbookDraftSynchronously(args,new AuthContext(true,false,user));
        });
    }

    @Autowired
    public void setPersonalDrafts(PersonalWorkbookDraftService service) { this.personalDrafts=service; }

    @Autowired
    public void setWorkbookDraftDownloads(WorkbookDraftDownloadService service) {
        this.workbookDraftDownloads=service;
    }

    @Autowired
    public void setWorkbookSkills(com.mcschool.flashcard.skills.SkillBoardService boards,
                                  com.mcschool.flashcard.skills.SkillMasteryService mastery) {
        this.workbookBoards = boards;
        this.workbookMastery = mastery;
    }

    @Autowired
    public void setOwnerWorkbookGeneratorService(OwnerWorkbookGeneratorService service) {
        this.ownerWorkbookGeneratorService = service;
    }

    @Autowired
    public void setSkillBoardMcpService(SkillBoardMcpService service) {
        this.skillBoardMcpService = service;
    }

    @Autowired
    public void setSkillMasteryMcpService(SkillMasteryMcpService service) {
        this.skillMasteryMcpService = service;
    }

    @Autowired
    public void setPersonalNutritionMcpService(PersonalNutritionMcpService service) {
        this.personalNutritionMcpService = service;
    }

    @GetMapping
    public ResponseEntity<Void> get() {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .header(HttpHeaders.ALLOW, "POST")
                .build();
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> post(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestHeader(value = API_KEY_HEADER, required = false) String suppliedApiKey,
            @RequestBody Map<String, Object> body) {
        AuthContext auth = authenticationContext(authorization, suppliedApiKey);
        String method = string(body.get("method"));
        long started = System.nanoTime();
        Object id = body.get("id");
        boolean notification = id == null;

        if (notification) return ResponseEntity.accepted().build();
        if (Set.of("initialize", "server/discover", "resources/list", "resources/read", "resources/templates/list").contains(method)) {
            LOG.info("MCH3 RPC method={} version={}", method, SERVER_VERSION);
        }

        try {
            Object result = switch (method) {
                case "initialize" -> initialize(body, auth.authenticated());
                case "server/discover" -> discover(auth.authenticated());
                case "ping" -> Map.of();
                case "tools/list" -> Map.of("tools", tools(auth));
                case "tools/call" -> callTool(body, auth);
                case "resources/list" -> fileTransferResources(auth);
                case "resources/read" -> readFileTransferResource(body, auth);
                case "resources/templates/list" -> Map.of("resourceTemplates", List.of());
                default -> null;
            };
            if (result == null) {
                LOG.warn("MCH3 RPC unknown method version={}", SERVER_VERSION);
                return ResponseEntity.ok(error(id, -32601, "Method not found: " + method));
            }
            return ResponseEntity.ok(success(id, result));
        } catch (IllegalArgumentException ex) {
            logRpcFailure(method,body,auth,ex,started);
            return ResponseEntity.ok(error(id, -32602, ex.getMessage()));
        } catch (Exception ex) {
            logRpcFailure(method,body,auth,ex,started);
            return ResponseEntity.ok(error(id, -32603, ex.getMessage() == null ? "Internal error" : ex.getMessage()));
        }
    }

    private void logRpcFailure(String method,Map<String,Object> request,AuthContext auth,Exception error,long started) {
        String operation=string(map(request.get("params")).get("name"));
        if(!operation.matches("[a-z_]{1,80}"))operation="none";
        String safeMethod=Set.of("initialize","tools/call","tools/list","resources/read","resources/list","server/discover","ping","resources/templates/list").contains(method)?method:"unknown";
        LOG.warn("MCH3 RPC failed method={} tool={} authenticated={} role={} errorType={} durationMs={}",
                safeMethod,operation,auth.authenticated(),auth.user()==null?"none":auth.user().getRole(),error.getClass().getSimpleName(),(System.nanoTime()-started)/1_000_000);
    }

    private Map<String, Object> initialize(Map<String, Object> request, boolean authenticated) {
        Map<String, Object> params = map(request.get("params"));
        String requested = string(params.get("protocolVersion"));
        String protocolVersion = requested.isBlank() ? "2025-11-25" : requested;
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("protocolVersion", protocolVersion);
        result.put("capabilities", Map.of("tools", Map.of("listChanged", true),
                "resources", Map.of()));
        result.put("serverInfo", Map.of("name", SERVER_NAME, "version", SERVER_VERSION));
        result.put("instructions", authenticated
                ? "For the curriculum skills board, always read get_skill_board fresh before answering from it or using edit_skill_board. Edit only explicitly requested items, using the exact returned revision. Preserve unrelated content and read back after saving. A stale revision means reconcile, not blind retry. This catalog does not contain pupil mastery. Mindcrafti school tools include lessons, structured monthly plans for students and groups, school prompts, the current school Brand Guide, the current approved 3-slide Mindcrafti Stories PPTX via get_story_template_info and get_story_template_chunk, homework assignment, direct PDF homework upload, explicit replacement/update/deletion of existing homework, submitted homework PDFs, rendered submission pages, read-only student analytics and admin-only public funnel analytics. When preparing the next lesson for a student or group, use get_month_plan for the current month when a plan exists, then combine it with recent lesson/homework evidence and the current school prompt. IMPORTANT: when a teacher asks to create a lesson, homework, worksheet or other teaching material 'по промту', 'по школьному промту', 'using the prompt', or clearly asks to use the school's prompt, first call get_school_prompt with the most specific lessonType: group or individual for lesson logic, workbook for a workbook/worksheet, homework for homework, diagnostic for a diagnostic lesson, or error_correction for work on mistakes, and then follow the returned prompt as the base instruction. Apply any extra teacher instructions on top of that prompt. If the teacher explicitly says 'без промта' or 'without the prompt', do not call get_school_prompt. Do not assume or reuse an old prompt from chat history; fetch the current prompt each time the teacher asks to work 'по промту'. For ANY Mindcrafti-branded document or visual material (PDF, homework, diagnostic, worksheet, report, presentation, work-on-mistakes document, parent report, internal document or other branded artifact), first call get_brand_guide and follow the current Brand Guide for visual design. Do not reuse a Brand Guide from chat history. When ChatGPT creates homework PDFs, prefer assign_homework_series_file_transfer with real ChatGPT file IDs. It uses the same secure host-file bridge as lesson workbooks, so no base64 or Google Drive intermediate is needed. Keep assign_homework_series only as a legacy/base64-or-Drive fallback."
                : "The connector is in diagnostic mode. Sign in with Mindcrafti OAuth to access school data tools.");
        if (authenticated) result.put("instructions", result.get("instructions") + schedulingInstructions() + workbookInstructions() + McpTeacherGuideService.INSTRUCTIONS);
        return result;
    }

    private String schedulingInstructions() {
        return " To schedule an actual appointment on the website, use create_lesson or create_lesson_series; prepare_lesson and create_lesson_draft only attach teaching materials. Lesson dates and times use Europe/Berlin. Use update_lesson for time changes, assign_lesson for the student or group, and delete_lesson only on explicit cancellation. Pupils use Shared board and My board (Моя доска). When personal worksheet tools are available, list_personal_lesson_workbooks identifies the exact pupil and upload_personal_lesson_workbook assigns a private PDF that takes priority over the common workbook in that pupil's My board. Without a private PDF, My board uses the common workbook or stays blank if none is uploaded. Shared board continues to show the common workbook to everyone; other pupils are unchanged. upload_personal_lesson_answers stores that pupil's separate private teacher-answer PDF, while prepare_lesson and attach_lesson_answers continue to update shared lesson materials. Private answer metadata is staff-only. For other website operations, discover list_site_functions, inspect get_site_function, then use read_site_function or execute_site_function. Writes require the user's concrete request and a stable idempotencyKey. Reuse that key on identical retries. If an external action has an unknown outcome, inspect current state; do not silently use a new key. ADMIN must select the verified teacherId for teacher-scoped operations. Browser camera, microphone, stylus, OAuth and credentials remain outside this catalog.";
    }

    private Map<String, Object> discover(boolean authenticated) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("resultType", "complete");
        result.put("supportedVersions", List.of("2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"));
        result.put("capabilities", Map.of("tools", Map.of(), "resources", Map.of()));
        result.put("serverInfo", Map.of("name", SERVER_NAME, "version", SERVER_VERSION));
        result.put("instructions", authenticated
                ? "For the curriculum skills board, always read get_skill_board fresh before answering from it or using edit_skill_board. Edit only explicitly requested items, using the exact returned revision. Preserve unrelated content and read back after saving. A stale revision means reconcile, not blind retry. This catalog does not contain pupil mastery. Mindcrafti lesson, school-prompt, Brand Guide, homework-file and school analytics tools. If the teacher asks for 7-day PDF homework, use prepare_homework_context, author seven separate ChatGPT lessonJson daily pages, run generate_homework_day_draft for each day, poll get_lesson_workbook_job, then review_homework_series_drafts. Assign only after explicit teacher approval with assign_homework_series_from_drafts. IMPORTANT: Some ChatGPT clients have an older frozen MCH3 tool catalog and cannot call these four tools. If any named homework tool is missing, AUTOMATICALLY use the existing MCH3 list_site_functions(domain=homework_generator), get_site_function, read_site_function and execute_site_function. functionIds are homework_generator.prepare_context (READ), homework_generator.generate_day (WRITE), homework_generator.review_series (READ), homework_generator.assign_series (WRITE after approval). Pass teacherId at top-level for ADMIN; for WRITE pass confirm=true and a stable unique idempotencyKey. The inner arguments match the direct tool except idempotencyKey/confirm/teacherId are top-level. NEVER stop at 'tools unavailable' when this bridge exists. No Google Drive, Railway, server AI or API keys are required. If the teacher says to make a lesson or homework 'по промту', fetch the current school prompt with get_school_prompt before generating. For any Mindcrafti-branded document or visual material, fetch the current Brand Guide with get_brand_guide before creating it. Extra teacher instructions override or refine the prompt for that request. If the teacher says 'без промта', do not fetch the lesson prompt."
                : "Mindcrafti diagnostic MCP connection. No school data is exposed without authentication.");
        if (authenticated) result.put("instructions", result.get("instructions") + schedulingInstructions() + workbookInstructions());
        return result;
    }

    private String workbookInstructions() {
        return " MANDATORY for TEACHER and ADMIN: ChatGPT itself writes the lesson content, the server ONLY verifies/renders PDFs. ALWAYS call prepare_workbook_context for the exact lesson BEFORE generate_lesson_workbook_draft; read its rendererContract and prepare complete lessonJson with workbookPages, teacherPages, and qa.algebra. ALWAYS call generate_lesson_workbook_draft with lessonJson AND the fresh contextToken, eventId and stable idempotencyKey. NEVER call generation with only eventId/instruction, never ask teachers for Railway/GitHub or an OpenAI API key, and never use server-side AI to author exercises. Server workbook generation returns a durable jobId. Poll get_lesson_workbook_job after retryAfterSeconds; never duplicate a generation after a timeout. For several pupils, wait for all jobs and refresh get_lesson_draft for every PDF just before presenting its five-minute signed link. After explicit approval, attach server-generated personal materials with publish_personal_lesson_draft using draftId and the exact pupil. It directly stores both worksheet and private teacher answers; no file download, re-upload or widget is needed. Use publish_lesson_draft only for common lesson materials. For seven-day homework, if direct new commands are invisible in this ChatGPT connection, use list_site_functions(domain=homework_generator) and the four homework_generator.* functionIds through EXISTING read_site_function and execute_site_function; first inspect each get_site_function. This requires ONLY MCH3. Never claim a file was published without successful write and readback.";
    }

    private boolean fileTransferActorAllowed(AuthContext auth) {
        User user = auth.user();
        return !auth.apiKey() && user != null && !user.isArchived()
                && user.getStatus() == com.mcschool.flashcard.users.UserStatus.ACTIVE
                && (user.getRole() == Role.ADMIN || user.getRole() == Role.TEACHER);
    }

    private boolean uiDiagnosticActorAllowed(AuthContext auth) {
        return fileTransferActorAllowed(auth) && auth.user().getRole() == Role.ADMIN;
    }

    private Map<String, Object> fileTransferResources(AuthContext auth) {
        List<Map<String, Object>> resources = new ArrayList<>();
        if (fileTransferActorAllowed(auth)) {
            if (teacherGuideService != null) resources.add(McpTeacherGuideService.resourceDescriptor());
            resources.add(Map.of("uri", FILE_TRANSFER_RESOURCE, "name", "lesson-file-transfer",
                        "title", "Загрузка PDF в урок", "mimeType", FILE_TRANSFER_MIME,
                        "description", "Transfers the approved ChatGPT PDFs to the selected Mindcrafti lesson."));
        }
        if (uiDiagnosticActorAllowed(auth)) {
            resources.add(uiDiagnosticResourceDescriptor(false));
            resources.add(uiDiagnosticResourceDescriptor(true));
        }
        return Map.of("resources", resources);
    }

    private Map<String, Object> uiDiagnosticResourceDescriptor(boolean legacy) {
        return Map.of("uri", legacy ? UI_DIAGNOSTIC_LEGACY_RESOURCE : UI_DIAGNOSTIC_MODERN_RESOURCE,
                "name", legacy ? "ui-diagnostic-legacy" : "ui-diagnostic-modern",
                "title", "MCH3 UI diagnostic (" + (legacy ? "legacy" : "modern") + ")",
                "mimeType", legacy ? UI_DIAGNOSTIC_LEGACY_MIME : FILE_TRANSFER_MIME,
                "description", "Read-only administrator diagnostic for the ChatGPT UI host.");
    }

    private Map<String, Object> readFileTransferResource(Map<String, Object> request, AuthContext auth) {
        String uri = required(map(request.get("params")), "uri");
        if (McpTeacherGuideService.UI_RESOURCE.equals(uri)) {
            if (!fileTransferActorAllowed(auth)) throw new org.springframework.security.access.AccessDeniedException("School OAuth sign-in is required");
            if (teacherGuideService == null) throw new IllegalStateException("Teacher guide is unavailable");
            try { return teacherGuideService.resource(auth.user(),auth.apiKey()); }
            catch (java.io.IOException unavailable) { throw new IllegalStateException("Teacher guide gallery is unavailable"); }
        }
        if (UI_DIAGNOSTIC_MODERN_RESOURCE.equals(uri) || UI_DIAGNOSTIC_LEGACY_RESOURCE.equals(uri)) {
            return readUiDiagnosticResource(uri, auth);
        }
        LOG.info("MCH3 PDF transfer panel requested version={} authenticated={} allowed={}",
                SERVER_VERSION, auth.authenticated(), fileTransferActorAllowed(auth));
        if (!fileTransferActorAllowed(auth)) {
            throw new org.springframework.security.access.AccessDeniedException("School OAuth sign-in is required");
        }
        if (!FILE_TRANSFER_RESOURCE.equals(uri)) {
            throw new IllegalArgumentException("Unknown Mindcrafti resource");
        }
        String html;
        try (var input = new ClassPathResource("mcp/lesson-file-transfer.html").getInputStream()) {
            html = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (java.io.IOException unavailable) {
            throw new IllegalStateException("The lesson file-transfer panel is unavailable");
        }
        LOG.info("MCH3 PDF transfer panel served version={} role={}", SERVER_VERSION, auth.user().getRole());
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("ui", Map.of("prefersBorder", true,
                "csp", Map.of("connectDomains", List.of(), "resourceDomains", List.of())));
        metadata.put("openai/widgetPrefersBorder", true);
        metadata.put("openai/widgetDescription", "Uploads the approved PDFs directly from ChatGPT to the selected Mindcrafti lesson and verifies their saved metadata.");
        metadata.put("openai/widgetCSP", Map.of("connect_domains", List.of(), "resource_domains", List.of()));
        metadata.put("openai/ui", Map.of("availableDisplayModes", List.of("inline", "fullscreen")));
        return Map.of("contents", List.of(Map.of("uri", FILE_TRANSFER_RESOURCE, "mimeType", FILE_TRANSFER_MIME,
                "text", html, "_meta", metadata)));
    }

    private Map<String, Object> readUiDiagnosticResource(String uri, AuthContext auth) {
        if (!uiDiagnosticActorAllowed(auth)) {
            throw new org.springframework.security.access.AccessDeniedException("UI diagnostics require an active school OAuth administrator");
        }
        boolean legacy = UI_DIAGNOSTIC_LEGACY_RESOURCE.equals(uri);
        String html;
        try (var input = new ClassPathResource("mcp/ui-diagnostic.html").getInputStream()) {
            html = new String(input.readAllBytes(), StandardCharsets.UTF_8)
                    .replace("__MCH3_DIAGNOSTIC_MODE__", legacy ? "legacy" : "modern");
        } catch (java.io.IOException unavailable) {
            throw new IllegalStateException("The UI diagnostic panel is unavailable");
        }
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("ui", Map.of("prefersBorder", true));
        if (legacy) metadata.put("openai/widgetPrefersBorder", true);
        return Map.of("contents", List.of(Map.of("uri", uri,
                "mimeType", legacy ? UI_DIAGNOSTIC_LEGACY_MIME : FILE_TRANSFER_MIME,
                "text", html, "_meta", metadata)));
    }

    private List<Map<String, Object>> uiDiagnosticTools() {
        List<Map<String, Object>> definitions = new ArrayList<>();
        for (boolean legacy : List.of(false, true)) {
            String mode = legacy ? "legacy" : "modern";
            String uri = legacy ? UI_DIAGNOSTIC_LEGACY_RESOURCE : UI_DIAGNOSTIC_MODERN_RESOURCE;
            Map<String, Object> definition = tool("test_mch3_ui_" + mode,
                    "ADMIN ONLY: Open a read-only " + mode + " ChatGPT UI diagnostic. Tests panel construction and host bridge availability; does not access files or change any school data.",
                    schema(Map.of(), List.of()), readOnlyAnnotations());
            definition.put("outputSchema", schema(Map.of("success", Map.of("type", "boolean", "const", true),
                    "ready", Map.of("type", "boolean", "const", true),
                    "mode", Map.of("type", "string", "const", mode)), List.of("success", "ready", "mode")));
            definition.put("_meta", Map.of("ui", Map.of("resourceUri", uri), "openai/outputTemplate", uri));
            definitions.add(definition);
        }
        return definitions;
    }

    private Map<String, Object> testUiDiagnostic(String name, Map<String, Object> arguments, AuthContext auth) throws Exception {
        if (!uiDiagnosticActorAllowed(auth)) {
            throw new org.springframework.security.access.AccessDeniedException("UI diagnostics require an active school OAuth administrator");
        }
        if (!arguments.isEmpty()) throw new IllegalArgumentException("UI diagnostics accept no arguments");
        return toolResult(Map.of("success", true, "ready", true,
                "mode", "test_mch3_ui_legacy".equals(name) ? "legacy" : "modern"));
    }

    private Map<String, Object> fileTransferProperties(boolean completion) {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("operation", Map.of("type", "string", "enum", FILE_TRANSFER_OPERATIONS.stream().sorted().toList(),
                "description", "The exact approved shared, personal, or website PDF upload operation."));
        properties.put("teacherId", property("string", "Exact teacher UUID returned by find_lessons."));
        properties.put("eventId", property("string", "Exact lesson eventId returned by find_lessons."));
        properties.put("studentId", property("string", "Required only for a personal PDF: exact current lesson participant UUID."));
        properties.put("idempotencyKey", Map.of("type", "string", "minLength", 8, "maxLength", 128,
                "description", "Stable key for the approved upload. Reuse unchanged files and arguments on retries."));
        properties.put("confirm", Map.of("type", "boolean", "enum", List.of(true),
                "description", "True only after the teacher explicitly approved uploading these PDFs to this lesson."));
        properties.put("workbookFilename", property("string", "Optional workbook filename for prepare_lesson."));
        properties.put("answersFilename", property("string", "Optional teacher-answer filename for prepare_lesson."));
        properties.put("filename", property("string", "Optional filename for the one personal or website PDF."));
        properties.put("homeworkNotes", property("string", "Optional homework note change, only for prepare_lesson."));
        properties.put("difficulties", property("string", "Optional difficulties note change, only for prepare_lesson."));
        properties.put("lessonPlan", property("string", "Optional lesson plan change, only for prepare_lesson."));
        if (completion) {
            properties.put("workbookFile", ChatGptPdfResolver.fileSchema());
            properties.put("answersFile", ChatGptPdfResolver.fileSchema());
            properties.put("pdfFile", ChatGptPdfResolver.fileSchema());
        } else {
            Map<String, Object> id = Map.of("type", "string", "maxLength", 512,
                    "description", "Real opaque ChatGPT file ID from the file library. Never a URL, filesystem path or base64 data.");
            properties.put("workbookFileId", id);
            properties.put("answersFileId", id);
            properties.put("pdfFileId", id);
        }
        return properties;
    }

    private List<Map<String, Object>> fileTransferTools() {
        List<String> required = List.of("operation", "teacherId", "eventId", "idempotencyKey", "confirm");
        Map<String, Object> startSchema = schema(fileTransferProperties(false), required);
        Map<String, Object> start = tool("prepare_lesson_file_transfer",
                "Preferred direct transfer for PDFs that already have real ChatGPT file IDs. Call only after the teacher explicitly says to upload the approved files to this exact lesson, with confirm=true. Export locally created PDFs to the ChatGPT file library first if needed. The panel obtains real temporary download URLs using ChatGPT's file interface and reuses the existing Mindcrafti upload paths; no Google Drive or manual base64 is needed. Do not claim the files were saved until the panel and a readback confirm success. Supports shared preparation, both private PDF tools, and the two lesson_preparation PDF website functions.",
                startSchema, writeAnnotations());
        start.put("outputSchema", startSchema);
        start.put("_meta", Map.of("ui", Map.of("resourceUri", FILE_TRANSFER_RESOURCE, "visibility", List.of("model", "app")),
                "openai/outputTemplate", FILE_TRANSFER_RESOURCE, "openai/widgetAccessible", true,
                "openai/toolInvocation/invoking", "Подготовка загрузки PDF", "openai/toolInvocation/invoked", "Открыта загрузка PDF"));
        Map<String, Object> finish = tool("complete_lesson_file_transfer",
                "App-only completion for the approved lesson-file transfer panel. Accepts complete runtime file objects obtained through the host file interface. Rechecks school OAuth, lesson ownership and personal roster, then uses the original idempotent PDF upload operation. Never use invented file references.",
                schema(fileTransferProperties(true), required), writeAnnotations());
        finish.put("outputSchema", Map.of("type", "object", "additionalProperties", true));
        finish.put("_meta", Map.of("ui", Map.of("visibility", List.of("app")),
                "openai/visibility", "private", "openai/widgetAccessible", true));
        return List.of(start, finish);
    }


    private Map<String, Object> homeworkFileTransferProperties(boolean completion) {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("teacherId", property("string", "Exact teacher UUID returned by find_homework_targets."));
        properties.put("targetType", Map.of("type", "string", "enum", List.of("student", "group"),
                "description", "Homework target type."));
        properties.put("targetId", property("string", "Exact student or group UUID returned by find_homework_targets."));
        properties.put("startDate", property("string", "First homework date in YYYY-MM-DD format."));
        properties.put("days", Map.of("type", "integer", "minimum", 1, "maximum", 31,
                "description", "Number of consecutive calendar days to assign."));
        properties.put("filenames", arrayProperty("Optional PDF display filenames: empty, one filename for all days, or exactly one per day."));
        properties.put("idempotencyKey", Map.of("type", "string", "minLength", 8, "maxLength", 128,
                "description", "Stable key for this exact approved homework upload. Reuse unchanged files and arguments on retries."));
        properties.put("confirm", Map.of("type", "boolean", "enum", List.of(true),
                "description", "True only after the teacher explicitly approved assigning these PDFs."));
        if (completion) {
            properties.put("pdfFiles", Map.of("type", "array", "minItems", 1, "maxItems", 31,
                    "items", ChatGptPdfResolver.fileSchema(),
                    "description", "Complete runtime ChatGPT PDF file objects obtained by the file-transfer panel."));
        } else {
            properties.put("pdfFileIds", Map.of("type", "array", "minItems", 1, "maxItems", 31,
                    "items", Map.of("type", "string", "minLength", 1, "maxLength", 512),
                    "description", "Real opaque ChatGPT file IDs. Supply one PDF for all days or exactly one PDF per day."));
        }
        return properties;
    }

    private List<Map<String, Object>> homeworkFileTransferTools() {
        List<String> startRequired = List.of("teacherId", "targetType", "targetId", "startDate", "days",
                "pdfFileIds", "idempotencyKey", "confirm");
        Map<String, Object> startSchema = schema(homeworkFileTransferProperties(false), startRequired);
        Map<String, Object> start = tool("assign_homework_series_file_transfer",
                "Preferred direct transfer for homework PDFs that already have real ChatGPT file IDs. Uses the same secure host-file bridge and PDF resolver as lesson workbooks, without Google Drive or base64. Supply one PDF for all days or exactly one PDF per day. Requires explicit confirm=true and performs a database read-back before reporting success.",
                startSchema, writeAnnotations());
        start.put("outputSchema", startSchema);
        start.put("_meta", Map.of("ui", Map.of("resourceUri", FILE_TRANSFER_RESOURCE, "visibility", List.of("model", "app")),
                "openai/outputTemplate", FILE_TRANSFER_RESOURCE, "openai/widgetAccessible", true,
                "openai/toolInvocation/invoking", "Подготовка домашнего задания", "openai/toolInvocation/invoked", "Открыта загрузка домашнего задания"));

        List<String> finishRequired = List.of("teacherId", "targetType", "targetId", "startDate", "days",
                "pdfFiles", "idempotencyKey", "confirm");
        Map<String, Object> finish = tool("complete_homework_series_file_transfer",
                "App-only completion for the approved homework file-transfer panel. Accepts runtime ChatGPT file objects, rechecks target ownership, downloads and validates PDFs server-side, assigns the series atomically, then reads the saved homework back from Mindcrafti before success.",
                schema(homeworkFileTransferProperties(true), finishRequired), writeAnnotations());
        finish.put("outputSchema", Map.of("type", "object", "additionalProperties", true));
        finish.put("_meta", Map.of("ui", Map.of("visibility", List.of("app")),
                "openai/visibility", "private", "openai/widgetAccessible", true));
        return List.of(start, finish);
    }

    private Map<String, Object> prepareHomeworkFileTransfer(Map<String, Object> arguments, AuthContext auth) throws Exception {
        Map<String, Object> context = homeworkFileTransferContext(arguments, auth, false);
        Map<String, Object> result = toolResult(context);
        result.put("content", List.of(Map.of("type", "text", "text",
                "The approved homework PDF transfer panel is ready. Assignment is not complete until its database read-back succeeds.")));
        return result;
    }

    private Object completeHomeworkFileTransfer(Map<String, Object> arguments, AuthContext auth) throws Exception {
        Map<String, Object> context = homeworkFileTransferContext(arguments, auth, true);
        if (chatGptPdfResolver == null || personalWorkbookReceipts == null || personalWorkbookAccess == null) {
            throw new IllegalStateException("Direct homework PDF transfer is unavailable");
        }
        String targetType = required(context, "targetType");
        UUID targetId = uuid(required(context, "targetId"), "targetId");
        AuthenticatedUser teacher = homeworkTeacher(context, auth, targetType, targetId);
        AuthenticatedUser actor = personalWorkbookAccess.requireActor(auth.user());
        LocalDate startDate = LocalDate.parse(required(context, "startDate"));
        int days = integer(context.get("days"), "days");
        List<String> filenames = context.containsKey("filenames") ? stringList(context.get("filenames"), "filenames") : List.of();
        List<?> rawFiles = (List<?>) context.get("pdfFiles");

        List<ChatGptFileReference> references = new ArrayList<>();
        for (int i = 0; i < rawFiles.size(); i++) {
            String explicit = filenames.isEmpty() ? null : filenames.get(filenames.size() == 1 ? 0 : i);
            String fallback = "homework-" + startDate.plusDays(Math.min(i, days - 1)) + ".pdf";
            references.add(chatGptPdfResolver.reference(rawFiles.get(i), "pdfFiles[" + i + "]", explicit, fallback));
        }

        Map<String, Object> identity = new LinkedHashMap<>();
        identity.put("teacherId", teacher.id().toString());
        identity.put("targetType", targetType);
        identity.put("targetId", targetId.toString());
        identity.put("startDate", startDate.toString());
        identity.put("days", days);
        identity.put("filenames", filenames);
        identity.put("pdfFiles", references.stream().map(ChatGptFileReference::identity).toList());

        String key = required(context, "idempotencyKey");
        return personalWorkbookReceipts.execute(actor, teacher.id(), "assign_homework_series_files", key, identity,
                () -> { homeworkTeacher(context, auth, targetType, targetId); },
                () -> {
                    try {
                        List<byte[]> pdfs = references.stream().map(chatGptPdfResolver::resolve).map(PdfInput::bytes).toList();
                        Map<String, Object> assigned = homeworkSeriesService.assignDirectSeries(
                                teacher, targetType, targetId, startDate, days, pdfs, filenames);
                        return verifyHomeworkSeriesReadBack(assigned, auth, startDate, days);
                    } catch (RuntimeException failure) {
                        throw failure;
                    } catch (Exception failure) {
                        throw new IllegalStateException("Homework PDF assignment failed", failure);
                    }
                });
    }

    private Map<String, Object> homeworkFileTransferContext(Map<String, Object> arguments, AuthContext auth, boolean completion) {
        if (!fileTransferActorAllowed(auth) || personalWorkbookAccess == null || personalWorkbookReceipts == null) {
            throw new org.springframework.security.access.AccessDeniedException("School OAuth sign-in is required for homework file transfers");
        }
        if (!Boolean.TRUE.equals(arguments.get("confirm"))) {
            throw new IllegalArgumentException("confirm=true is required for the approved homework upload");
        }
        Set<String> allowed = new java.util.HashSet<>(Set.of("teacherId", "targetType", "targetId", "startDate",
                "days", "filenames", "idempotencyKey", "confirm", completion ? "pdfFiles" : "pdfFileIds"));
        if (!allowed.containsAll(arguments.keySet())) throw new IllegalArgumentException("Unsupported homework file-transfer arguments");

        String targetType = normalize(required(arguments, "targetType"));
        if (!Set.of("student", "group").contains(targetType)) {
            throw new IllegalArgumentException("targetType must be 'student' or 'group'");
        }
        UUID targetId = uuid(required(arguments, "targetId"), "targetId");
        AuthenticatedUser teacher = homeworkTeacher(arguments, auth, targetType, targetId);
        LocalDate startDate;
        try { startDate = LocalDate.parse(required(arguments, "startDate")); }
        catch (RuntimeException ex) { throw new IllegalArgumentException("startDate must use YYYY-MM-DD format"); }
        int days = integer(arguments.get("days"), "days");
        if (days < 1 || days > 31) throw new IllegalArgumentException("days must be between 1 and 31");

        String key = required(arguments, "idempotencyKey");
        if (key.length() < 8 || key.length() > 128 || key.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("idempotencyKey must contain 8 to 128 printable characters");
        }
        List<String> filenames = arguments.containsKey("filenames") ? stringList(arguments.get("filenames"), "filenames") : List.of();
        if (!filenames.isEmpty() && filenames.size() != 1 && filenames.size() != days) {
            throw new IllegalArgumentException("filenames must be empty, contain one name, or contain one name per day");
        }
        filenames = filenames.stream().map(name -> ChatGptPdfResolver.filename(name, "homework.pdf")).toList();

        String fileField = completion ? "pdfFiles" : "pdfFileIds";
        Object raw = arguments.get(fileField);
        if (!(raw instanceof List<?> files) || files.isEmpty() || files.size() > 31) {
            throw new IllegalArgumentException(fileField + " must contain between 1 and 31 PDFs");
        }
        if (files.size() != 1 && files.size() != days) {
            throw new IllegalArgumentException("Provide either one PDF for all days or exactly one PDF per day");
        }
        List<Object> normalizedFiles = new ArrayList<>();
        for (int i = 0; i < files.size(); i++) {
            Object value = files.get(i);
            if (completion) {
                if (!(value instanceof Map<?, ?>)) {
                    throw new IllegalArgumentException(fileField + "[" + i + "] must be a complete ChatGPT file object");
                }
                normalizedFiles.add(value);
            } else {
                if (!(value instanceof String fileId)) {
                    throw new IllegalArgumentException(fileField + "[" + i + "] must be a ChatGPT file ID");
                }
                fileId = fileId.trim();
                if (fileId.isBlank() || fileId.length() > 512 || !fileId.matches("[A-Za-z0-9_-]+")) {
                    throw new IllegalArgumentException(fileField + "[" + i + "] must be an opaque ChatGPT file ID, not a URL or local path");
                }
                normalizedFiles.add(fileId);
            }
        }

        Map<String, Object> context = new LinkedHashMap<>();
        context.put("operation", "assign_homework_series");
        context.put("teacherId", teacher.id().toString());
        context.put("targetType", targetType);
        context.put("targetId", targetId.toString());
        context.put("startDate", startDate.toString());
        context.put("days", days);
        context.put("filenames", filenames);
        context.put("idempotencyKey", key);
        context.put("confirm", true);
        context.put(fileField, normalizedFiles);
        return context;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> verifyHomeworkSeriesReadBack(
            Map<String, Object> assigned, AuthContext auth, LocalDate startDate, int days) {
        Object rawAssignments = assigned.get("assignments");
        if (!(rawAssignments instanceof List<?> rows)) {
            throw new IllegalStateException("Homework assignment result did not contain assignment rows");
        }
        LocalDate endDate = startDate.plusDays(days - 1L);
        Map<UUID, Map<String, Object>> snapshots = new LinkedHashMap<>();
        List<Map<String, Object>> verification = new ArrayList<>();

        for (Object rawRow : rows) {
            if (!(rawRow instanceof Map<?, ?> rawMap)) throw new IllegalStateException("Invalid homework assignment row");
            Map<String, Object> expected = (Map<String, Object>) rawMap;
            UUID studentId = uuid(required(expected, "studentId"), "studentId");
            Map<String, Object> snapshot = snapshots.computeIfAbsent(studentId, id ->
                    homeworkReadService.findStudentHomeworks(auth.user(), auth.apiKey(), id, startDate, endDate));
            Object rawHomeworks = snapshot.get("homeworks");
            if (!(rawHomeworks instanceof List<?> homeworks)) throw new IllegalStateException("Homework read-back is unavailable");

            String date = required(expected, "date");
            String expectedId = string(expected.get("homeworkId")).trim();
            String status = string(expected.get("status"));
            Map<String, Object> actual = null;
            for (Object rawHomework : homeworks) {
                if (!(rawHomework instanceof Map<?, ?> homeworkMap)) continue;
                Map<String, Object> candidate = (Map<String, Object>) homeworkMap;
                if (!date.equals(string(candidate.get("assignedDate"))) || !Boolean.TRUE.equals(candidate.get("hasWorksheet"))) continue;
                if (!expectedId.isBlank() && !expectedId.equals(string(candidate.get("homeworkId")))) continue;
                actual = candidate;
                break;
            }
            if (actual == null) throw new IllegalStateException("Homework read-back failed for student " + studentId + " on " + date);
            String actualFilename = string(actual.get("worksheetFilename"));
            if (!"skipped_existing".equals(status) && !required(expected, "filename").equals(actualFilename)) {
                throw new IllegalStateException("Homework filename read-back mismatch for student " + studentId + " on " + date);
            }
            Map<String, Object> verified = new LinkedHashMap<>();
            verified.put("studentId", studentId.toString());
            verified.put("studentName", expected.get("studentName"));
            verified.put("assignedDate", date);
            verified.put("homeworkId", actual.get("homeworkId"));
            verified.put("filename", actualFilename);
            verified.put("status", status);
            verified.put("verified", true);
            verification.add(verified);
        }

        Map<String, Object> result = new LinkedHashMap<>(assigned);
        result.put("verified", true);
        result.put("verifiedAssignments", verification);
        result.put("verificationSource", "mindcrafti_database");
        return result;
    }

    private Map<String, Object> prepareLessonFileTransfer(Map<String, Object> arguments, AuthContext auth) throws Exception {
        Map<String, Object> context = fileTransferContext(arguments, auth, false);
        Map<String, Object> result = toolResult(context);
        result.put("content", List.of(Map.of("type", "text", "text",
                "The approved PDF transfer panel is ready. Upload is not yet confirmed; wait for its saved-file verification.")));
        return result;
    }

    private Object completeLessonFileTransfer(Map<String, Object> arguments, AuthContext auth) throws Exception {
        Map<String, Object> context = fileTransferContext(arguments, auth, true);
        String operation = string(context.remove("operation"));
        context.remove("confirm");
        if ("prepare_lesson".equals(operation)) return prepareLesson(context, auth);
        if (operation.startsWith("upload_personal_lesson_")) return personalLessonWorkbooks(operation, context, auth);
        if (siteFunctionsService == null) throw new IllegalStateException("Website PDF uploads are unavailable");
        Map<String, Object> file = new LinkedHashMap<>(map(context.remove("pdfFile")));
        Object filename = context.remove("filename");
        if (filename != null) file.put("file_name", filename);
        return siteFunctionsService.call("execute_site_function", Map.of("functionId", operation,
                "teacherId", context.get("teacherId"), "arguments", Map.of("eventId", context.get("eventId")),
                "confirm", true, "idempotencyKey", context.get("idempotencyKey"), "file", file), auth.user(), false);
    }

    private Map<String, Object> fileTransferContext(Map<String, Object> arguments, AuthContext auth, boolean completion) {
        if (!fileTransferActorAllowed(auth) || personalWorkbookAccess == null || personalWorkbookReceipts == null) {
            throw new org.springframework.security.access.AccessDeniedException("School OAuth sign-in is required for lesson file transfers");
        }
        if (!Boolean.TRUE.equals(arguments.get("confirm"))) throw new IllegalArgumentException("confirm=true is required for the approved PDF upload");
        String operation = required(arguments, "operation");
        if (!FILE_TRANSFER_OPERATIONS.contains(operation)) throw new IllegalArgumentException("Unsupported lesson file-transfer operation");
        boolean shared = "prepare_lesson".equals(operation);
        boolean personal = operation.startsWith("upload_personal_lesson_");
        Set<String> allowed = new java.util.HashSet<>(Set.of("operation", "teacherId", "eventId", "idempotencyKey", "confirm"));
        if (shared) {
            allowed.addAll(Set.of("workbookFilename", "answersFilename", "homeworkNotes", "difficulties", "lessonPlan"));
            allowed.addAll(completion ? Set.of("workbookFile", "answersFile") : Set.of("workbookFileId", "answersFileId"));
        } else {
            allowed.add("filename");
            allowed.add(completion ? "pdfFile" : "pdfFileId");
            if (personal) allowed.add("studentId");
        }
        if (!allowed.containsAll(arguments.keySet())) throw new IllegalArgumentException("Unsupported lesson file-transfer arguments");
        AuthenticatedUser actor = personalWorkbookAccess.requireActor(auth.user());
        UUID teacherId = uuid(required(arguments, "teacherId"), "teacherId");
        AuthenticatedUser teacher = personalWorkbookAccess.requireTeacher(actor, teacherId);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);
        if (personal) {
            requirePersonalWorkbookActor(auth);
            if ("upload_personal_lesson_answers".equals(operation) && personalLessonAnswersService == null) {
                throw new IllegalStateException("Personal teacher-answer uploads are unavailable");
            }
            requirePersonalWorkbookStudent(teacher, eventId, uuid(required(arguments, "studentId"), "studentId"));
        } else if (!shared && siteFunctionsService == null) {
            throw new IllegalStateException("Website PDF uploads are unavailable");
        }
        String key = required(arguments, "idempotencyKey");
        if (key.length() < 8 || key.length() > 128 || key.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("idempotencyKey must contain 8 to 128 printable characters");
        }
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("operation", operation); context.put("teacherId", teacherId.toString());
        context.put("eventId", eventId); context.put("idempotencyKey", key); context.put("confirm", true);
        if (personal) context.put("studentId", uuid(required(arguments, "studentId"), "studentId").toString());
        if (shared) {
            copyTransferNotes(arguments, context, "homeworkNotes");
            copyTransferNotes(arguments, context, "difficulties");
            copyTransferNotes(arguments, context, "lessonPlan");
            copyTransferFilename(arguments, context, "workbookFilename");
            copyTransferFilename(arguments, context, "answersFilename");
            boolean workbook = copyTransferFile(arguments, context, completion ? "workbookFile" : "workbookFileId", completion);
            boolean answers = copyTransferFile(arguments, context, completion ? "answersFile" : "answersFileId", completion);
            if (!workbook && !answers) throw new IllegalArgumentException("At least one approved ChatGPT PDF is required");
            if (!workbook && context.containsKey("workbookFilename") || !answers && context.containsKey("answersFilename")) {
                throw new IllegalArgumentException("A PDF filename requires its matching file");
            }
        } else {
            copyTransferFilename(arguments, context, "filename");
            if (!copyTransferFile(arguments, context, completion ? "pdfFile" : "pdfFileId", completion)) {
                throw new IllegalArgumentException("Exactly one approved ChatGPT PDF is required");
            }
        }
        return context;
    }

    private boolean copyTransferFile(Map<String, Object> source, Map<String, Object> target, String field, boolean completion) {
        if (!source.containsKey(field)) return false;
        if (completion) {
            if (!(source.get(field) instanceof Map<?, ?>)) throw new IllegalArgumentException(field + " must be a complete ChatGPT file object");
            target.put(field, source.get(field));
            return true;
        }
        if (!(source.get(field) instanceof String value)) throw new IllegalArgumentException(field + " must be a ChatGPT file ID");
        value = value.trim();
        if (value.isEmpty()) return false;
        if (value.length() > 512 || !value.matches("[A-Za-z0-9_-]+")) {
            throw new IllegalArgumentException(field + " must be an opaque ChatGPT file ID, not a URL or local path");
        }
        target.put(field, value);
        return true;
    }

    private void copyTransferFilename(Map<String, Object> source, Map<String, Object> target, String field) {
        if (!source.containsKey(field)) return;
        if (!(source.get(field) instanceof String value) || value.length() > 1024) throw new IllegalArgumentException(field + " must be a PDF filename");
        if (value.isBlank()) return;
        String lower = value.strip().toLowerCase(Locale.ROOT);
        if (lower.startsWith("__answers__:") || lower.equals("__transcript__")) {
            throw new IllegalArgumentException("Document roles must use the selected file-transfer operation");
        }
        target.put(field, ChatGptPdfResolver.filename(value, "document.pdf"));
    }

    private void copyTransferNotes(Map<String, Object> source, Map<String, Object> target, String field) {
        if (!source.containsKey(field)) return;
        if (!(source.get(field) instanceof String value) || value.length() > 200_000) throw new IllegalArgumentException(field + " must be text of at most 200000 characters");
        target.put(field, value);
    }

    private List<Map<String, Object>> tools(AuthContext auth) {
        List<Map<String, Object>> tools = new ArrayList<>();
        tools.add(tool("mindcrafti_status", "Check that the Mindcrafti MCP server is reachable.", schema(Map.of(), List.of()), readOnlyAnnotations()));
        if (!auth.authenticated()) return tools;
        // Website management requires a real school OAuth identity. The legacy
        // PDF import key must never gain account or scheduling privileges.
        if (auth.user() != null && !auth.apiKey()) {
            if (lessonScheduleService != null) tools.addAll(McpLessonScheduleService.definitions());
            if (siteFunctionsService != null) tools.addAll(McpSiteFunctionsService.definitions());
        }
        if (fileTransferActorAllowed(auth) && teacherGuideService != null) {
            tools.add(McpTeacherGuideService.definition());
            tools.add(McpTeacherGuideService.showDefinition());
        }
        if (fileTransferActorAllowed(auth)) { tools.addAll(fileTransferTools()); tools.addAll(homeworkFileTransferTools()); }
        if (uiDiagnosticActorAllowed(auth)) tools.addAll(uiDiagnosticTools());
        tools.addAll(SkillBoardMcpService.definitions());
        tools.addAll(SkillMasteryMcpService.definitions());
        tools.addAll(PersonalNutritionMcpService.definitions());

        tools.add(tool("get_school_prompt", "Get the current administrator-managed Mindcrafti school prompt. Use this whenever the teacher asks to create a lesson, homework or teaching material 'по промту' / 'по школьному промту' / 'using the prompt'. Choose group for group-lesson logic, individual for one-to-one lesson logic, workbook for creating a lesson workbook/teacher answers, homework for creating homework, diagnostic for a trial/diagnostic lesson, and error_correction for a personalised work-on-mistakes document. Always fetch it fresh instead of relying on a prompt remembered from earlier chat messages. Teacher-specific extra instructions may be applied on top of the returned prompt.", schema(Map.of("lessonType", property("string", "Prompt type: group, individual, workbook, homework, diagnostic or error_correction.")), List.of("lessonType")), readOnlyAnnotations()));
        if (ownerWorkbookGeneratorService != null && ownerWorkbookGeneratorService.allowed(auth.user(), auth.apiKey())) {
            tools.add(tool("get_owner_workbook_generator",
                    "OWNER-ONLY CHATGPT PILOT: Fetch version, source generator, A4 CSS layout, example lesson JSON and QA scripts. Omit file to list manifest; pass an allowed filename to read it. Before creating any real school document fetch current get_school_prompt, get_brand_guide and monthly plan as appropriate. This tool never runs generation or publishes and is not available to other teachers.",
                    schema(Map.of("file", property("string", "Optional file from the returned manifest; omit to list available source files.")), List.of()),
                    readOnlyAnnotations()));
        }
        if (workbookStaff(auth) && ownerWorkbookPdfRenderService != null) {
            tools.add(tool("prepare_workbook_context",
                    "MANDATORY FIRST STEP for workbook creation by TEACHER or ADMIN. Read the exact owned lesson, current school prompt, Brand Guide, plan and student evidence. Then ChatGPT must generate full structured lessonJson matching rendererContract with workbookPages, teacherPages and qa.algebra, and pass it with this fresh contextToken to generate_lesson_workbook_draft. NEVER start a job without lessonJson and contextToken. No separate Railway or server AI access is needed. Teachers see only their own lessons; ADMIN selects teacherId.",
                    schema(Map.of(
                            "teacherId", property("string", "Exact teacher UUID from find_lessons"),
                            "eventId", property("string", "Exact eventId from find_lessons")),
                            List.of("eventId")), readOnlyAnnotations()));
            tools.add(tool("prepare_homework_context",
                    "MANDATORY FIRST STEP for seven-day homework via MCH3. Returns the current HOMEWORK school prompt, the exact lesson/student evidence, Brand Guide and fresh rendererContract/contextToken. Choose the most recent actually completed lesson and inspect its transcript; do not invent errors or new topics. Teachers need ONLY MCH3.",
                    schema(Map.of("teacherId",property("string","ADMIN selects teacher UUID, TEACHER may omit"),
                                  "eventId",property("string","Exact most recently taught owned lesson eventId from find_lessons")),
                            List.of("eventId")),readOnlyAnnotations()));
            Map<String,Object> homeworkDaySchema=new LinkedHashMap<>();
            homeworkDaySchema.put("teacherId",property("string","ADMIN selects teacher UUID; teachers may omit"));
            homeworkDaySchema.put("eventId",property("string","Owned reference lesson eventId returned by prepare_homework_context"));
            homeworkDaySchema.put("day",Map.of("type","integer","minimum",1,"maximum",7,
                    "description","Day index 1..7 for a seven-day HOMEWORK series"));
            homeworkDaySchema.put("seriesKey",property("string","One stable printable 8..128-character key, IDENTICAL for all seven days"));
            homeworkDaySchema.put("lessonJson",property("string","REQUIRED one-A4-page student workbook plus private teacherPages and numbered qa.algebra; math and graphics are structured, no raw images. meta.homeworkEstimatedMinutes must be 1..10. Server renders one student PDF + one private teacher-answer PDF."));
            homeworkDaySchema.put("contextToken",property("string","Exact fresh token from prepare_homework_context"));
            homeworkDaySchema.put("idempotencyKey",property("string","Unique stable key PER DAY (reuse unchanged on retries)"));
            tools.add(tool("generate_homework_day_draft",
                    "One of SEVEN daily HOMEWORK drafts. ChatGPT authors content based on current homework prompt and last lesson evidence. Server strictly enforces <=2 independent tasks, <=10min, 6+ handwriting lines per task, first four days support at TOP, days 5-7 fully German/no hints, and one pupil A4 PDF with NO name/date/day label. Uses the SAME mathematically checked vector PDF renderer as lessons and saves teacher-only answers. Returns durable jobId; poll get_lesson_workbook_job. Queue accepts up to 24 active jobs per account (60 school-wide) and processes up to three jobs concurrently; all seven daily jobs may be submitted without batching. DO NOT ASSIGN until approved.",
                    schema(homeworkDaySchema,List.of("eventId","day","seriesKey","lessonJson","contextToken","idempotencyKey")),writeAnnotations()));
            Map<String,Object> homeworkDraftSchema=new LinkedHashMap<>();
            homeworkDraftSchema.put("teacherId",property("string","ADMIN teacher UUID; TEACHER may omit"));
            homeworkDraftSchema.put("eventId",property("string","Exact source lesson shared by all seven drafts"));
            homeworkDraftSchema.put("seriesKey",property("string","Identical seriesKey supplied to each generation"));
            homeworkDraftSchema.put("draftIds",Map.of("type","array","minItems",7,"maxItems",7,
                    "items",Map.of("type","string"),
                    "description","Exactly seven successful unpublished draft UUIDs, ordered Day 1 through Day 7"));
            tools.add(tool("review_homework_series_drafts",
                    "Read-only. Validate ownership, series/day markers, seven distinct saved student PDFs and refresh all seven 5-minute PDF preview links, plus private answer PDFs. No assignment; present previews to teacher for approval.",
                    schema(homeworkDraftSchema,List.of("eventId","seriesKey","draftIds")),readOnlyAnnotations()));
            Map<String,Object> homeworkAssignSchema=new LinkedHashMap<>(homeworkDraftSchema);
            homeworkAssignSchema.put("targetType",Map.of("type","string","enum",List.of("student","group"),
                    "description","Target must match the owned source lesson's student/group"));
            homeworkAssignSchema.put("targetId",property("string","Exact student/group UUID from find_homework_targets matching source lesson"));
            homeworkAssignSchema.put("startDate",property("string","First assigned date YYYY-MM-DD, then 6 consecutive dates"));
            homeworkAssignSchema.put("confirm",Map.of("type","boolean","enum",List.of(true),
                    "description","Required explicit user approval AFTER reviewing seven PDFs"));
            homeworkAssignSchema.put("idempotencyKey",property("string","Stable key reused unchanged after uncertain assignment result"));
            tools.add(tool("assign_homework_series_from_drafts",
                    "ASSIGN ONLY AFTER EXPLICIT CONFIRMATION. Securely reuse seven server-generated, math/A4-verified homework draft PDFs as a dated seven-day series, no ChatGPT file download, Google Drive or base64. Revalidate ownership and exact day/series markers and verify saved homework via database readback. This operation may replace existing unsubmitted PDFs for a single student; show the plan before requesting approval.",
                    schema(homeworkAssignSchema,List.of("eventId","seriesKey","draftIds","targetType","targetId","startDate","confirm","idempotencyKey")),writeAnnotations()));
            tools.add(tool("generate_lesson_workbook_draft",
                    "REQUIRED: first call prepare_workbook_context for the exact owned lesson, then ChatGPT writes lessonJson using rendererContract and sends lessonJson + fresh contextToken + eventId + idempotencyKey to this tool. The server performs math QA, A4 layout and TWO unpublished PDF drafts; it does NOT generate exercise content through its own AI. Calling with only eventId/instruction is invalid. Both ADMIN and TEACHER follow this same workflow; teachers need only MCH3, not Railway. Poll get_lesson_workbook_job after retryAfterSeconds, reuse idempotencyKey for identical retries. For multiple pupils refresh signed links before presenting. Never publish without explicit approval.",
                    schema(Map.of("teacherId", property("string", "ADMIN selects teacher UUID; teachers may omit it for themselves"),
                            "eventId", property("string", "Exact lesson eventId from find_lessons"),
                            "instruction", property("string", "Optional additional lesson instructions, at most 6000 characters"),
                            "lessonJson", property("string", "REQUIRED. Full structured math content authored by ChatGPT using fresh prepare_workbook_context.rendererContract, including student workbookPages, private teacherPages and correct qa.algebra assertions. Server only renders/validates; no server AI."),
                            "contextToken", property("string", "REQUIRED. Fresh exact token from prepare_workbook_context for this lesson. Never use a remembered or stale token."),
                            "idempotencyKey", property("string", "Stable unique key for this generation; reuse unchanged on identical retries")),
                            List.of("eventId", "idempotencyKey", "lessonJson", "contextToken")), writeAnnotations()));
            if(workbookJobs!=null)tools.add(tool("get_lesson_workbook_job",
                    "Read your workbook generation job without regenerating anything. QUEUED/RUNNING means wait retryAfterSeconds and poll again. SUCCEEDED returns a saved draft with freshly signed PDF links. FAILED is terminal; explain errorCode and do not automatically spend another generation. Rechecks current account and exact lesson ownership. Never publishes.",
                    schema(Map.of("jobId",property("string","Exact jobId from generate_lesson_workbook_draft")),List.of("jobId")),readOnlyAnnotations()));
        }
        if (workbookStaff(auth) && ownerWorkbookPdfRenderService != null) {
            Map<String,Object> workbookGeneration = new LinkedHashMap<>();
            workbookGeneration.put("teacherId", property("string", "Exact teacher UUID"));
            workbookGeneration.put("eventId", property("string", "Exact lesson eventId"));
            workbookGeneration.put("contextToken", property("string", "Token returned by prepare_workbook_context, bound to the month's current plan"));
            workbookGeneration.put("lessonJson", property("string", "Structured workbook v3 JSON: meta with actual duration, workbookPages, teacherPages; not a vague AI prompt. School curriculum and evidenced errors must be used."));
            workbookGeneration.put("confirmDurationOverride", property("boolean", "OPTIONAL. True only when the teacher explicitly requests a duration different from the calendar; defaults false."));
            workbookGeneration.put("lessonPlan", property("string", "Optional concise lesson planning note for teacher draft metadata."));
            workbookGeneration.put("difficulties", property("string", "Optional evidenced difficulties, no invented errors."));
            workbookGeneration.put("idempotencyKey", property("string", "Required for TEACHER. Stable key reused on identical retries; ADMIN legacy calls may omit it."));
            tools.add(tool("generate_workbook",
                    "Compatibility alias for structured server-side rendering. Prefer generate_lesson_workbook_draft. TEACHER must provide a fresh contextToken from prepare_workbook_context and a stable idempotencyKey, and can render only their own lesson. ADMIN legacy calls may omit the token/key; current context is still read before rendering. Produces two unpublished vector-math/SVG PDFs with mandatory QA; never publishes.",
                    schema(workbookGeneration, List.of("eventId","lessonJson")),
                    writeAnnotations()));
        }
        tools.add(tool("get_brand_guide", "Get the current administrator-managed Mindcrafti Brand Guide, including its searchable rules and the uploaded source PDF as base64 when available. ALWAYS use this before creating or redesigning any Mindcrafti-branded PDF, homework, diagnostic, worksheet, report, presentation, work-on-mistakes document or other visual material. Fetch it fresh instead of relying on a Brand Guide remembered from chat history.", schema(Map.of(), List.of()), readOnlyAnnotations()));

        tools.add(tool("get_story_template_info", "Get the current APPROVED Mindcrafti Instagram Stories master PPTX metadata. Always call before producing 3 Mindcrafti Stories. The master has 3 slides and its photo, decoration, logo, graphic positions and typography must stay unchanged. Use the current version and SHA256, never prior chat copies.", schema(Map.of(), List.of()), readOnlyAnnotations()));
        tools.add(tool("get_story_template_download_link", "Get a short-lived, signed HTTPS link to the exact approved PPTX. First call get_story_template_info. Download the file using the returned URL within 5 minutes and verify SHA256 before editing. Prefer this tool to base64 chunks when a downloader is available.", schema(Map.of(), List.of()), readOnlyAnnotations()));
        tools.add(tool("get_story_template_chunk", "Download an exact binary chunk of the CURRENT approved three-slide PPTX. First call get_story_template_info; get each chunk using the returned version; concatenate decoded base64 chunks in order and validate the SHA256. Do not regenerate the design from screenshots.", schema(Map.of("version", property("integer", "Current master revision from get_story_template_info."), "chunkIndex", property("integer", "Zero-based index, start at 0; repeat until chunkCount is reached.")), List.of("version", "chunkIndex")), readOnlyAnnotations()));
        tools.add(tool("update_story_template_master", "ADMIN ONLY: Replace the approved three-slide Mindcrafti Stories PPTX. Requires explicit user approval and the expected version from get_story_template_info. The source file must have exactly three slides. The replaced file becomes the only master for all subsequent Stories.", schema(Map.of("filename", property("string", "New PPTX filename."), "pptxBase64", property("string", "Full PPTX binary encoded as base64, up to 15 MB."), "expectedVersion", property("integer", "Latest template version.")), List.of("filename", "pptxBase64", "expectedVersion")), writeAnnotations()));
        Map<String,Object> cdp = new LinkedHashMap<>();
        cdp.put("teacherId",property("string","Teacher UUID from find_lessons"));
        cdp.put("eventId",property("string","Exact calendar event ID"));
        cdp.put("lessonJson",property("string","Preferred: structured Mindcrafti workbook JSON with meta, workbookPages and teacherPages for the canonical SVG generator. Legacy simple shape title + tasks remains supported. No homework."));
        cdp.put("contextToken",property("string","Required for TEACHER: fresh prepare_workbook_context token. ADMIN legacy callers may omit it."));
        cdp.put("idempotencyKey",property("string","Required for TEACHER: stable key for this exact draft request. ADMIN legacy callers may omit it."));
        tools.add(tool("create_lesson_draft","Compatibility draft endpoint; prefer generate_lesson_workbook_draft. Structured workbook JSON uses the canonical SVG/math renderer; legacy simple task JSON remains supported. TEACHER is restricted to own lessons and must provide fresh contextToken plus idempotencyKey. ADMIN may select an accessible teacher and omit token/key for legacy compatibility; fresh context is still read. Never publishes.",schema(cdp,List.of("eventId","lessonJson")),writeAnnotations()));
        Map<String,Object> dp = Map.of("teacherId",property("string","Teacher UUID"),"draftId",property("string","Draft UUID"));
        tools.add(tool("get_lesson_draft","Get draft metadata and refresh the five-minute signed workbook/answers PDF download links. Prefer these URLs for preview/download without base64. Staff and exact lesson ownership are checked again on download.",schema(dp,List.of("draftId")),readOnlyAnnotations()));
        Map<String,Object> dd = new LinkedHashMap<>(dp);
        dd.put("kind",property("string","workbook or answers"));
        tools.add(tool("download_lesson_draft_pdf","Download student or teacher PDF for review. Legacy base64 transport is retained; prefer signed PDF URLs returned by get_lesson_draft or generation to avoid manual base64 handling.",schema(dd,List.of("draftId","kind")),readOnlyAnnotations()));
        Map<String,Object> pd = new LinkedHashMap<>(dp);
        pd.put("confirm",property("boolean","True only on explicit user instruction to publish approved documents"));
        pd.put("idempotencyKey",property("string","Stable key for this exact approved draft publication; reuse on identical retries"));
        tools.add(tool("publish_lesson_draft","Attach the exact two approved PDFs to the owned lesson after confirm=true and explicit user instruction. Replaces the workbook/answers slots, preserves unrelated lesson data and re-reads filenames/status. For PDFs generated or attached in ChatGPT, prefer direct file input. Do not upload to Google Drive as an intermediate step. Use Google Drive only when the source document already exists there.",schema(pd,List.of("draftId","confirm","idempotencyKey")),writeAnnotations()));
        tools.add(tool("find_lessons", "Find Mindcrafti schedule lessons, including lessons created on the website without Google Calendar. Admins can search accessible teachers; teachers search only their own lessons. Returns exact eventId and Berlin local date/time. To schedule a new lesson use create_lesson or create_lesson_series; preparation/draft tools only manage teaching materials.", schema(Map.of("query", property("string", "Optional student, group, or event title filter.")), List.of()), readOnlyAnnotations()));
        tools.add(tool("find_trial_lessons", "Find trial/diagnostic lessons. Admins can search trial lessons across the whole school; teachers see only their own. Returns the concrete teacherId/eventId and whether an original transcript PDF is stored, so download_lesson_transcript can be used next.", schema(Map.of("query", property("string", "Optional teacher name, lesson title, phone number or date text filter.")), List.of()), readOnlyAnnotations()));
        tools.add(tool("get_lesson_preparation", "Read lesson metadata, homework notes, difficulties, lesson plan, and which PDF documents are attached. For full saved transcript text, inspect get_site_function(functionId=lesson_transcripts.get), then read_site_function with its paginated source selector. Uploaded PDF download remains available separately.", schema(Map.of("teacherId", property("string", "Teacher UUID returned by find_lessons."), "eventId", property("string", "Google Calendar event ID returned by find_lessons.")), List.of("teacherId", "eventId")), readOnlyAnnotations()));
        tools.add(tool("download_lesson_pdf", "Download one shared lesson PDF directly from Mindcrafti: the common workbook, shared teacher answers, or transcript. This does not select a pupil's private worksheet or private answers. Returns the PDF as base64 so it can be saved or reused without Google Drive.", schema(Map.of("teacherId", property("string", "Teacher UUID returned by find_lessons."), "eventId", property("string", "Google Calendar event ID returned by find_lessons."), "kind", property("string", "PDF kind: workbook, answers or transcript.")), List.of("teacherId", "eventId", "kind")), readOnlyAnnotations()));
        tools.add(tool("download_lesson_transcript", "Download the original uploaded transcript PDF stored on one lesson. This does not generate a PDF from automatic text. To inspect saved automatic/manual text or extract uploaded PDF text, discover lesson_transcripts.get through get_site_function and read_site_function.", schema(Map.of("teacherId", property("string", "Teacher UUID returned by find_lessons."), "eventId", property("string", "Google Calendar event ID returned by find_lessons.")), List.of("teacherId", "eventId")), readOnlyAnnotations()));
        tools.add(tool("audit_lesson_transcripts", "Admin-only, read-only. Audit every stored lesson transcript across the school and report wrong lesson/date links plus legacy filenames that cannot be verified automatically.", schema(Map.of(), List.of()), readOnlyAnnotations()));

        Map<String, Object> prepareProperties = new LinkedHashMap<>();
        prepareProperties.put("teacherId", property("string", "Teacher UUID returned by find_lessons."));
        prepareProperties.put("eventId", property("string", "Google Calendar event ID returned by find_lessons."));
        prepareProperties.put("homeworkNotes", property("string", "Homework completion/status and relevant notes for the teacher."));
        prepareProperties.put("difficulties", property("string", "Observed gaps, recurring errors, or difficulties to address."));
        prepareProperties.put("lessonPlan", property("string", "Concise plan for the lesson."));
        prepareProperties.put("workbookFile", ChatGptPdfResolver.fileSchema());
        prepareProperties.put("answersFile", ChatGptPdfResolver.fileSchema());
        prepareProperties.put("idempotencyKey", property("string", "Stable key for this requested preparation. Required with workbookFile or answersFile; reuse on identical retries, including when the temporary download URL changes. Optional for legacy base64, Drive and notes-only requests."));
        prepareProperties.put("workbookBase64", property("string", "Legacy workbook PDF bytes encoded as base64. Prefer workbookFile for a PDF already attached in ChatGPT. Supply at most one workbook source."));
        prepareProperties.put("workbookFilename", property("string", "Optional workbook PDF filename. Also used to find the file in the selected teacher's Drive if a connector file id is not directly readable."));
        prepareProperties.put("answersBase64", property("string", "Legacy teacher-answers PDF bytes encoded as base64. Prefer answersFile for a PDF already attached in ChatGPT. Supply at most one answers source."));
        prepareProperties.put("answersFilename", property("string", "Optional teacher-answer PDF filename. Also used for Drive fallback lookup."));
        prepareProperties.put("driveWorkbookFileId", property("string", "Optional Google Drive PDF raw file ID or Drive URL for the workbook. Mindcrafti uses the selected teacher's Google access if the school account cannot read it."));
        prepareProperties.put("driveAnswersFileId", property("string", "Optional Google Drive PDF raw file ID or Drive URL for teacher answers. Mindcrafti uses the selected teacher's Google access if the school account cannot read it."));
        tools.add(fileTool("prepare_lesson", "Create or update lesson preparation for the selected teacher. Its common workbook appears on Shared board and on each pupil's My board unless that pupil has a private worksheet assigned with upload_personal_lesson_workbook. Private worksheets and their annotations are preserved. Admins can write to any teacher lesson. Prefer workbookFile and answersFile for PDFs attached in ChatGPT, with school OAuth and a stable idempotencyKey; no Google Drive intermediate is needed. Legacy base64 and teacher-scoped Drive imports remain supported. Each PDF slot accepts at most one source; omitted slots and notes remain unchanged.", schema(prepareProperties, List.of("teacherId", "eventId")), writeAnnotations(), List.of("workbookFile", "answersFile")));

        if (personalLessonWorkbookService != null && personalWorkbookActorAllowed(auth)) {
            if(personalDrafts!=null)tools.add(tool("publish_personal_lesson_draft",
                    "After the user's explicit upload instruction, attach an already reviewed server-generated draft directly to ONE named lesson pupil: both personal worksheet and private teacher answers atomically. Preferred for PDFs from generate_lesson_workbook_draft/get_lesson_draft. Pass the saved draftId, exact lesson and pupil IDs. No downloading, base64, ChatGPT file objects, widget or Google Drive. Replaces only this pupil's PDFs; preserves shared materials and other pupils. Requires confirm=true and a stable idempotencyKey; exact retries reuse the receipt. Rechecks current teacher/lesson/roster and reads back filenames and sizes. Source draft remains reusable.",
                    schema(Map.of("teacherId",property("string","Exact lesson teacher UUID"),"eventId",property("string","Exact owned lesson eventId"),
                            "studentId",property("string","Exact current participant from list_personal_lesson_workbooks"),
                            "draftId",property("string","Exact reviewed saved draft for this teacher and lesson"),
                            "idempotencyKey",property("string","Stable key for this approved attachment; reuse on identical retries"),
                            "confirm",Map.of("type","boolean","enum",List.of(true))),
                            List.of("teacherId","eventId","studentId","draftId","idempotencyKey","confirm")),writeAnnotations()));
            Map<String, Object> personalProperties = new LinkedHashMap<>();
            personalProperties.put("teacherId", property("string", "Exact teacher UUID returned by find_lessons. Teachers access only their own lessons; ADMIN selects an accessible teacher."));
            personalProperties.put("eventId", property("string", "Exact eventId returned by find_lessons."));
            tools.add(tool("list_personal_lesson_workbooks",
                    "Staff-only list of the lesson's current students, their individual worksheet metadata and private teacher-answer status (hasAnswers, answersFilename, answersVersion). A pupil's assigned private PDF takes priority in My board; otherwise My board uses the common workbook or stays blank. Shared board keeps the common workbook for everyone. No answer PDF bytes are returned. OAuth teacher or ADMIN only; teachers access only their own lessons. Import API keys and students cannot use this tool.",
                    schema(personalProperties, List.of("teacherId", "eventId")), readOnlyAnnotations()));
            Map<String, Object> personalUpload = new LinkedHashMap<>(personalProperties);
            personalUpload.put("studentId", property("string", "Exact student UUID from list_personal_lesson_workbooks. Only a current participant of this exact lesson may receive the PDF."));
            personalUpload.put("filename", property("string", "Personal worksheet PDF filename. Optional with pdfFile, using file_name or a safe default; required for legacy base64 and Drive."));
            personalUpload.put("pdfFile", ChatGptPdfResolver.fileSchema());
            personalUpload.put("pdfBase64", property("string", "Legacy PDF bytes encoded as base64, up to 15 MB. Provide exactly one of pdfFile, pdfBase64 or driveFileId."));
            personalUpload.put("driveFileId", property("string", "Optional Google Drive PDF ID or URL readable by the selected teacher. Provide exactly one of pdfFile, pdfBase64 or driveFileId."));
            personalUpload.put("idempotencyKey", property("string", "Stable key for this explicitly requested upload. Reuse the same key and arguments for identical retries; use a new key only for a new requested upload."));
            tools.add(fileTool("upload_personal_lesson_workbook",
                    "Upload or replace one student's private PDF. It takes priority over the common workbook in that pupil's My board (Моя доска). Shared board keeps the common workbook for everyone, and other pupils are unchanged. The existing personal-workbook-<studentUserId> annotation scope is preserved; common-workbook annotations remain separate. This does not assign homework. Only the owning teacher and that admitted student can read the private worksheet in class. OAuth teacher or ADMIN only, restricted to the selected teacher's own lessons. Prefer pdfFile for a ChatGPT attachment without a Google Drive intermediate. Supply exactly one of pdfFile, pdfBase64 or driveFileId and retry with the same idempotencyKey.",
                    personalPdfSourcesSchema(personalUpload), writeAnnotations(), List.of("pdfFile")));
            if (personalLessonAnswersService != null) {
                Map<String, Object> personalAnswers = new LinkedHashMap<>(personalUpload);
                personalAnswers.put("filename", property("string", "Private teacher-answer PDF filename for this student's personal worksheet."));
                tools.add(fileTool("upload_personal_lesson_answers",
                        "Upload or replace the private teacher-answer PDF for one student's personal worksheet. Only staff can read the answers; no answer bytes or metadata are exposed through student classroom routes. This preserves the student's worksheet and the lesson's shared answers. OAuth teacher or ADMIN only, restricted to the selected teacher's own lessons. Prefer pdfFile for an attached ChatGPT PDF, without a Google Drive intermediate. Provide exactly one of pdfFile, pdfBase64 or driveFileId and reuse the same idempotencyKey on identical retries. Returns private answer metadata only.",
                        personalPdfSourcesSchema(personalAnswers), writeAnnotations(), List.of("pdfFile")));
            }
        }

        Map<String, Object> answerProperties = new LinkedHashMap<>();
        answerProperties.put("teacherId", property("string", "Teacher UUID returned by find_lessons."));
        answerProperties.put("eventId", property("string", "Google Calendar event ID returned by find_lessons."));
        answerProperties.put("driveFileId", property("string", "Google Drive raw file ID or Drive URL containing teacher answers."));
        answerProperties.put("filename", property("string", "Optional PDF filename. Used for Drive fallback lookup."));
        tools.add(tool("attach_lesson_answers", "Copy a teacher-answer PDF from Google Drive into one concrete lesson, using the selected teacher's Drive access when needed.", schema(answerProperties, List.of("teacherId", "eventId", "driveFileId")), writeAnnotations()));

        Map<String, Object> transcriptProperties = new LinkedHashMap<>();
        transcriptProperties.put("teacherId", property("string", "Teacher UUID returned by find_lessons."));
        transcriptProperties.put("eventId", property("string", "Google Calendar event ID returned by find_lessons."));
        transcriptProperties.put("driveFileId", property("string", "Google Drive raw file ID or Drive URL containing the transcript PDF."));
        transcriptProperties.put("filename", property("string", "Optional transcript PDF filename. Used for Drive fallback lookup."));
        tools.add(tool("attach_lesson_transcript", "Copy the original Soniox transcript PDF from Google Drive into one concrete Mindcrafti lesson. Mindcrafti validates the date/time in the original filename against the selected event before attaching it.", schema(transcriptProperties, List.of("teacherId", "eventId", "driveFileId", "filename")), writeAnnotations()));

        Map<String, Object> targetProperties = new LinkedHashMap<>();
        targetProperties.put("query", property("string", "Optional student or group name filter, for example Виталина, Christian or Группа 1."));
        targetProperties.put("teacherId", property("string", "Optional teacher UUID. Teachers never need it. Admins may omit it to search across every active teacher."));
        tools.add(tool("find_homework_targets", "Find students and groups that can receive homework. Admins search all active teachers by default. Every result includes teacherId and teacherName so it can be used directly for follow-up actions.", schema(targetProperties, List.of()), readOnlyAnnotations()));

        Map<String, Object> monthPlanProperties = new LinkedHashMap<>();
        monthPlanProperties.put("teacherId", property("string", "Optional teacher UUID. Teachers never need it. Admins may omit it when targetId identifies one teacher uniquely."));
        monthPlanProperties.put("targetType", property("string", "Monthly plan target type: student or group."));
        monthPlanProperties.put("targetId", property("string", "Student or group UUID."));
        monthPlanProperties.put("month", property("string", "Plan month in YYYY-MM format."));
        tools.add(tool("get_month_plan", "Read the current structured monthly teaching plan for one student or group. Use it before preparing the next lesson when the target has a plan for the current month.", schema(monthPlanProperties, List.of("targetType", "targetId", "month")), readOnlyAnnotations()));
        monthPlanProperties.put("planJson", property("string", "Complete monthly plan encoded as a JSON object string. This replaces the current saved plan for the target and month."));
        tools.add(tool("update_month_plan", "Create or replace the structured monthly teaching plan for one student or group. Use this when the teacher asks to save or change the plan.", schema(monthPlanProperties, List.of("targetType", "targetId", "month", "planJson")), writeAnnotations()));

        Map<String, Object> seriesProperties = new LinkedHashMap<>();
        seriesProperties.put("teacherId", property("string", "Optional teacher UUID. Teachers never need it. Admins may omit it and Mindcrafti will infer the teacher from targetId when the target is unique."));
        seriesProperties.put("targetType", property("string", "Target type: student or group."));
        seriesProperties.put("targetId", property("string", "Student or group UUID returned by find_homework_targets."));
        seriesProperties.put("startDate", property("string", "First homework date in YYYY-MM-DD format."));
        seriesProperties.put("days", property("integer", "Number of consecutive calendar days to assign, from 1 to 31."));
        seriesProperties.put("pdfBase64", arrayProperty("Preferred when the PDFs are already in ChatGPT: PDF bytes encoded as base64. Supply one PDF for all days or exactly one PDF per day. Maximum 15 MB per PDF. Do not also pass driveFileIds."));
        seriesProperties.put("driveFileIds", arrayProperty("Optional legacy/fallback Google Drive PDF file IDs. Supply one PDF for all days or exactly one PDF per day. Do not also pass pdfBase64."));
        seriesProperties.put("filenames", arrayProperty("Optional display filenames: empty, one filename for all days, or one filename per day."));
        tools.add(tool("assign_homework_series", "Assign dated PDF homework for several consecutive days to one student or every active student in a group. Prefer pdfBase64 for PDFs created or already available in ChatGPT, so no intermediate Google Drive upload is needed. driveFileIds remains available as a fallback. Admins may omit teacherId when targetId identifies one teacher uniquely. Existing PDF homework on the same student/date is skipped to avoid duplicates.", schema(seriesProperties, List.of("targetType", "targetId", "startDate", "days")), writeAnnotations()));

        tools.add(tool("list_school_teachers", "List teachers visible to the signed-in account, including each teacher's student count. Admins see the whole school; a teacher sees only themselves.", schema(Map.of(), List.of()), readOnlyAnnotations()));

        Map<String, Object> studentSearchProperties = new LinkedHashMap<>();
        studentSearchProperties.put("query", property("string", "Optional student name, username, email or teacher-name search."));
        studentSearchProperties.put("teacherId", property("string", "Optional teacher UUID. Admins can filter by teacher. Teachers can only use their own teacher ID."));
        tools.add(tool("find_students", "Find students for analytics and homework-file access. Returns studentId and teacher details for follow-up tools. Admins can search every student; teachers are restricted to their own students.", schema(studentSearchProperties, List.of()), readOnlyAnnotations()));

        Map<String, Object> homeworkRangeProperties = new LinkedHashMap<>();
        homeworkRangeProperties.put("studentId", property("string", "Student UUID returned by find_students."));
        homeworkRangeProperties.put("fromDate", property("string", "First assigned-homework date in YYYY-MM-DD."));
        homeworkRangeProperties.put("toDate", property("string", "Last assigned-homework date in YYYY-MM-DD. Maximum range is 366 days."));
        tools.add(tool("find_student_homeworks", "Find all homework buckets for one student in an inclusive date range. Returns submission status and homeworkId values that can be passed directly to get_homework_submission or get_homework_submission_pages.", schema(homeworkRangeProperties, List.of("studentId", "fromDate", "toDate")), readOnlyAnnotations()));

        Map<String, Object> replaceHomeworkProperties = new LinkedHashMap<>();
        replaceHomeworkProperties.put("homeworkId", property("string", "Existing homework UUID returned by find_student_homeworks or get_student_homework_history."));
        replaceHomeworkProperties.put("pdfBase64", property("string", "Replacement assigned-homework PDF encoded as base64. Maximum 15 MB."));
        replaceHomeworkProperties.put("filename", property("string", "Optional display filename for the replacement PDF. The current filename is preserved when omitted."));
        tools.add(tool("replace_homework", "Replace the assigned PDF of one existing unsubmitted homework while preserving its homework ID and assigned date. Use this when the wrong PDF was assigned and must be corrected. Submitted homework cannot be replaced.", schema(replaceHomeworkProperties, List.of("homeworkId", "pdfBase64")), destructiveWriteAnnotations()));

        Map<String, Object> updateHomeworkProperties = new LinkedHashMap<>();
        updateHomeworkProperties.put("homeworkId", property("string", "Existing homework UUID returned by find_student_homeworks or get_student_homework_history."));
        updateHomeworkProperties.put("newStartDate", property("string", "Optional replacement assigned date in YYYY-MM-DD format. Date changes are blocked when the homework contains cards."));
        updateHomeworkProperties.put("pdfBase64", property("string", "Optional replacement assigned-homework PDF encoded as base64. Maximum 15 MB."));
        updateHomeworkProperties.put("filename", property("string", "Optional display filename used when pdfBase64 is provided. The current filename is preserved when omitted."));
        tools.add(tool("update_homework", "Update one existing unsubmitted homework. You may change its assigned date, replace its assigned PDF, or do both in one call. At least one of newStartDate or pdfBase64 is required.", schema(updateHomeworkProperties, List.of("homeworkId")), destructiveWriteAnnotations()));

        Map<String, Object> deleteHomeworkProperties = new LinkedHashMap<>();
        deleteHomeworkProperties.put("homeworkId", property("string", "Existing homework UUID returned by find_student_homeworks or get_student_homework_history."));
        deleteHomeworkProperties.put("confirm", property("boolean", "Must be true. Confirms permanent deletion of the homework record and stored PDFs. Homework containing cards cannot be deleted."));
        tools.add(tool("delete_homework", "Permanently delete one existing homework. Requires confirm=true and should only be used after an explicit teacher/admin deletion request. Homework containing cards cannot be deleted.", schema(deleteHomeworkProperties, List.of("homeworkId", "confirm")), destructiveWriteAnnotations()));

        Map<String, Object> recentHomeworkProperties = new LinkedHashMap<>();
        recentHomeworkProperties.put("studentId", property("string", "Student UUID returned by find_students."));
        recentHomeworkProperties.put("limit", property("integer", "Optional number of submitted homework PDFs to return, 1 to 10. Defaults to 5."));
        tools.add(tool("get_recent_homework_submissions", "Get the newest submitted PDF homeworks directly from Mindcrafti, newest first. Also identifies the student's latest completed lesson from the connected teacher calendar and separately returns submissions made after that lesson. Use this for requests such as latest homework, last 3 or 5 homeworks, or homework submitted after the last lesson.", schema(recentHomeworkProperties, List.of("studentId")), readOnlyAnnotations()));

        Map<String, Object> homeworkPdfProperties = new LinkedHashMap<>();
        homeworkPdfProperties.put("homeworkId", property("string", "Homework UUID returned by find_student_homeworks, get_recent_homework_submissions or get_student_homework_history."));
        tools.add(tool("get_homework_submission", "Get the student's actual submitted homework PDF directly from the Mindcrafti database, without Google Drive. Returns filename, submission time and PDF bytes as base64.", schema(homeworkPdfProperties, List.of("homeworkId")), readOnlyAnnotations()));
        tools.add(tool("download_homework_submission_pdf", "Backward-compatible alias for get_homework_submission. Downloads the student's actual submitted homework PDF directly from the Mindcrafti database.", schema(homeworkPdfProperties, List.of("homeworkId")), readOnlyAnnotations()));

        Map<String, Object> homeworkPageProperties = new LinkedHashMap<>();
        homeworkPageProperties.put("homeworkId", property("string", "Homework UUID returned by find_student_homeworks or get_recent_homework_submissions."));
        homeworkPageProperties.put("startPage", property("integer", "Optional 1-based first page to render. Defaults to 1."));
        homeworkPageProperties.put("pageCount", property("integer", "Optional number of pages to render, 1 to 8. Defaults to 1. Use nextStartPage to continue."));
        tools.add(tool("get_homework_submission_pages", "Render pages of the student's actual submitted PDF as PNG images for visual inspection of handwriting, photos and annotations. Returns image bytes as base64 plus page dimensions and nextStartPage for pagination.", schema(homeworkPageProperties, List.of("homeworkId")), readOnlyAnnotations()));

        Map<String, Object> dayProperties = new LinkedHashMap<>();
        dayProperties.put("date", property("string", "School date in YYYY-MM-DD. Use yesterday for a morning report about the previous day."));
        dayProperties.put("teacherId", property("string", "Optional teacher UUID. Admins can filter the school report by one teacher. Teachers are always restricted to themselves."));
        tools.add(tool("get_school_day_summary", "Get a school-day summary for morning 08:00 homework reporting: includes per-student PDF submissions, outstanding worksheets, worksheetAssignments with filename and homeworkActiveMinutes per assignment, cardActiveMinutes, first-try accuracy and errors. Use yesterday for a morning report and treat zero time as no measured website time, not proof of no offsite work. Admins see all; teachers see own students.", schema(dayProperties, List.of("date")), readOnlyAnnotations()));

        Map<String, Object> studentPeriodProperties = new LinkedHashMap<>();
        studentPeriodProperties.put("studentId", property("string", "Student UUID returned by find_students."));
        studentPeriodProperties.put("fromDate", property("string", "First date in YYYY-MM-DD."));
        studentPeriodProperties.put("toDate", property("string", "Last date in YYYY-MM-DD. Maximum range is 366 days."));
        tools.add(tool("get_student_activity", "Get student summary for a date range with homework submissions, lateness, cardActiveMinutes and homeworkActiveMinutes (measured active site time), plus original elapsed cardStudyMinutes, review days and errors. Teachers only read their own students.", schema(studentPeriodProperties, List.of("studentId", "fromDate", "toDate")), readOnlyAnnotations()));
        tools.add(tool("get_student_homework_history", "Get student homework buckets with PDF status, submission, card counts, estimated homeworkActiveMinutes for each homework (measured on-site time, excludes paper) and completed card sessions. Teachers only read their students.", schema(studentPeriodProperties, List.of("studentId", "fromDate", "toDate")), readOnlyAnnotations()));

        Map<String, Object> sessionProperties = new LinkedHashMap<>();
        sessionProperties.put("sessionId", property("string", "Card study-session UUID returned by a summary or student activity tool."));
        tools.add(tool("get_card_session_details", "Inspect card session with elapsed duration including breaks, cardActiveMinutes excluding idle/background time, all answers and errors. Teachers only inspect sessions belonging to their own students.", schema(sessionProperties, List.of("sessionId")), readOnlyAnnotations()));

        Map<String, Object> funnelProperties = new LinkedHashMap<>();
        funnelProperties.put("fromDate", property("string", "First date in YYYY-MM-DD. One report can cover up to 90 days."));
        funnelProperties.put("toDate", property("string", "Last date in YYYY-MM-DD. Maximum range is 90 days."));
        funnelProperties.put("recentLimit", property("integer", "Optional number of recent visitor sessions with detailed timelines to return, 1 to 100. Defaults to 50."));
        tools.add(tool("get_public_funnel_analytics", "Admin-only. Analyze the public website acquisition funnel: visits, conversion at every step, drop-offs, traffic sources, devices, time spent, bookings, contracts and recent visitor timelines. Use this when the administrator asks how advertising traffic or the website funnel is performing.", schema(funnelProperties, List.of("fromDate", "toDate")), readOnlyAnnotations()));
        return tools;
    }

    private Map<String, Object> callTool(Map<String, Object> request, AuthContext auth) throws Exception {
        Map<String, Object> params = map(request.get("params"));
        String name = string(params.get("name"));
        Map<String, Object> arguments = map(params.get("arguments"));
        if ("mindcrafti_status".equals(name)) {
            Map<String, Object> status = new LinkedHashMap<>();
            status.put("status", "ok");
            status.put("service", SERVER_NAME);
            status.put("version", SERVER_VERSION);
            status.put("authenticated", auth.authenticated());
            status.put("mode", auth.authenticated() ? "full" : "diagnostic");
            status.put("authentication", auth.apiKey() ? "api_key" : auth.user() != null ? "oauth" : "none");
            if (auth.user() != null) status.put("role", auth.user().getRole().name());
            List<String> visibleNames = new ArrayList<>(tools(auth).stream()
                    .map(tool -> String.valueOf(tool.get("name"))).toList());
            // These two existing admin tools are appended by the HTTP bridges
            // to tools/list. Report the same catalog in the status response.
            if (auth.user() != null && auth.user().getRole() == Role.ADMIN && !auth.apiKey()) {
                visibleNames.add("update_school_prompt");
                visibleNames.add("update_brand_guide");
            }
            if(auth.user()!=null && workbookJobs!=null)
                status.put("workbookQueue",workbookJobs.capacity(auth.user()));
            status.put("availableToolCount", visibleNames.size());
            status.put("availableToolNames", visibleNames);
            return toolResult(status);
        }
        if ("test_mch3_ui_modern".equals(name) || "test_mch3_ui_legacy".equals(name)) {
            try {
                return testUiDiagnostic(name, arguments, auth);
            } catch (Exception failure) {
                return siteToolFailure(failure);
            }
        }
        if (!auth.authenticated()) throw new IllegalArgumentException("This Mindcrafti tool requires authentication");
        if ("assign_homework_series_file_transfer".equals(name) || "complete_homework_series_file_transfer".equals(name)) {
            try {
                return "assign_homework_series_file_transfer".equals(name)
                        ? prepareHomeworkFileTransfer(arguments, auth)
                        : toolResult(completeHomeworkFileTransfer(arguments, auth));
            } catch (Exception failure) {
                return siteToolFailure(failure);
            }
        }
        if ("prepare_lesson_file_transfer".equals(name) || "complete_lesson_file_transfer".equals(name)) {
            try {
                return "prepare_lesson_file_transfer".equals(name)
                        ? prepareLessonFileTransfer(arguments, auth)
                        : toolResult(completeLessonFileTransfer(arguments, auth));
            } catch (Exception failure) {
                return siteToolFailure(failure);
            }
        }
        if ("list_personal_lesson_workbooks".equals(name) || "upload_personal_lesson_workbook".equals(name)
                || "upload_personal_lesson_answers".equals(name)) {
            try {
                return toolResult(personalLessonWorkbooks(name, arguments, auth));
            } catch (Exception failure) {
                return siteToolFailure(failure);
            }
        }
        if ("prepare_lesson".equals(name)) {
            try {
                return toolResult(prepareLesson(arguments, auth));
            } catch (Exception failure) {
                return siteToolFailure(failure);
            }
        }
        if (McpTeacherGuideService.TOOL.equals(name) || McpTeacherGuideService.SHOW_TOOL.equals(name)) {
            try {
                if(!fileTransferActorAllowed(auth))throw new org.springframework.security.access.AccessDeniedException("School OAuth teacher or administrator sign-in is required");
                if(teacherGuideService==null)throw new IllegalStateException("Teacher guide is unavailable");
                return McpTeacherGuideService.SHOW_TOOL.equals(name)
                    ? teacherGuideService.show(auth.user(),auth.apiKey(),arguments)
                    : teacherGuideService.call(auth.user(),auth.apiKey(),arguments);
            }catch(Exception failure){return siteToolFailure(failure);}
        }
        if (McpLessonScheduleService.handles(name) || McpSiteFunctionsService.handles(name)) {
            try {
                if (auth.apiKey() || auth.user() == null)
                    throw new org.springframework.security.access.AccessDeniedException("School OAuth sign-in is required");
                if (McpLessonScheduleService.handles(name)) {
                    if (lessonScheduleService == null) throw new IllegalStateException("Scheduling is unavailable");
                    return toolResult(lessonScheduleService.call(name, arguments, auth.user(), auth.apiKey()));
                }
                // Existing ChatGPT installations can still invoke four new homework
                // operations through their PRE-EXISTING site function bridge tools.
                // They do not need to re-install MCH3 or expose new tool schemas.
                if (homeworkBridgeRequest(name,arguments))
                    return toolResult(homeworkBridge(name,arguments,auth));
                if (siteFunctionsService == null) throw new IllegalStateException("Website functions are unavailable");
                return toolResult(siteFunctionsService.call(name, arguments, auth.user(), auth.apiKey()));
            } catch (Exception failure) {
                return siteToolFailure(failure);
            }
        }
        if (SkillBoardMcpService.TOOL_NAMES.contains(name))
            return skillBoardMcpService.call(name, arguments, auth.user());
        if (SkillMasteryMcpService.TOOL_NAMES.contains(name))
            return skillMasteryMcpService.call(name, arguments, auth.user());
        if (PersonalNutritionMcpService.TOOL_NAMES.contains(name)) {
            if (auth.apiKey() || auth.user() == null || auth.user().getRole() != Role.ADMIN)
                throw new IllegalArgumentException("Personal nutrition is restricted to a signed-in Mindcrafti ADMIN.");
            return toolResult(personalNutritionMcpService.call(name, arguments, auth.user().getId()));
        }
        return switch (name) {
            case "get_school_prompt" -> toolResult(getSchoolPrompt(arguments));
            case "get_owner_workbook_generator" -> {
                if (ownerWorkbookGeneratorService == null || !ownerWorkbookGeneratorService.allowed(auth.user(), auth.apiKey()))
                    throw new IllegalArgumentException("Workbook generator source retrieval is restricted to an OAuth administrator");
                yield toolResult(ownerWorkbookGeneratorService.source(string(arguments.get("file"))));
            }
            case "get_brand_guide" -> toolResult(schoolBrandGuideService.readForMcp());
            case "prepare_homework_context" -> toolResult(prepareHomeworkContext(arguments,auth));
            case "generate_homework_day_draft" -> toolResult(generateHomeworkDayDraft(arguments,auth));
            case "review_homework_series_drafts" -> toolResult(reviewHomeworkSeriesDrafts(arguments,auth));
            case "assign_homework_series_from_drafts" -> toolResult(assignHomeworkSeriesFromDrafts(arguments,auth));
            case "prepare_workbook_context" -> {
                requireWorkbookStaff(auth);
                yield toolResult(prepareWorkbookContext(arguments, auth));
            }
            case "generate_lesson_workbook_draft" -> toolResult(generateLessonWorkbookDraft(arguments, auth));
            case "get_lesson_workbook_job" -> toolResult(workbookJobStatus(arguments,auth));
            case "publish_personal_lesson_draft" -> toolResult(publishPersonalDraft(arguments,auth));
            case "generate_workbook" -> {
                requireWorkbookStaff(auth);
                yield toolResult(generateWorkbookCompatibility(arguments, auth));
            }
            case "create_lesson_draft" -> toolResult(createLessonDraft(arguments,auth));
            case "get_lesson_draft" -> toolResult(draftInfo(arguments,auth));
            case "download_lesson_draft_pdf" -> toolResult(draftDownload(arguments,auth));
            case "publish_lesson_draft" -> toolResult(publishLessonDraft(arguments,auth));
            case "get_story_template_info" -> toolResult(storyTemplateMasterService.infoForMcp(auth.user(), auth.apiKey()));
            case "get_story_template_download_link" -> toolResult(storyTemplateDownloadLinkService.create(auth.user(), auth.apiKey()));
            case "get_story_template_chunk" -> toolResult(storyTemplateMasterService.chunkForMcp(auth.user(), auth.apiKey(), Long.parseLong(required(arguments, "version")), integer(arguments.get("chunkIndex"), "chunkIndex")));
            case "update_story_template_master" -> toolResult(storyTemplateMasterService.uploadFromMcp(auth.user(), auth.apiKey(), required(arguments, "filename"), required(arguments, "pptxBase64"), Long.parseLong(required(arguments, "expectedVersion"))));
            case "find_lessons" -> toolResult(findLessons(string(arguments.get("query")), auth));
            case "find_trial_lessons" -> toolResult(findTrialLessons(string(arguments.get("query")), auth));
            case "get_lesson_preparation" -> toolResult(getPreparation(arguments, auth));
            case "download_lesson_pdf" -> toolResult(downloadLessonPdf(arguments, auth));
            case "download_lesson_transcript" -> toolResult(downloadLessonTranscript(arguments, auth));
            case "audit_lesson_transcripts" -> toolResult(auditLessonTranscripts(auth));
            case "attach_lesson_answers" -> toolResult(attachLessonAnswers(arguments, auth));
            case "attach_lesson_transcript" -> toolResult(attachLessonTranscript(arguments, auth));
            case "find_homework_targets" -> toolResult(findHomeworkTargets(arguments, auth));
            case "get_month_plan" -> toolResult(getMonthPlan(arguments, auth));
            case "update_month_plan" -> toolResult(updateMonthPlan(arguments, auth));
            case "assign_homework_series" -> toolResult(assignHomeworkSeries(arguments, auth));
            case "list_school_teachers" -> toolResult(analyticsService.listTeachers(auth.user(), auth.apiKey()));
            case "find_students" -> toolResult(analyticsService.findStudents(auth.user(), auth.apiKey(), string(arguments.get("query")), string(arguments.get("teacherId"))));
            case "find_student_homeworks" -> toolResult(homeworkReadService.findStudentHomeworks(
                    auth.user(), auth.apiKey(), uuid(required(arguments, "studentId"), "studentId"),
                    date(arguments, "fromDate"), date(arguments, "toDate")));
            case "replace_homework" -> toolResult(homeworkWriteService.replaceHomework(
                    auth.user(),
                    auth.apiKey(),
                    uuid(required(arguments, "homeworkId"), "homeworkId"),
                    string(arguments.get("filename")),
                    decodePdfBase64(required(arguments, "pdfBase64"), "pdfBase64")));
            case "update_homework" -> toolResult(updateHomework(arguments, auth));
            case "delete_homework" -> toolResult(homeworkWriteService.deleteHomework(
                    auth.user(),
                    auth.apiKey(),
                    uuid(required(arguments, "homeworkId"), "homeworkId"),
                    booleanValue(arguments.get("confirm"), "confirm")));
            case "get_recent_homework_submissions" -> toolResult(homeworkReadService.recentSubmissions(
                    auth.user(), auth.apiKey(), uuid(required(arguments, "studentId"), "studentId"),
                    arguments.containsKey("limit") ? integer(arguments.get("limit"), "limit") : 5));
            case "get_homework_submission", "download_homework_submission_pdf" -> toolResult(homeworkReadService.submissionPdf(
                    auth.user(), auth.apiKey(), uuid(required(arguments, "homeworkId"), "homeworkId")));
            case "get_homework_submission_pages" -> toolResult(homeworkReadService.submissionPages(
                    auth.user(), auth.apiKey(), uuid(required(arguments, "homeworkId"), "homeworkId"),
                    arguments.containsKey("startPage") ? integer(arguments.get("startPage"), "startPage") : 1,
                    arguments.containsKey("pageCount") ? integer(arguments.get("pageCount"), "pageCount") : 1));
            case "get_school_day_summary" -> toolResult(analyticsService.dailySummary(auth.user(), auth.apiKey(), date(arguments, "date"), string(arguments.get("teacherId"))));
            case "get_student_activity" -> toolResult(analyticsService.studentActivity(auth.user(), auth.apiKey(), uuid(required(arguments, "studentId"), "studentId"), date(arguments, "fromDate"), date(arguments, "toDate")));
            case "get_student_homework_history" -> toolResult(analyticsService.homeworkHistory(auth.user(), auth.apiKey(), uuid(required(arguments, "studentId"), "studentId"), date(arguments, "fromDate"), date(arguments, "toDate")));
            case "get_card_session_details" -> toolResult(analyticsService.cardSessionDetails(auth.user(), auth.apiKey(), uuid(required(arguments, "sessionId"), "sessionId")));
            case "get_public_funnel_analytics" -> toolResult(funnelAnalyticsService.report(
                    auth.user(),
                    auth.apiKey(),
                    date(arguments, "fromDate"),
                    date(arguments, "toDate"),
                    arguments.containsKey("recentLimit") ? integer(arguments.get("recentLimit"), "recentLimit") : 50));
            default -> throw new IllegalArgumentException("Unknown tool: " + name);
        };
    }

    private Map<String, Object> updateHomework(Map<String, Object> arguments, AuthContext auth) {
        UUID homeworkId = uuid(required(arguments, "homeworkId"), "homeworkId");

        LocalDate newStartDate = null;
        String rawDate = string(arguments.get("newStartDate")).trim();
        if (!rawDate.isBlank()) {
            try {
                newStartDate = LocalDate.parse(rawDate);
            } catch (RuntimeException ex) {
                throw new IllegalArgumentException("newStartDate must use YYYY-MM-DD format");
            }
        }

        byte[] pdf = null;
        String encoded = string(arguments.get("pdfBase64")).trim();
        if (!encoded.isBlank()) {
            pdf = decodePdfBase64(encoded, "pdfBase64");
        }

        if (newStartDate == null && pdf == null) {
            throw new IllegalArgumentException("Provide at least one change: newStartDate or pdfBase64");
        }

        return homeworkWriteService.updateHomework(
                auth.user(),
                auth.apiKey(),
                homeworkId,
                newStartDate,
                string(arguments.get("filename")),
                pdf);
    }

    private Map<String, Object> getSchoolPrompt(Map<String, Object> arguments) {
        String lessonType = normalize(required(arguments, "lessonType"));
        SchoolPromptSettingsResponse settings = schoolPromptSettingsService.readForMcp();
        String prompt;
        if ("group".equals(lessonType)) prompt = settings.groupLessonPrompt();
        else if ("individual".equals(lessonType)) prompt = settings.individualLessonPrompt();
        else if ("diagnostic".equals(lessonType)) prompt = settings.diagnosticLessonPrompt();
        else if ("error_correction".equals(lessonType) || "error-correction".equals(lessonType)) prompt = settings.errorCorrectionPrompt();
        else if ("workbook".equals(lessonType) || "worksheet".equals(lessonType)) prompt = settings.workbookPrompt();
        else if ("homework".equals(lessonType)) prompt = settings.homeworkPrompt();
        else throw new IllegalArgumentException("lessonType must be group, individual, workbook, homework, diagnostic or error_correction");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("lessonType", lessonType);
        result.put("prompt", prompt == null ? "" : prompt);
        result.put("updatedAt", settings.updatedAt() == null ? null : settings.updatedAt().toString());
        result.put("usage", "Use this prompt only for its specific material type. Workbook and homework are intentionally separate: workbook does not imply homework, and homework does not imply workbook. Apply the teacher's additional instructions on top of the selected prompt. If an additional instruction conflicts with the school prompt for this one request, follow the teacher's explicit request unless it would make the task unsafe or impossible.");
        result.put("configured", prompt != null && !prompt.isBlank());
        Map<String,Object> brandGuideSummary = new LinkedHashMap<>(schoolBrandGuideService.readForMcp());
        // Do not embed the complete Brand Guide PDF/base64 in every school-prompt response.
        // The server-side renderer reads the authoritative stored PDF directly when it needs the logo.
        brandGuideSummary.remove("base64");
        result.put("brandGuide", brandGuideSummary);
        result.put("brandGuideUsage", "This lightweight Brand Guide summary is enough for normal lesson planning. The canonical server-side PDF renderer reads the current stored Brand Guide and original logo directly. Call get_brand_guide only when the actual source PDF is explicitly needed for a non-canonical visual task.");
        return result;
    }


    private boolean workbookStaff(AuthContext auth) {
        return !auth.apiKey() && auth.user() != null && !auth.user().isArchived()
                && auth.user().getStatus() == com.mcschool.flashcard.users.UserStatus.ACTIVE
                && (auth.user().getRole() == Role.ADMIN || auth.user().getRole() == Role.TEACHER);
    }

    private void requireWorkbookStaff(AuthContext auth) {
        if (!workbookStaff(auth) || ownerWorkbookPdfRenderService == null)
            throw new IllegalArgumentException("School OAuth teacher or administrator sign-in is required for workbooks");
        if (personalWorkbookAccess != null) personalWorkbookAccess.requireActor(auth.user());
    }

    private static final java.time.ZoneId WORKBOOK_ZONE = java.time.ZoneId.of("Europe/Berlin");

    private LocalDate workbookLocalDate(GroupLessonResponse lesson) {
        if (lesson.startsAt() == null) throw new IllegalArgumentException("Calendar lesson has no start time");
        return lesson.startsAt().atZone(WORKBOOK_ZONE).toLocalDate();
    }

    private String workbookContextToken(Map<String,Object> context) {
        Map<String,Object> evidence = new LinkedHashMap<>(context);
        evidence.remove("contextToken");
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(objectMapper.writeValueAsBytes(canonicalWorkbookContext(evidence))));
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException("Missing SHA-256", ex);
        }
    }

    private Object canonicalWorkbookContext(Object value) {
        if(value instanceof Map<?,?> map) {
            Map<String,Object> canonical=new java.util.TreeMap<>();
            map.forEach((key,item)->canonical.put(String.valueOf(key),canonicalWorkbookContext(item)));
            return canonical;
        }
        if(value instanceof List<?> list) return list.stream().map(this::canonicalWorkbookContext).toList();
        return value;
    }

    private GroupLessonResponse selectedWorkbookLesson(AuthenticatedUser teacher, String eventId) {
        return calendarLessonService.listGroupLessons(teacher).stream()
                .filter(l -> eventId.equals(l.eventId()))
                .findFirst().orElseThrow(() -> new IllegalArgumentException(
                        "Calendar lesson not found. Use the exact eventId from find_lessons."));
    }

    private MonthlyPlanResponse selectedWorkbookPlan(AuthenticatedUser teacher, GroupLessonResponse lesson) {
        String type = lesson.groupId() != null ? "group" : "student";
        UUID targetId = lesson.groupId() != null ? lesson.groupId() : lesson.studentId();
        if (targetId == null) throw new IllegalArgumentException(
                "Workbook pilot requires a lesson linked to an actual group or student");
        String month = workbookLocalDate(lesson).withDayOfMonth(1).toString().substring(0, 7);
        MonthlyPlanResponse result = monthlyPlanService.get(teacher, type, targetId, month);
        return result;
    }

    // ChatGPT can cache an older subset of MCP tool definitions even when the
    // live Mindcrafti tools/list has newer methods. Reuse existing, already
    // exposed list/get/read/execute_site_function tools as a secure fallback.
    // This bridge invokes the SAME core homework operations and validations.
    private static final String HOMEWORK_BRIDGE_DOMAIN="homework_generator";
    private static final List<String> HOMEWORK_BRIDGE_IDS=List.of(
            "homework_generator.prepare_context",
            "homework_generator.generate_day",
            "homework_generator.review_series",
            "homework_generator.assign_series");

    private boolean homeworkBridgeRequest(String name,Map<String,Object> args) {
        if("list_site_functions".equals(name))
            return HOMEWORK_BRIDGE_DOMAIN.equals(normalize(string(args.get("domain"))));
        return Set.of("get_site_function","read_site_function","execute_site_function").contains(name)
                && string(args.get("functionId")).startsWith(HOMEWORK_BRIDGE_DOMAIN+".");
    }

    private Map<String,Object> homeworkBridgeSummary(int index) {
        String id=HOMEWORK_BRIDGE_IDS.get(index);
        boolean readOnly=index==0||index==2;
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("functionId",id);
        result.put("domain",HOMEWORK_BRIDGE_DOMAIN);
        result.put("scope","TEACHER");
        result.put("readOnly",readOnly);
        result.put("destructive",false);
        result.put("externalEffect",index==3);
        result.put("adminRequiresTeacherId",true);
        result.put("preferredDedicatedTools",switch(index){
            case 0 -> "prepare_homework_context";
            case 1 -> "generate_homework_day_draft";
            case 2 -> "review_homework_series_drafts";
            default -> "assign_homework_series_from_drafts";
        });
        return result;
    }

    private Map<String,Object> homeworkBridgeSchema(int index) {
        Map<String,Object> properties=new LinkedHashMap<>();
        properties.put("eventId",property("string","Exact owned source lesson eventId from find_lessons"));
        List<String> required=new ArrayList<>(List.of("eventId"));
        if(index==1){
            properties.put("day",Map.of("type","integer","minimum",1,"maximum",7));
            properties.put("seriesKey",property("string","Same stable series key across seven days"));
            properties.put("lessonJson",property("string","ChatGPT-authored one-day one-A4-page homework and private teacher solutions, qa.algebra included"));
            properties.put("contextToken",property("string","Fresh token from prepare_context"));
            required.addAll(List.of("day","seriesKey","lessonJson","contextToken"));
        }else if(index>=2){
            properties.put("seriesKey",property("string","Identical seriesKey supplied during daily generation"));
            properties.put("draftIds",Map.of("type","array","minItems",7,"maxItems",7,
                    "items",Map.of("type","string","format","uuid")));
            required.addAll(List.of("seriesKey","draftIds"));
            if(index==3){
                properties.put("targetType",Map.of("type","string","enum",List.of("student","group")));
                properties.put("targetId",property("string","Student/group UUID matching source lesson"));
                properties.put("startDate",property("string","First date YYYY-MM-DD; next six days consecutive"));
                required.addAll(List.of("targetType","targetId","startDate"));
            }
        }
        return schema(properties,required);
    }

    private Object homeworkBridge(String name,Map<String,Object> args,AuthContext auth) throws Exception {
        requireWorkbookStaff(auth);
        if("list_site_functions".equals(name)){
            if(!Set.of("domain","limit","offset").containsAll(args.keySet()))
                throw new IllegalArgumentException("Unknown homework generator catalog argument");
            int limit=args.containsKey("limit")?integer(args.get("limit"),"limit"):100;
            int offset=args.containsKey("offset")?integer(args.get("offset"),"offset"):0;
            if(limit<1||limit>100||offset<0)
                throw new IllegalArgumentException("Catalog limit must be 1..100 and offset nonnegative");
            List<Map<String,Object>> records=new ArrayList<>();
            for(int i=offset;i<Math.min(HOMEWORK_BRIDGE_IDS.size(),offset+limit);i++)
                records.add(homeworkBridgeSummary(i));
            Map<String,Object> result=new LinkedHashMap<>();
            result.put("total",HOMEWORK_BRIDGE_IDS.size());
            result.put("functions",records);
            result.put("domain",HOMEWORK_BRIDGE_DOMAIN);
            result.put("limit",limit);result.put("offset",offset);
            result.put("nextOffset",Math.min(HOMEWORK_BRIDGE_IDS.size(),offset+limit));
            result.put("exceptions",McpSiteFunctionsService.exceptions());
            result.put("message","If your ChatGPT MCH3 catalog does not expose the new homework tools, call these same actions through the existing read_site_function / execute_site_function. No reconnect, Railway, GitHub or API key required.");
            return result;
        }
        String functionId=required(args,"functionId");
        int index=HOMEWORK_BRIDGE_IDS.indexOf(functionId);
        if(index<0)throw new IllegalArgumentException("Unknown homework generator site function");
        boolean readOnly=index==0||index==2;
        if("get_site_function".equals(name)){
            Map<String,Object> result=new LinkedHashMap<>(homeworkBridgeSummary(index));
            result.put("argumentsSchema",homeworkBridgeSchema(index));
            result.put("limits",Map.of("textCharacters",OwnerWorkbookPdfRenderService.MAX_INPUT_CHARS,
                    "fileBytes",15*1024*1024,"totalFileBytes",30*1024*1024,
                    "files",7,"collectionItems",2000));
            result.put("description",switch(index){
                case 0 -> "Read homework-only school prompt, recent real lesson evidence, student mistakes and renderer contract. Use read_site_function; no changes.";
                case 1 -> "Generate ONE unpublished homework day using mathematical PDF renderer. Use execute_site_function with confirm=true and unique stable idempotencyKey. Poll get_lesson_workbook_job.";
                case 2 -> "Validate all seven day-specific saved draft IDs and return fresh student PDF and private answers preview links. Use read_site_function; no assignment.";
                default -> "Assign seven approved server PDF drafts with readback, ONLY after explicitly showing previews to and receiving approval from the teacher. Use execute_site_function confirm=true and stable idempotencyKey.";
            });
            return result;
        }
        if(readOnly && !"read_site_function".equals(name))
            throw new IllegalArgumentException("This homework generator function is read-only; use read_site_function");
        if(!readOnly && !"execute_site_function".equals(name))
            throw new IllegalArgumentException("This homework generator function is a write; use execute_site_function");
        if(!Set.of("functionId","teacherId","arguments",
                "confirm","idempotencyKey","file").containsAll(args.keySet()))
            throw new IllegalArgumentException("Unsupported site function input");
        if(args.containsKey("file"))
            throw new IllegalArgumentException("Server-generated homework requires no file upload");
        Map<String,Object> supplied=map(args.get("arguments"));
        @SuppressWarnings("unchecked")
        Map<String,Object> properties=(Map<String,Object>)homeworkBridgeSchema(index).get("properties");
        if(!properties.keySet().containsAll(supplied.keySet()))
            throw new IllegalArgumentException("Unknown homework generator argument");
        Map<String,Object> forward=new LinkedHashMap<>(supplied);
        if(args.containsKey("teacherId"))
            forward.put("teacherId",required(args,"teacherId"));
        if(!readOnly){
            if(!Boolean.TRUE.equals(args.get("confirm")))
                throw new IllegalArgumentException("Explicit confirm=true required for homework generation/assignment");
            String key=required(args,"idempotencyKey");
            if(key.length()<8||key.length()>128)
                throw new IllegalArgumentException("idempotencyKey length must be 8..128");
            forward.put("idempotencyKey",key);
            if(index==3)forward.put("confirm",true);
        }
        return switch(index){
            case 0 -> prepareHomeworkContext(forward,auth);
            case 1 -> generateHomeworkDayDraft(forward,auth);
            case 2 -> reviewHomeworkSeriesDrafts(forward,auth);
            case 3 -> assignHomeworkSeriesFromDrafts(forward,auth);
            default -> throw new IllegalStateException("Invalid homework generator function");
        };
    }

    private Map<String,Object> prepareHomeworkContext(Map<String,Object> args, AuthContext auth) throws Exception {
        requireWorkbookStaff(auth);
        Map<String,Object> ctx=new LinkedHashMap<>(prepareWorkbookContext(args,auth));
        String prompt=schoolPromptSettingsService.readForMcp().homeworkPrompt();
        if(prompt==null || prompt.isBlank())throw new IllegalStateException("School homework prompt is not configured");
        // The shared workbook context includes workbook-specific warnings like
        // "do not generate homework". Do not show them to ChatGPT alongside
        // homework instructions: replace them with the correct daily contract.
        ctx.remove("rules");
        Object originalContract=ctx.get("rendererContract");
        if(originalContract instanceof Map<?,?> rawContract) {
            Map<String,Object> dailyContract=new LinkedHashMap<>();
            for(var entry:rawContract.entrySet())
                if(entry.getKey() instanceof String k)dailyContract.put(k,entry.getValue());
            dailyContract.put("pages","Exactly ONE A4 student workbookPages entry per day; 1-2 tasks, each with 6+ full-width lines at 8mm spacing. Teacher pages contain private solutions. No lesson progress bars.");
            dailyContract.put("meta","school:MINDCRAFTI SCHOOL, subject:MATHEMATIK, durationMinutes: reference lesson's calendarDurationMinutes, homeworkEstimatedMinutes:1..10. homeworkMode/homeworkDay are set by the server; omit pupil identity/day/date from student text.");
            dailyContract.put("publication","HOMEWORK DRAFT ONLY: render and preview seven daily PDF pairs, do not publish lesson workbooks or assign homework before explicit approval via assign_homework_series_from_drafts.");
            ctx.put("rendererContract",dailyContract);
        }
        ctx.put("homeworkPrompt",prompt);
        ctx.put("materialType","homework");
        ctx.put("homeworkDays",7);
        ctx.put("homeworkRules",List.of(
            "Read actual last taught lesson/transcript and only verified mistakes. No invented errors, methods, terms or pupil skills.",
            "Seven DIFFERENT one-page branded A4 student PDF drafts (plus seven separate private teacher-answer PDFs). Maximum TWO tasks and 10 minutes daily, including reading.",
            "meta.homeworkEstimatedMinutes must be 1..10. Provide 6+ full-width handwriting lines under EACH task with >=8mm spacing.",
            "Days 1..4: a short scaffold at TOP, in Russian using only already taught German math words. Days 5..7: German ONLY, no hints or examples.",
            "Each task needs its own numeric number and matching qa.algebra assertion with that number (visualValue for graph/geometry). No hidden a/b/c tasks.",
            "Student PDFs must not contain student/group names, dates, day/Tag labels or teacher solutions; date and pupil remain in assignment metadata only.",
            "Call generate_homework_day_draft seven times with fresh contextToken, SAME seriesKey and unique day idempotencyKeys. The queue accepts up to 24 active jobs per account and processes up to three at once. You may submit all seven daily jobs; poll their existing jobIds instead of creating duplicates.",
            "Use review_homework_series_drafts for seven fresh signed previews; only after EXPLICIT teacher approval call assign_homework_series_from_drafts with confirm=true. NEVER publish as a lesson workbook."
        ));
        ctx.put("nextStep","Author seven daily one-page lessonJson documents from current homeworkPrompt and evidence. Generate each via generate_homework_day_draft, poll get_lesson_workbook_job, preview seven via review_homework_series_drafts, then assign only after explicit approval.");
        ctx.put("publication","HOMEWORK DRAFT ONLY. No automatic assignment.");
        return ctx;
    }

    private Map<String,Object> generateHomeworkDayDraft(Map<String,Object> args,AuthContext auth) throws Exception {
        requireWorkbookStaff(auth);
        if(!Set.of("teacherId","eventId","day","seriesKey","lessonJson","contextToken","idempotencyKey").containsAll(args.keySet()))
            throw new IllegalArgumentException("Unknown homework generation arguments");
        AuthenticatedUser teacher=requireTeacher(args,auth);
        String eventId=required(args,"eventId");
        int day=integer(args.get("day"),"day");
        String seriesKey=required(args,"seriesKey");
        McpHomeworkDraftValidator.seriesMarker(seriesKey,day);
        Map<String,Object> ctx=prepareWorkbookContext(Map.of("teacherId",teacher.id().toString(),"eventId",eventId),auth);
        requireFreshWorkbookToken(ctx,required(args,"contextToken"));
        String verified=McpHomeworkDraftValidator.normalize(objectMapper,required(args,"lessonJson"),
                day,String.valueOf(ctx.get("targetName")));
        Map<String,Object> forward=new LinkedHashMap<>();
        forward.put("teacherId",teacher.id().toString());
        forward.put("eventId",eventId);
        forward.put("lessonJson",verified);
        forward.put("contextToken",required(args,"contextToken"));
        forward.put("homeworkDay",day);
        forward.put("homeworkSeriesKey",seriesKey);
        forward.put("idempotencyKey",required(args,"idempotencyKey"));
        forward.put("instruction","Unpublished homework PDF draft. Do not assign.");
        Map<String,Object> result=generateLessonWorkbookDraft(forward,auth);
        result.put("homeworkDay",day);
        result.put("materialType","homework");
        result.put("published",false);
        return result;
    }

    private List<UUID> homeworkDraftIds(Map<String,Object> args) {
        Object value=args.get("draftIds");
        if(!(value instanceof List<?> raw) || raw.size()!=7)
            throw new IllegalArgumentException("Exactly seven saved homework draft IDs are required");
        List<UUID> ids=new ArrayList<>();
        for(Object one:raw){
            if(!(one instanceof String id))throw new IllegalArgumentException("draftIds must contain UUID strings");
            ids.add(uuid(id,"draftId"));
        }
        if(new java.util.HashSet<>(ids).size()!=7)
            throw new IllegalArgumentException("Every homework day must have a distinct draft ID");
        return ids;
    }

    private Map<String,Object> reviewHomeworkSeriesDrafts(Map<String,Object> args,AuthContext auth) throws Exception {
        requireWorkbookStaff(auth);
        if(!Set.of("teacherId","eventId","seriesKey","draftIds").containsAll(args.keySet()))
            throw new IllegalArgumentException("Unsupported homework review arguments");
        AuthenticatedUser actor=personalWorkbookAccess.requireActor(auth.user());
        AuthenticatedUser teacher=personalWorkbookAccess.requireTeacher(actor,
                args.containsKey("teacherId")?uuid(required(args,"teacherId"),"teacherId"):null);
        String eventId=required(args,"eventId");
        selectedWorkbookLesson(teacher,eventId);
        String seriesKey=required(args,"seriesKey");
        List<UUID> ids=homeworkDraftIds(args);
        if(workbookDraftDownloads==null)throw new IllegalStateException("Private homework PDF links unavailable");
        List<Map<String,Object>> previews=new ArrayList<>();
        for(int i=0;i<7;i++){
            UUID draftId=ids.get(i);
            LessonPdfDraftService.PreviewFile pdf=lessonPdfDraftService.homeworkPreviewFile(
                    teacher,draftId,eventId,i+1,seriesKey);
            Map<String,Object> day=new LinkedHashMap<>();
            day.put("day",i+1); day.put("draftId",draftId.toString());
            day.put("studentPdf",workbookDraftDownloads.create(actor,teacher.id(),draftId,"workbook"));
            day.put("privateTeacherAnswersPdf",workbookDraftDownloads.create(actor,teacher.id(),draftId,"answers"));
            day.put("verifiedBytes",pdf.bytes().length);day.put("status","DRAFT");
            previews.add(day);
        }
        return Map.of("status","READY_FOR_TEACHER_REVIEW","eventId",eventId,
                "days",previews,"studentPdfs",7,"teacherAnswerPdfs",7,"assigned",false,
                "nextStep","Show the seven PDFs for teacher inspection. Each signed preview link expires in five minutes. Do not assign until explicit approval.");
    }

    private Map<String,Object> assignHomeworkSeriesFromDrafts(Map<String,Object> args,AuthContext auth) throws Exception {
        requireWorkbookStaff(auth);
        if(!Set.of("teacherId","eventId","seriesKey","draftIds","targetType","targetId",
                "startDate","confirm","idempotencyKey").containsAll(args.keySet()))
            throw new IllegalArgumentException("Unsupported homework assignment arguments");
        if(!Boolean.TRUE.equals(args.get("confirm")))
            throw new IllegalArgumentException("Explicit teacher approval and confirm=true are mandatory");
        String eventId=required(args,"eventId");
        String targetType=normalize(required(args,"targetType"));
        if(!Set.of("student","group").contains(targetType))
            throw new IllegalArgumentException("targetType must be student or group");
        UUID targetId=uuid(required(args,"targetId"),"targetId");
        AuthenticatedUser teacher=homeworkTeacher(args,auth,targetType,targetId);
        AuthenticatedUser actor=personalWorkbookAccess.requireActor(auth.user());
        personalWorkbookAccess.requireTeacher(actor,teacher.id());
        GroupLessonResponse lesson=selectedWorkbookLesson(teacher,eventId);
        UUID boundTarget="group".equals(targetType)?lesson.groupId():lesson.studentId();
        if(boundTarget==null || !boundTarget.equals(targetId))
            throw new IllegalArgumentException("Homework target must match the chosen source lesson's student or group");
        LocalDate startDate;
        try{startDate=LocalDate.parse(required(args,"startDate"));}
        catch(RuntimeException ex){throw new IllegalArgumentException("startDate must be YYYY-MM-DD");}
        String seriesKey=required(args,"seriesKey");
        List<UUID> ids=homeworkDraftIds(args);
        Runnable recheck=()->{
            AuthenticatedUser current=personalWorkbookAccess.requireCurrentActor(actor);
            personalWorkbookAccess.requireTeacher(current,teacher.id());
            selectedWorkbookLesson(teacher,eventId);
            for(int i=0;i<7;i++)lessonPdfDraftService.homeworkPreviewFile(
                    teacher,ids.get(i),eventId,i+1,seriesKey);
        };
        recheck.run();
        List<String> filenames=new ArrayList<>();
        for(int i=1;i<=7;i++)filenames.add("Mindcrafti_Hausaufgaben_"+String.format(Locale.ROOT,"%02d",i)+".pdf");
        Map<String,Object> identity=new LinkedHashMap<>();
        identity.put("teacherId",teacher.id().toString());identity.put("eventId",eventId);
        identity.put("targetType",targetType);identity.put("targetId",targetId.toString());
        identity.put("startDate",startDate.toString());identity.put("seriesKey",seriesKey);
        identity.put("draftIds",ids.stream().map(UUID::toString).toList());
        @SuppressWarnings("unchecked") Map<String,Object> result=(Map<String,Object>)personalWorkbookReceipts.execute(
                actor,teacher.id(),"assign_homework_series_from_drafts",required(args,"idempotencyKey"),
                identity,recheck,()->personalWorkbookAccess.asTeacher(actor,teacher,()->{
                    try{
                        List<byte[]> pdfs=new ArrayList<>();
                        for(int i=0;i<7;i++)pdfs.add(lessonPdfDraftService.homeworkPreviewFile(
                                teacher,ids.get(i),eventId,i+1,seriesKey).bytes());
                        Map<String,Object> assigned=homeworkSeriesService.assignDirectSeries(
                                teacher,targetType,targetId,startDate,7,pdfs,filenames);
                        return verifyHomeworkSeriesReadBack(assigned,auth,startDate,7);
                    }catch(RuntimeException ex){throw ex;}
                    catch(Exception ex){throw new IllegalStateException("Approved homework assignment failed",ex);}
                }));
        result.put("materialType","homework");
        result.put("approved",true);
        return result;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> prepareWorkbookContext(Map<String, Object> arguments, AuthContext auth)
            throws Exception {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        GroupLessonResponse lesson = selectedWorkbookLesson(teacher, required(arguments, "eventId"));
        LocalDate lessonDate = workbookLocalDate(lesson);
        int durationMinutes = Math.toIntExact(java.time.Duration.between(
                lesson.startsAt(), lesson.endsAt()).toMinutes());
        if (durationMinutes <= 0 || durationMinutes > 240)
            throw new IllegalArgumentException("Invalid calendar lesson duration");
        MonthlyPlanResponse monthPlan = selectedWorkbookPlan(teacher, lesson);
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("contextVersion", "v2-teacher-scoped");
        result.put("teacherId", teacher.id().toString());
        result.put("eventId", lesson.eventId());
        result.put("targetType", lesson.groupId() == null ? "student" : "group");
        result.put("targetId", String.valueOf(lesson.groupId() != null ? lesson.groupId() : lesson.studentId()));
        result.put("targetName", lesson.groupName() != null ? lesson.groupName()
                : lesson.studentName() != null ? lesson.studentName() : lesson.title());
        result.put("lessonTitle", lesson.title());
        result.put("lessonDate", lessonDate.toString());
        result.put("startsAt", lesson.startsAt().atZone(WORKBOOK_ZONE).toString());
        result.put("calendarDurationMinutes", durationMinutes);
        result.put("month", lessonDate.toString().substring(0, 7));
        result.put("monthPlanVersion", monthPlan == null ? null : monthPlan.version());
        result.put("monthPlanUpdatedAt", monthPlan == null || monthPlan.updatedAt() == null ? null : monthPlan.updatedAt().toString());

        Map<String,Object> parsedPlan = new LinkedHashMap<>();
        if (monthPlan != null && monthPlan.planJson() != null && !monthPlan.planJson().isBlank()) {
            parsedPlan = objectMapper.readValue(monthPlan.planJson(), Map.class);
        }
        result.put("monthPlan", parsedPlan);
        result.put("monthPlanAvailable", !parsedPlan.isEmpty());
        List<GroupLessonResponse> actualLessons = calendarLessonService.listGroupLessons(teacher).stream()
                .filter(l -> l.startsAt() != null)
                .filter(l -> lesson.groupId() != null ? lesson.groupId().equals(l.groupId())
                        : lesson.studentId().equals(l.studentId()))
                .filter(l -> workbookLocalDate(l).getYear() == lessonDate.getYear()
                        && workbookLocalDate(l).getMonth() == lessonDate.getMonth())
                .sorted(java.util.Comparator.comparing(GroupLessonResponse::startsAt)).toList();
        int position = -1;
        for (int i=0; i<actualLessons.size(); i++)
            if (lesson.eventId().equals(actualLessons.get(i).eventId())) {position = i;break;}
        result.put("calendarLessonNumberThisMonth", position < 0 ? null : position + 1);
        Object plannedLessons = parsedPlan.get("lessons");
        if (position >= 0 && plannedLessons instanceof List<?> list && position < list.size())
            result.put("candidateMonthLesson", list.get(position));
        else result.put("candidateMonthLesson", null);
        result.put("monthLessonSelectionConfidence", "CANDIDATE_BY_CALENDAR_ORDER_ONLY");
        result.put("monthLessonVerification", "Read preceding lesson/transcript and completed work; planned lesson statuses alone do not prove a topic was taught. Ask the teacher if plan and history disagree.");

        LessonPreparation current = preparationRepository
                .findByTeacherIdAndEventId(teacher.id(), lesson.eventId()).orElse(null);
        result.put("currentPreparation", workbookPrepSummary(current));
        GroupLessonResponse previous = calendarLessonService.listGroupLessons(teacher).stream()
                .filter(l -> l.startsAt() != null && l.startsAt().isBefore(lesson.startsAt()))
                .filter(l -> lesson.groupId() != null ? lesson.groupId().equals(l.groupId())
                        : lesson.studentId().equals(l.studentId()))
                .max(java.util.Comparator.comparing(GroupLessonResponse::startsAt)).orElse(null);
        if (previous != null) {
            Map<String,Object> previousSummary = new LinkedHashMap<>();
            previousSummary.put("eventId", previous.eventId());
            previousSummary.put("date", workbookLocalDate(previous).toString());
            previousSummary.put("preparation", workbookPrepSummary(preparationRepository
                    .findByTeacherIdAndEventId(teacher.id(), previous.eventId()).orElse(null)));
            result.put("previousLesson", previousSummary);
        } else result.put("previousLesson", null);

        List<Map<String,Object>> students = new ArrayList<>();
        if (lesson.studentId() != null) {
            students.add(Map.of("id", lesson.studentId().toString(),
                    "name", lesson.studentName() == null ? "Student" : lesson.studentName()));
        } else {
            Map<String,Object> targets = homeworkSeriesService.findTargets(teacher, "");
            Object raw = targets.get("targets");
            if (raw instanceof List<?> targetList) for (Object entry : targetList) {
                if (!(entry instanceof Map<?,?> t) ||
                    !String.valueOf(lesson.groupId()).equals(String.valueOf(t.get("id"))) ||
                    !"group".equalsIgnoreCase(String.valueOf(t.get("type")))) continue;
                Object members = t.get("students");
                if (members instanceof List<?> memberList) for (Object member : memberList) {
                    if (member instanceof Map<?,?> m && m.get("id") != null) {
                        Map<String,Object> item = new LinkedHashMap<>();
                        item.put("id", String.valueOf(m.get("id")));
                        item.put("name", String.valueOf(m.get("name")));
                        students.add(item);
                    }
                }
                break;
            }
        }
        LocalDate activityEnd = lessonDate.isAfter(LocalDate.now(WORKBOOK_ZONE))
                ? LocalDate.now(WORKBOOK_ZONE) : lessonDate;
        LocalDate activityStart = activityEnd.minusDays(20);
        List<Map<String,Object>> studentContexts = new ArrayList<>();
        for (Map<String,Object> student : students) {
            UUID studentId = uuid(String.valueOf(student.get("id")), "studentId");
            Map<String,Object> item = new LinkedHashMap<>(student);
            userRepository.findById(studentId)
                    .filter(u -> u.getRole() == Role.STUDENT && u.getTeacher() != null && teacher.id().equals(u.getTeacher().getId()))
                    .ifPresent(u -> {
                        item.put("grade", u.getGrade());
                        item.put("schoolType", u.getSchoolType());
                        item.put("learningStrengths", u.getLearningStrengths());
                        item.put("learningDifficulties", u.getLearningDifficulties());
                        item.put("learningNotes", u.getLearningNotes());
                    });
            Map<String,Object> activity = analyticsService.studentActivity(auth.user(), auth.apiKey(),
                    studentId, activityStart, activityEnd);
            item.put("activityTotals", activity.get("totals"));
            if (workbookBoards != null && workbookMastery != null) {
                List<Map<String,Object>> skills = new ArrayList<>();
                for (var board : workbookBoards.list()) {
                    if (item.get("grade") instanceof Number grade && board.grade() != grade.intValue()) continue;
                    var mastery = workbookMastery.get(board.id(), studentId, teacher);
                    if (mastery.mastery().isEmpty()) continue;
                    // Read the current board before interpreting saved node IDs.
                    var currentBoard = workbookBoards.get(board.id());
                    skills.add(Map.of("boardId", board.id(), "revision", currentBoard.revision(),
                            "mastery", mastery.mastery(), "skills", currentBoard.data().nodes().stream()
                                    .filter(node -> mastery.mastery().containsKey(node.id()))
                                    .map(node -> Map.of("id", node.id(), "title", node.title())).toList()));
                    if (skills.size() >= 3) break;
                }
                item.put("savedSkills", skills);
            }
            Object rawErrors = activity.get("errors");
            List<Map<String,Object>> errorEvidence = new ArrayList<>();
            if (rawErrors instanceof List<?> errorList) for (Object rawError : errorList) {
                if (!(rawError instanceof Map<?,?> m)) continue;
                Map<String,Object> evidence = new LinkedHashMap<>();
                for (String field : List.of("sessionId", "homeworkId", "homeworkDate",
                        "question", "studentFirstAnswer", "correctAnswer", "correctFirstTry")) {
                    if (m.containsKey(field)) evidence.put(field,m.get(field));
                }
                errorEvidence.add(evidence);
                if (errorEvidence.size() >= 10) break;
            }
            item.put("documentedCardErrors", errorEvidence);
            Map<String,Object> assigned = homeworkReadService.findStudentHomeworks(
                    auth.user(),auth.apiKey(),studentId,activityStart,activityEnd);
            item.put("assignedHomeworkCount", assigned.get("homeworkCount"));
            item.put("submittedHomeworkCount", assigned.get("submittedCount"));
            List<Map<String,Object>> recentHomework = new ArrayList<>();
            Object history = assigned.get("homeworks");
            if (history instanceof List<?> rows) for (Object row : rows) {
                if (!(row instanceof Map<?,?> m)) continue;
                Map<String,Object> h = new LinkedHashMap<>();
                for (String field : List.of("homeworkId","assignedDate","submitted","submittedAt")) {
                    if (m.containsKey(field)) h.put(field, m.get(field));
                }
                recentHomework.add(h);
                if (recentHomework.size() >= 10) break;
            }
            item.put("recentHomeworkStatus", recentHomework);
            Map<String,Object> submissions = homeworkReadService.recentSubmissions(
                    auth.user(), auth.apiKey(), studentId, 3);
            Object recentRaw = submissions.get("recentSubmissions");
            List<Map<String,Object>> reviewIds = new ArrayList<>();
            if (recentRaw instanceof List<?> recent) for (Object one : recent) {
                if (!(one instanceof Map<?,?> m)) continue;
                Map<String,Object> detail = new LinkedHashMap<>();
                for (String field : List.of("homeworkId","assignedDate","submittedAt",
                        "submittedAfterLatestLesson")) {
                    if (m.containsKey(field)) detail.put(field,m.get(field));
                }
                reviewIds.add(detail);
            }
            item.put("submittedPdfHomeworkToInspect", reviewIds);
            item.put("pdfHomeworkErrorsVerified", false);
            studentContexts.add(item);
        }
        result.put("students", studentContexts);
        result.put("studentMembershipNeedsTeacherReview", true);
        var prompts = schoolPromptSettingsService.readForMcp();
        result.put("teachingPrompt", lesson.groupId() != null ?
                prompts.groupLessonPrompt() : prompts.individualLessonPrompt());
        result.put("workbookPrompt", prompts.workbookPrompt());
        result.put("promptUpdatedAt", prompts.updatedAt() == null ? null : prompts.updatedAt().toString());
        Map<String,Object> brand = new LinkedHashMap<>(schoolBrandGuideService.readForMcp());
        Object guideSource=brand.remove("base64");
        if(guideSource instanceof String encoded && !encoded.isBlank()) {
            try {
                brand.put("pdfSha256",java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                        .digest(Base64.getDecoder().decode(encoded))));
            } catch(IllegalArgumentException invalidEncoding) {
                throw new IllegalStateException("Current Brand Guide PDF encoding is invalid");
            }
        }
        result.put("brandGuide", brand);
        result.put("rules", List.of(
                "Use the documented month plan but verify the lesson candidate against actual past work.",
                "Review submitted handwritten homework via get_homework_submission_pages before claiming errors in PDF solutions.",
                "Unsumbitted homework is missing evidence, NOT proof of a learning difficulty.",
                "Generate exactly two PDFs, workbook + teacher answers; do not generate or assign homework or cards.",
                "Use canonical generator v3 SVG/CSS; download both unpublished draft PDFs and review before publication.",
                "If pupil level, topic, date or duration is ambiguous, stop and ask the teacher to decide."));
        result.put("nextStep", "MANDATORY: ChatGPT must author lessonJson from this exact rendererContract and current lesson evidence (student workbookPages, teacherPages, qa.algebra), then call generate_lesson_workbook_draft with lessonJson, this fresh contextToken, eventId and a stable idempotencyKey. Server AI authoring is disabled. The school server renders only two unpublished PDF previews; do not publish until approved.");
        result.put("rendererContract",workbookRendererContract());
        result.put("contextToken",workbookContextToken(result));
        return result;
    }

    private Map<String,Object> workbookRendererContract() {
        return Map.of("format","Mindcrafti lesson JSON, declarative data only",
                "rootFields",List.of("meta","workbookPages","teacherPages","qa"),
                "meta","school: MINDCRAFTI SCHOOL; subject: MATHEMATIK; durationMinutes: exact calendarDurationMinutes; group/date/weekday are set from the exact lesson",
                "pages","Each workbookPages/teacherPages item has title, subtitle and blocks. Keep 2-3 tasks per A4 page with reasonable answer space. Student pages must not contain solutions, schedule or teacherNote, including nested layouts.",
                "math","Use {latex: string} for new math, {tokens: string[]} or legacy token arrays are accepted. Strings are text, never raw HTML. Rich text is {type: richText, content: [{text: string}, {math: string or MathExpression}]} and works in text, subtitles, callouts, facts and solution labels.",
                "blocks",List.of("callout {label,text}","exercise {number,title,subtitle,rows:[{label,math,work:true}],writeLines:3}",
                        "example {label,text,expressions:[MathExpression]}","facts {given:[RichText],find:[RichText]}",
                        "row/column/stack {children:[blocks],gap:4mm}","grid {columns:2,children:[blocks]}",
                        "split {columns:[42%,58%],gap:6mm,left:[blocks],right:[blocks]}","taskCard {title,children:[blocks]}",
                        "answerLines {lines:3}","answerBox {height:24mm}","studentHeader", "conclusionBox {title,text}",
                        "matching {left:[RichText],right:[RichText]}","spacer {height:4mm}","divider",
                        "teacherNote {label,title,paragraphs:[RichText]} (teacher only)","solutions {section,title,items:[{label,math,text,note}]} (teacher only)"),
                "graphs","graph {xRange:[-5,5],yRange:[-5,5],gridStep:1,series:[{kind:linear,m:2,b:-1}],showIntersections:true}. coordinateGrid uses the same axes without series. Series: linear(m,b), quadratic(a,b,c), polynomial(coefficients, constant term first), absolute(a,h,k), reciprocal(a,h,k), rational(numerator,denominator polynomial arrays constant-first), sqrt(a,h,k), exponential(a,base,h,k), logarithmic(a,base,h,k), constant(value), sine/cosine(amplitude,frequency,phase,offset), piecewise(pieces:[{domain:[min,max],function:structured series,includeStart:true,includeEnd:false}]). Labels are derived from coefficients. Never rasterize graph/math/text.",
                "visualTasks","For classroom graphs and geometry prefer visualTask blocks: {type:visualTask,number:1,spec:{type:graph,language:de,objective:draw,series:[{kind:linear,parameters:[2,1]}],xRange:[-5,5],yRange:[-5,5]}}. Objectives: draw, value (include at:2), zeros, intersections (two series). Geometry: {type:visualTask,number:2,spec:{type:geometry,language:de,figure:triangle,objective:area,vertices:[[0,0],[6,0],[0,8]]}}; also circle with parameters:[3], square/rectangle coordinates, cube, cuboid, cylinder, cone, sphere with parameters. Omit irrelevant at, index, vertices or denominator fields. Every visualTask requires qa.algebra entry {kind:visualValue,number:1} with matching number. The server derives correct results, creates SVG diagrams and automatically adds private teacher-only plotted solutions; NEVER insert solution markers into student graphs. For other nonvisual math add real equivalence/solution QA.",
                "algebraQA","For visualTask entries include a matching {kind:visualValue,number:1}; for normal algebra include at least one actual task/answer assertion: {kind:equivalence,expression:'(x+3)^2',answer:'x^2+6*x+9',restrictions:[]} or {kind:solution,equation:'2*x-1=5-x',solution:{x:2},restrictions:[]}. State rational restrictions such as 'x != 3' both in assertions and pupil text. QA covers explicit assertions, not every prose answer.",
                "publication","Draft only. No homework, schedules, transcripts, assignments, arbitrary URLs, image-generated worksheets or executable code. User must review both PDFs and explicitly approve publication.");
    }

    private Map<String,Object> workbookPrepSummary(LessonPreparation p) {
        Map<String,Object> summary = new LinkedHashMap<>();
        if (p == null) { summary.put("exists", false); return summary; }
        summary.put("exists", true);
        summary.put("lessonPlan", p.getLessonPlan());
        summary.put("difficulties", p.getDifficulties());
        summary.put("homeworkNotes", p.getHomeworkNotes());
        summary.put("hasTranscript", p.hasTranscript());
        summary.put("hasTranscriptPdf", p.hasTranscriptPdf());
        summary.put("transcriptFilename", p.getTranscriptFilename());
        summary.put("hasWorkbook", p.hasWorkbook());
        summary.put("hasAnswers", p.hasAnswers());
        summary.put("transcriptText", boundedContext(preparationService.transcriptTextForAnalysis(p), 12000));
        summary.put("coveredMaterial", boundedContext(p.getCoveredMaterial(), 6000));
        return summary;
    }

    private static String boundedContext(String value, int limit) {
        return value == null ? "" : value.substring(0, Math.min(limit, value.length()));
    }

    @SuppressWarnings("unchecked")
    private Map<String,Object> generateLessonWorkbookDraft(Map<String,Object> args, AuthContext auth) throws Exception {
        // Old focused controller tests do not wire the queue. Production always injects it.
        if(workbookJobs==null)return generateLessonWorkbookDraftSynchronously(args,auth);
        requireWorkbookStaff(auth);
        if(!Set.of("teacherId","eventId","instruction","lessonJson","contextToken","idempotencyKey","homeworkDay","homeworkSeriesKey").containsAll(args.keySet()))
            throw new IllegalArgumentException("Unsupported workbook generation arguments");
        AuthenticatedUser actor=personalWorkbookAccess.requireActor(auth.user());
        AuthenticatedUser teacher=personalWorkbookAccess.requireTeacher(actor,args.containsKey("teacherId")?uuid(required(args,"teacherId"),"teacherId"):null);
        String eventId=required(args,"eventId");
        selectedWorkbookLesson(teacher,eventId);
        String instruction=string(args.get("instruction"));
        if(instruction.length()>6000)throw new IllegalArgumentException("instruction is too long");
        if(!args.containsKey("lessonJson") || !args.containsKey("contextToken"))throw new IllegalArgumentException("MCH3 requires ChatGPT-authored lessonJson and fresh contextToken from prepare_workbook_context. Do not start server AI generation using eventId/instruction alone.");
        Map<String,Object> normalized=new TreeMap<>();
        normalized.put("teacherId",teacher.id().toString());normalized.put("eventId",eventId);
        normalized.put("instruction",instruction);normalized.put("idempotencyKey",required(args,"idempotencyKey"));
        if(args.containsKey("lessonJson")) {
            String source=required(args,"lessonJson");
            if(source.length()>OwnerWorkbookPdfRenderService.MAX_INPUT_CHARS)throw new IllegalArgumentException("lessonJson is too large");
            normalized.put("lessonJson",source);normalized.put("contextToken",required(args,"contextToken"));
        }
        if(args.containsKey("homeworkDay") || args.containsKey("homeworkSeriesKey")) {
            if(!args.containsKey("homeworkDay") || !args.containsKey("homeworkSeriesKey"))
                throw new IllegalArgumentException("Homework needs both day and seriesKey");
            int day=integer(args.get("homeworkDay"),"homeworkDay");
            String seriesKey=required(args,"homeworkSeriesKey");
            McpHomeworkDraftValidator.seriesMarker(seriesKey,day);
            normalized.put("homeworkDay",day);
            normalized.put("homeworkSeriesKey",seriesKey);
        }
        Map<String,Object> job=workbookJobs.enqueue(actor,teacher.id(),eventId,required(args,"idempotencyKey"),normalized);
        return completedWorkbookJob(job,auth);
    }

    private Map<String,Object> workbookJobStatus(Map<String,Object> args,AuthContext auth)throws Exception {
        requireWorkbookStaff(auth);
        if(workbookJobs==null)throw new IllegalStateException("Workbook jobs are unavailable");
        if(!Set.of("jobId").containsAll(args.keySet()))throw new IllegalArgumentException("Unknown job parameter");
        AuthenticatedUser actor=personalWorkbookAccess.requireActor(auth.user());
        Map<String,Object> job=workbookJobs.status(actor,uuid(required(args,"jobId"),"jobId"));
        AuthenticatedUser teacher=personalWorkbookAccess.requireTeacher(actor,uuid(required(job,"teacherId"),"teacherId"));
        selectedWorkbookLesson(teacher,required(job,"eventId"));
        return completedWorkbookJob(job,auth);
    }

    private Map<String,Object> completedWorkbookJob(Map<String,Object> job,AuthContext auth)throws Exception {
        if(!"SUCCEEDED".equals(job.get("status")))return job;
        Map<String,Object> result=new LinkedHashMap<>(job);
        result.put("draft",draftInfo(Map.of("teacherId",job.get("teacherId"),"draftId",job.get("draftId")),auth));
        Object draftRaw=result.get("draft");
        boolean homeworkDraft=draftRaw instanceof Map<?,?> map && Boolean.TRUE.equals(map.get("homeworkOnly"));
        result.put("nextStep",homeworkDraft
                ? "This ONE day has two private PDFs saved as a HOMEWORK draft. Generate the remaining days, then call review_homework_series_drafts. Never publish to a lesson or assign before explicit teacher approval."
                : "Both PDFs are saved drafts, not published. Review them. When preparing several pupils, refresh all get_lesson_draft links immediately before the final answer; signed links last five minutes.");
        return result;
    }

    private Map<String,Object> generateLessonWorkbookDraftSynchronously(Map<String,Object> args, AuthContext auth) throws Exception {
        requireWorkbookStaff(auth);
        if (personalWorkbookAccess == null || personalWorkbookReceipts == null)
            throw new IllegalStateException("Server workbook generation is unavailable");
        if (!java.util.Set.of("teacherId", "eventId", "instruction", "lessonJson", "contextToken", "idempotencyKey", "homeworkDay", "homeworkSeriesKey").containsAll(args.keySet()))
            throw new IllegalArgumentException("Unsupported workbook generation arguments");
        AuthenticatedUser actor = personalWorkbookAccess.requireActor(auth.user());
        UUID selected = args.containsKey("teacherId") ? uuid(required(args, "teacherId"), "teacherId") : null;
        AuthenticatedUser teacher = personalWorkbookAccess.requireTeacher(actor, selected);
        String eventId = required(args, "eventId");
        String instruction = string(args.get("instruction"));
        if (instruction.length() > 6000) throw new IllegalArgumentException("instruction is too long");
        String key = required(args, "idempotencyKey");
        boolean suppliedContent=args.containsKey("lessonJson");
        if(!suppliedContent || !args.containsKey("contextToken")) throw new IllegalArgumentException("MCH3 requires ChatGPT-authored lessonJson and fresh contextToken from prepare_workbook_context; server AI authoring is disabled.");
        String suppliedJson=suppliedContent?required(args,"lessonJson"):"";
        String suppliedToken=suppliedContent?required(args,"contextToken"):"";
        if(suppliedJson.length()>OwnerWorkbookPdfRenderService.MAX_INPUT_CHARS) throw new IllegalArgumentException("lessonJson is too large");
        Map<String,Object> normalized = new LinkedHashMap<>(Map.of("teacherId", teacher.id().toString(), "eventId", eventId, "instruction", instruction,
                "lessonJson",suppliedJson,"contextToken",suppliedToken));
        if(args.containsKey("homeworkDay") || args.containsKey("homeworkSeriesKey")) {
            int day=integer(args.get("homeworkDay"),"homeworkDay");
            normalized.put("homeworkDay",day);
            normalized.put("homeworkSeriesKey",required(args,"homeworkSeriesKey"));
        }
        Map<String,Object> result=(Map<String,Object>) personalWorkbookReceipts.execute(actor, teacher.id(), "generate_lesson_workbook_draft", key, normalized,
                () -> {
                    selectedWorkbookLesson(personalWorkbookAccess.requireTeacher(actor, teacher.id()), eventId);
                    if(suppliedContent) {
                        try {
                            Map<String,Object> fresh=prepareWorkbookContext(Map.of("teacherId",teacher.id().toString(),"eventId",eventId),auth);
                            requireFreshWorkbookToken(fresh,suppliedToken);
                        } catch(RuntimeException ex) { throw ex; }
                        catch(Exception ex) { throw new IllegalStateException("Cannot refresh workbook evidence",ex); }
                    }
                },
                () -> personalWorkbookAccess.asTeacher(actor, teacher, () -> {
                    try {
                        Map<String,Object> scoped = Map.of("teacherId", teacher.id().toString(), "eventId", eventId);
                        Map<String,Object> context = prepareWorkbookContext(scoped, auth);
                        requireFreshWorkbookToken(context,suppliedToken);
                        @SuppressWarnings("unchecked") Map<String,Object> prepared=objectMapper.readValue(suppliedJson,Map.class);
                        if(!(prepared.get("qa") instanceof Map<?,?> qa) || !(qa.get("algebra") instanceof List<?> checks) || checks.isEmpty())
                            throw new IllegalArgumentException("Prepared lessonJson must include explicit qa.algebra assertions from its actual tasks and answers");
                        boolean homework=args.containsKey("homeworkDay");
                        int homeworkDay=homework?integer(args.get("homeworkDay"),"homeworkDay"):0;
                        String seriesKey=homework?required(args,"homeworkSeriesKey"):"";
                        String verifiedJson=homework ? McpHomeworkDraftValidator.normalize(objectMapper,suppliedJson,
                                homeworkDay,String.valueOf(context.get("targetName"))) : suppliedJson;
                        WorkbookContentService.Content content=new WorkbookContentService.Content(verifiedJson,"","");
                        Map<String,Object> generation = new LinkedHashMap<>(scoped);
                        generation.put("contextToken", context.get("contextToken"));
                        generation.put("lessonJson", content.lessonJson());
                        generation.put("lessonPlan", content.lessonPlan());
                        generation.put("difficulties", content.difficulties());
                        Map<String,Object> draftResult = generateWorkbook(generation, auth);
                        if(homework) {
                            lessonPdfDraftService.markHomeworkDraft(teacher,
                                    UUID.fromString(String.valueOf(draftResult.get("draftId"))),eventId,homeworkDay,seriesKey);
                            draftResult.put("homeworkDay",homeworkDay);
                            draftResult.put("homeworkDraft",true);
                        }
                        draftResult.put("contextVersion", context.get("contextVersion"));
                        draftResult.put("published", false);
                        return draftResult;
                    } catch (RuntimeException ex) { throw ex; }
                    catch (Exception ex) { throw new IllegalStateException("Workbook generation failed", ex); }
                }));
        return withWorkbookDownloadLinks(result,actor,teacher);
    }

    @SuppressWarnings("unchecked")
    private Map<String,Object> withWorkbookDownloadLinks(Map<String,Object> raw,AuthenticatedUser actor,AuthenticatedUser teacher) {
        if(workbookDraftDownloads==null) return raw;
        Map<String,Object> result=new LinkedHashMap<>(raw);
        UUID id=uuid(String.valueOf(result.get("draftId")),"draftId");
        for(String kind:List.of("workbook","answers")) {
            Map<String,Object> file=result.get(kind) instanceof Map<?,?> existing?new LinkedHashMap<>((Map<String,Object>)existing):new LinkedHashMap<>();
            file.putAll(workbookDraftDownloads.create(actor,teacher.id(),id,kind));
            result.put(kind,file);
        }
        return result;
    }

    private void requireFreshWorkbookToken(Map<String,Object> context,String received) {
        String expected=String.valueOf(context.get("contextToken"));
        if(!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),received.getBytes(StandardCharsets.UTF_8)))
            throw new IllegalArgumentException("Workbook context is stale; call prepare_workbook_context again and reconcile the new evidence before rendering");
    }

    private Map<String,Object> generateWorkbook(Map<String,Object> arguments, AuthContext auth)
            throws Exception {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        GroupLessonResponse lesson = selectedWorkbookLesson(teacher, required(arguments, "eventId"));
        String expectedContext = String.valueOf(prepareWorkbookContext(arguments,auth).get("contextToken"));
        String receivedContext = required(arguments, "contextToken");
        if (!MessageDigest.isEqual(expectedContext.getBytes(StandardCharsets.UTF_8),
                receivedContext.getBytes(StandardCharsets.UTF_8)))
            throw new IllegalArgumentException("Workbook context is stale; call prepare_workbook_context again");
        String lessonJson = required(arguments, "lessonJson");
        @SuppressWarnings("unchecked")
        Map<String,Object> doc = objectMapper.readValue(lessonJson, Map.class);
        Object metaRaw = doc.get("meta");
        if (!(metaRaw instanceof Map<?,?> meta)) throw new IllegalArgumentException("Missing lessonJson.meta");
        Object durationRaw = meta.get("durationMinutes");
        if (!(durationRaw instanceof Number duration))
            throw new IllegalArgumentException("meta.durationMinutes must be numeric");
        long minutes = java.time.Duration.between(lesson.startsAt(),lesson.endsAt()).toMinutes();
        boolean confirmedOverride = arguments.containsKey("confirmDurationOverride")
                && booleanValue(arguments.get("confirmDurationOverride"), "confirmDurationOverride");
        if (duration.intValue() != minutes && !confirmedOverride)
            throw new IllegalArgumentException("Calendar duration is " + minutes
                    + " minutes but JSON has " + duration.intValue()
                    + ". Only override after explicit teacher approval using confirmDurationOverride=true.");
        // The teacher can supply exercises but cannot accidentally rename this lesson,
        // its calendar date or the school's brand in the rendered files.
        Map<String,Object> safeMeta = new LinkedHashMap<>();
        for (Map.Entry<?,?> entry : meta.entrySet()) {
            if (entry.getKey() instanceof String key) safeMeta.put(key, entry.getValue());
        }
        LocalDate lessonDate = workbookLocalDate(lesson);
        safeMeta.put("school", "MINDCRAFTI SCHOOL");
        safeMeta.put("subject", "MATHEMATIK");
        safeMeta.put("group", lesson.groupName() != null ? lesson.groupName()
                : lesson.studentName() != null ? lesson.studentName() : lesson.title());
        safeMeta.put("date", lessonDate.format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy")));
        safeMeta.put("weekday", lessonDate.getDayOfWeek().getDisplayName(
                java.time.format.TextStyle.FULL, Locale.GERMAN));
        doc.put("meta", safeMeta);
        return ownerWorkbookPdfRenderService.create(teacher, lesson.eventId(),
                objectMapper.writeValueAsString(doc),
                string(arguments.get("lessonPlan")), string(arguments.get("difficulties")));
    }

    private Map<String,Object> generateWorkbookCompatibility(Map<String,Object> args,AuthContext auth) throws Exception {
        if(!java.util.Set.of("teacherId","eventId","lessonJson","contextToken","idempotencyKey","lessonPlan","difficulties","confirmDurationOverride").containsAll(args.keySet()))
            throw new IllegalArgumentException("Unsupported workbook generation arguments");
        return writeWorkbookDraft("generate_workbook",args,auth,(teacher,event,scoped)->generateWorkbook(scoped,auth));
    }

    @FunctionalInterface
    private interface WorkbookDraftCreation {
        Map<String,Object> create(AuthenticatedUser teacher,String eventId,Map<String,Object> scoped) throws Exception;
    }

    @SuppressWarnings("unchecked")
    private Map<String,Object> writeWorkbookDraft(String operation,Map<String,Object> args,AuthContext auth,WorkbookDraftCreation creation) throws Exception {
        requireWorkbookStaff(auth);
        AuthenticatedUser teacher=requireTeacher(args,auth);
        String event=required(args,"eventId");
        selectedWorkbookLesson(teacher,event);
        String key=string(args.get("idempotencyKey")).trim();
        String token=string(args.get("contextToken")).trim();
        if(auth.user().getRole()==Role.TEACHER && (key.isBlank()||token.isBlank()))
            throw new IllegalArgumentException("Teachers must call prepare_workbook_context first and supply its fresh contextToken plus a stable idempotencyKey. Prefer generate_lesson_workbook_draft.");
        Map<String,Object> scoped=new LinkedHashMap<>(args);
        scoped.put("teacherId",teacher.id().toString());
        scoped.put("eventId",event);
        if(token.isBlank()) scoped.put("contextToken",prepareWorkbookContext(scoped,auth).get("contextToken"));
        Runnable recheck=()->{
            try {
                if(personalWorkbookAccess!=null) {
                    AuthenticatedUser currentActor=personalWorkbookAccess.requireActor(auth.user());
                    personalWorkbookAccess.requireTeacher(currentActor,teacher.id());
                }
                selectedWorkbookLesson(teacher,event);
                requireFreshWorkbookToken(prepareWorkbookContext(scoped,auth),String.valueOf(scoped.get("contextToken")));
            } catch(RuntimeException ex) { throw ex; }
            catch(Exception ex) { throw new IllegalStateException("Cannot refresh workbook evidence",ex); }
        };
        Map<String,Object> result;
        if(key.isBlank()) {
            recheck.run();
            result=creation.create(teacher,event,scoped);
        } else {
            if(personalWorkbookAccess==null||personalWorkbookReceipts==null)throw new IllegalStateException("Idempotent workbook generation is unavailable");
            AuthenticatedUser actor=personalWorkbookAccess.requireActor(auth.user());
            personalWorkbookAccess.requireTeacher(actor,teacher.id());
            Map<String,Object> normalized=new LinkedHashMap<>(scoped);
            normalized.remove("idempotencyKey");
            result=(Map<String,Object>)personalWorkbookReceipts.execute(actor,teacher.id(),operation,key,normalized,recheck,
                    ()->personalWorkbookAccess.asTeacher(actor,teacher,()->{
                        try { return creation.create(teacher,event,scoped); }
                        catch(RuntimeException ex) { throw ex; }
                        catch(Exception ex) { throw new IllegalStateException("Workbook draft generation failed",ex); }
                    }));
        }
        return withWorkbookDownloadLinks(result,principal(auth.user()),teacher);
    }

    private List<Map<String, Object>> findLessons(String query, AuthContext auth) {
        String normalizedQuery = normalize(query);
        List<Map<String, Object>> result = new ArrayList<>();
        for (User teacher : accessibleTeachers(auth)) {
            if (teacher.isArchived()) continue;
            AuthenticatedUser principal = principal(teacher);
            List<GroupLessonResponse> lessons;
            try { lessons = calendarLessonService.listGroupLessons(principal); } catch (RuntimeException ignored) { continue; }
            for (GroupLessonResponse lesson : lessons) {
                String haystack = normalize(String.join(" ", lesson.title() == null ? "" : lesson.title(), lesson.groupName() == null ? "" : lesson.groupName(), lesson.studentName() == null ? "" : lesson.studentName()));
                if (!normalizedQuery.isBlank() && !haystack.contains(normalizedQuery)) continue;
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("teacherId", teacher.getId().toString());
                item.put("teacherName", teacher.getFullName());
                item.put("eventId", lesson.eventId());
                item.put("bindingKey", lesson.bindingKey());
                item.put("title", lesson.title());
                item.put("groupId", lesson.groupId() == null ? null : lesson.groupId().toString());
                item.put("groupName", lesson.groupName());
                item.put("studentId", lesson.studentId() == null ? null : lesson.studentId().toString());
                item.put("studentName", lesson.studentName());
                item.put("startsAt", lesson.startsAt() == null ? null : lesson.startsAt().toString());
                item.put("endsAt", lesson.endsAt() == null ? null : lesson.endsAt().toString());
                item.put("timeZone", "Europe/Berlin");
                if (lesson.startsAt() != null) {
                    java.time.ZonedDateTime localStart = lesson.startsAt().atZone(java.time.ZoneId.of("Europe/Berlin"));
                    item.put("date", localStart.toLocalDate().toString());
                    item.put("startTime", localStart.toLocalTime().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")));
                }
                result.add(item);
            }
        }
        return result;
    }

    private List<Map<String, Object>> findTrialLessons(String query, AuthContext auth) {
        String normalizedQuery = normalize(query);
        List<Map<String, Object>> result = new ArrayList<>();

        for (User teacher : accessibleTeachers(auth)) {
            if (teacher.isArchived()) continue;

            AuthenticatedUser principal = principal(teacher);
            List<GroupLessonResponse> lessons;
            try {
                lessons = calendarLessonService.listGroupLessons(principal);
            } catch (RuntimeException ignored) {
                continue;
            }

            for (GroupLessonResponse lesson : lessons) {
                if (lesson.groupId() != null || lesson.studentId() != null) continue;

                LessonPreparation preparation = preparationRepository
                        .findByTeacherIdAndEventId(teacher.getId(), lesson.eventId())
                        .orElse(null);
                boolean hasTranscript = preparation != null && preparation.hasTranscriptPdf();

                if (!hasTranscript && !AdminTrialLessonController.looksLikeTrialTitle(lesson.title())) continue;

                String haystack = normalize(String.join(" ",
                        teacher.getFullName() == null ? "" : teacher.getFullName(),
                        lesson.title() == null ? "" : lesson.title(),
                        lesson.startsAt() == null ? "" : lesson.startsAt().toString()));
                if (!normalizedQuery.isBlank() && !haystack.contains(normalizedQuery)) continue;

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("teacherId", teacher.getId().toString());
                item.put("teacherName", teacher.getFullName());
                item.put("eventId", lesson.eventId());
                item.put("title", lesson.title());
                item.put("startsAt", lesson.startsAt() == null ? null : lesson.startsAt().toString());
                item.put("endsAt", lesson.endsAt() == null ? null : lesson.endsAt().toString());
                item.put("hasTranscript", hasTranscript);
                item.put("transcriptFilename", preparation == null ? null : preparation.getTranscriptFilename());
                result.add(item);
            }
        }

        result.sort((left, right) -> String.valueOf(right.get("startsAt"))
                .compareTo(String.valueOf(left.get("startsAt"))));
        return result;
    }

    private List<User> accessibleTeachers(AuthContext auth) {
        if (auth.apiKey() || (auth.user() != null && auth.user().getRole() == Role.ADMIN)) return userRepository.findAllByRoleOrderByFullNameAsc(Role.TEACHER);
        if (auth.user() != null && auth.user().getRole() == Role.TEACHER) return List.of(auth.user());
        return List.of();
    }

    private LessonPreparationResponse getPreparation(Map<String, Object> arguments, AuthContext auth) {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);
        return preparationService.getOrCreate(teacher, eventId);
    }

    private Map<String, Object> downloadLessonPdf(Map<String, Object> arguments, AuthContext auth) {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);
        String kind = normalize(required(arguments, "kind"));
        LessonPreparation preparation = preparationService.require(teacher, eventId);
        byte[] pdf;
        String filename;
        if ("workbook".equals(kind)) {
            if (!preparation.hasWorkbook()) throw new IllegalArgumentException("This lesson does not have a workbook PDF");
            pdf = preparation.getWorkbookPdf();
            filename = preparation.getWorkbookFilename();
            if (filename == null || filename.isBlank()) filename = "lesson-workbook.pdf";
        } else if ("answers".equals(kind)) {
            if (!preparation.hasAnswers()) throw new IllegalArgumentException("This lesson does not have an answers PDF");
            pdf = preparation.getAnswersPdf();
            filename = preparation.getAnswersFilename();
            if (filename == null || filename.isBlank()) filename = "lesson-answers.pdf";
        } else if ("transcript".equals(kind)) {
            if (!preparation.hasTranscriptPdf()) throw new IllegalArgumentException("This lesson does not have a transcript PDF");
            pdf = preparation.getTranscriptPdf();
            filename = preparation.getTranscriptFilename();
            if (filename == null || filename.isBlank()) filename = "lesson-transcript.pdf";
        } else throw new IllegalArgumentException("kind must be workbook, answers or transcript");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("filename", filename);
        result.put("mimeType", MediaType.APPLICATION_PDF_VALUE);
        result.put("sizeBytes", pdf.length);
        result.put("base64", Base64.getEncoder().encodeToString(pdf));
        return result;
    }

    private Map<String, Object> downloadLessonTranscript(Map<String, Object> arguments, AuthContext auth) {
        Map<String, Object> transcriptArguments = new LinkedHashMap<>(arguments);
        transcriptArguments.put("kind", "transcript");
        return downloadLessonPdf(transcriptArguments, auth);
    }

    private boolean personalWorkbookActorAllowed(AuthContext auth) {
        User user = auth.user();
        return !auth.apiKey() && user != null && !user.isArchived()
                && user.getStatus() == com.mcschool.flashcard.users.UserStatus.ACTIVE
                && (user.getRole() == Role.ADMIN || user.getRole() == Role.TEACHER);
    }

    private AuthenticatedUser requirePersonalWorkbookActor(AuthContext auth) {
        if (!personalWorkbookActorAllowed(auth) || personalWorkbookAccess == null
                || personalLessonWorkbookService == null) {
            throw new org.springframework.security.access.AccessDeniedException("Personal worksheets require a teacher or administrator OAuth account");
        }
        AuthenticatedUser actor = personalWorkbookAccess.requireActor(auth.user());
        return actor;
    }

    private Object publishPersonalDraft(Map<String,Object> args,AuthContext auth) {
        AuthenticatedUser actor=requirePersonalWorkbookActor(auth);
        if(personalDrafts==null)throw new IllegalStateException("Personal draft publication is unavailable");
        if(!Set.of("teacherId","eventId","studentId","draftId","idempotencyKey","confirm").containsAll(args.keySet()))throw new IllegalArgumentException("Unknown publication parameter");
        return personalDrafts.publish(actor,uuid(required(args,"teacherId"),"teacherId"),required(args,"eventId"),
                uuid(required(args,"studentId"),"studentId"),uuid(required(args,"draftId"),"draftId"),required(args,"idempotencyKey"),Boolean.TRUE.equals(args.get("confirm")));
    }

    private Object personalLessonWorkbooks(String name, Map<String, Object> arguments, AuthContext auth) throws Exception {
        AuthenticatedUser actor = requirePersonalWorkbookActor(auth);
        UUID teacherId = arguments.containsKey("teacherId") ? uuid(required(arguments, "teacherId"), "teacherId")
                : actor.role() == Role.TEACHER ? actor.id() : null;
        AuthenticatedUser teacher = personalWorkbookAccess.requireTeacher(actor, teacherId);
        String eventId = required(arguments, "eventId");
        if ("list_personal_lesson_workbooks".equals(name)) {
            if (!java.util.Set.of("teacherId", "eventId").containsAll(arguments.keySet())) {
                throw new IllegalArgumentException("Unsupported personal worksheet arguments");
            }
            return personalLessonWorkbookService.list(teacher, eventId);
        }
        if (!java.util.Set.of("teacherId", "eventId", "studentId", "filename", "pdfFile", "pdfBase64", "driveFileId", "idempotencyKey").containsAll(arguments.keySet())) {
            throw new IllegalArgumentException("Unsupported personal worksheet arguments");
        }
        if (personalWorkbookReceipts == null) throw new IllegalStateException("Personal worksheet uploads are unavailable");
        boolean uploadingAnswers = "upload_personal_lesson_answers".equals(name);
        if (uploadingAnswers && personalLessonAnswersService == null) {
            throw new IllegalStateException("Personal teacher-answer uploads are unavailable");
        }
        UUID studentId = uuid(required(arguments, "studentId"), "studentId");
        String key = required(arguments, "idempotencyKey");
        String direct = string(arguments.get("pdfBase64"));
        String driveId = string(arguments.get("driveFileId"));
        boolean hasFile = arguments.containsKey("pdfFile");
        if ((hasFile ? 1 : 0) + (direct.isBlank() ? 0 : 1) + (driveId.isBlank() ? 0 : 1) != 1) {
            throw new IllegalArgumentException("exactly_one_source_required: Provide exactly one PDF source: pdfFile, pdfBase64 or driveFileId");
        }
        // Check this exact lesson's current roster before fetching or decoding a file.
        requirePersonalWorkbookStudent(teacher, eventId, studentId);
        if (hasFile) {
            ChatGptFileReference reference = requirePdfResolver().reference(arguments.get("pdfFile"), "pdfFile",
                    string(arguments.get("filename")), uploadingAnswers ? "personal-answers.pdf" : "personal-workbook.pdf");
            Map<String, Object> normalized = Map.of("teacherId", teacherId.toString(), "eventId", eventId,
                    "studentId", studentId.toString(), "filename", reference.filename(), "pdfFile", reference.identity());
            return personalWorkbookReceipts.execute(actor, teacherId, name, key, normalized,
                    () -> {
                        requirePersonalWorkbookActor(auth);
                        AuthenticatedUser currentTeacher = personalWorkbookAccess.requireTeacher(actor, teacherId);
                        requirePersonalWorkbookStudent(currentTeacher, eventId, studentId);
                    },
                    () -> personalWorkbookAccess.asTeacher(actor, teacher, () -> {
                        PdfInput pdf = requirePdfResolver().resolve(reference);
                        return uploadingAnswers
                                ? personalLessonAnswersService.upload(teacher, eventId, studentId, pdf.filename(), pdf.bytes())
                                : personalLessonWorkbookService.upload(teacher, eventId, studentId, pdf.filename(), pdf.bytes());
                    }));
        }
        // Preserve legacy receipt fingerprints for already completed base64/Drive uploads.
        String filename = normalizedPdfFilename(required(arguments, "filename"),
                uploadingAnswers ? "personal-answers.pdf" : "personal-workbook.pdf");
        byte[] pdf = !direct.isBlank() ? decodePdfBase64(direct, "pdfBase64")
                : teacherDriveDownloadService.downloadForTeacher(teacher.id(), driveId, filename);
        if (!looksLikePdf(pdf) || pdf.length > MAX_DIRECT_PDF_BYTES) {
            throw new IllegalArgumentException("Personal lesson file must be a PDF of at most 15 MB");
        }
        Map<String, Object> normalized = Map.of("teacherId", teacherId.toString(), "eventId", eventId,
                "studentId", studentId.toString(), "filename", filename,
                "pdfBase64", Base64.getEncoder().encodeToString(pdf));
        return personalWorkbookReceipts.execute(actor, teacherId, name, key, normalized,
                () -> {
                    requirePersonalWorkbookActor(auth);
                    AuthenticatedUser currentTeacher = personalWorkbookAccess.requireTeacher(actor, teacherId);
                    requirePersonalWorkbookStudent(currentTeacher, eventId, studentId);
                },
                () -> personalWorkbookAccess.asTeacher(actor, teacher, () -> uploadingAnswers
                        ? personalLessonAnswersService.upload(teacher, eventId, studentId, filename, pdf)
                        : personalLessonWorkbookService.upload(teacher, eventId, studentId, filename, pdf)));
    }

    private void requirePersonalWorkbookStudent(AuthenticatedUser teacher, String eventId, UUID studentId) {
        if (personalLessonWorkbookService.list(teacher, eventId).students().stream()
                .noneMatch(student -> student.studentId().equals(studentId))) {
            throw new com.mcschool.flashcard.common.ResourceNotFoundException("Lesson student not found");
        }
    }

    private Object prepareLesson(Map<String, Object> arguments, AuthContext auth) throws Exception {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);
        if (!java.util.Set.of("teacherId", "eventId", "homeworkNotes", "difficulties", "lessonPlan",
                "workbookFilename", "answersFilename", "workbookFile", "answersFile", "workbookBase64",
                "answersBase64", "driveWorkbookFileId", "driveAnswersFileId", "idempotencyKey").containsAll(arguments.keySet())) {
            throw new IllegalArgumentException("Unsupported lesson preparation arguments");
        }
        String rawWorkbookFilename = string(arguments.get("workbookFilename")).trim();
        if ("__TRANSCRIPT__".equals(rawWorkbookFilename)) {
            throw new IllegalArgumentException("Transcript import through prepare_lesson is disabled. Use attach_lesson_transcript with the original Soniox PDF filename so Mindcrafti can verify the target lesson.");
        }
        McpPdfSource workbook = pdfSource(arguments, "workbookFile", "workbookBase64", "driveWorkbookFileId",
                rawWorkbookFilename, "lesson-workbook.pdf");
        McpPdfSource answers = pdfSource(arguments, "answersFile", "answersBase64", "driveAnswersFileId",
                string(arguments.get("answersFilename")), "lesson-answers.pdf");
        boolean legacyAnswersTarget = workbook != null && workbook.filename().toLowerCase(Locale.ROOT).startsWith("__answers__:");
        if (legacyAnswersTarget && answers != null) {
            throw new IllegalArgumentException("exactly_one_source_required: A legacy answers workbook source cannot be combined with a separate answers source");
        }
        UpdateLessonPreparationRequest notes = new UpdateLessonPreparationRequest(
                optional(arguments, "homeworkNotes", null), optional(arguments, "difficulties", null),
                optional(arguments, "lessonPlan", null), null);
        String key = string(arguments.get("idempotencyKey")).trim();
        if ((workbook != null && workbook.file() != null || answers != null && answers.file() != null) && key.isBlank()) {
            throw new IllegalArgumentException("idempotencyKey is required for attached ChatGPT lesson PDFs");
        }
        Supplier<Object> write = () -> {
            PdfInput workbookPdf = resolvePdfSource(workbook, teacher.id());
            PdfInput answersPdf = resolvePdfSource(answers, teacher.id());
            return preparationService.prepareMaterials(teacher, eventId, notes,
                    workbookPdf == null ? null : workbookPdf.filename(), workbookPdf == null ? null : workbookPdf.bytes(),
                    answersPdf == null ? null : answersPdf.filename(), answersPdf == null ? null : answersPdf.bytes());
        };
        if (key.isBlank()) return write.get();
        if (auth.apiKey() || auth.user() == null || personalWorkbookAccess == null || personalWorkbookReceipts == null) {
            throw new org.springframework.security.access.AccessDeniedException("Idempotent lesson preparation requires school OAuth sign-in");
        }
        AuthenticatedUser actor = personalWorkbookAccess.requireActor(auth.user());
        personalWorkbookAccess.requireTeacher(actor, teacher.id());
        Map<String, Object> normalized = new LinkedHashMap<>();
        normalized.put("teacherId", teacher.id().toString());
        normalized.put("eventId", eventId);
        normalized.put("homeworkNotes", notes.homeworkNotes());
        normalized.put("difficulties", notes.difficulties());
        normalized.put("lessonPlan", notes.lessonPlan());
        normalized.put("workbook", workbook == null ? null : workbook.identity());
        normalized.put("answers", answers == null ? null : answers.identity());
        return personalWorkbookReceipts.execute(actor, teacher.id(), "prepare_lesson", key, normalized,
                () -> requireLesson(personalWorkbookAccess.requireTeacher(actor, teacher.id()), eventId),
                () -> personalWorkbookAccess.asTeacher(actor, teacher, write));
    }

    private McpPdfSource pdfSource(Map<String, Object> arguments, String fileField, String base64Field,
            String driveField, String explicitFilename, String fallbackFilename) {
        String base64 = string(arguments.get(base64Field)).trim();
        String driveId = string(arguments.get(driveField)).trim();
        boolean hasFile = arguments.containsKey(fileField);
        int count = (hasFile ? 1 : 0) + (base64.isBlank() ? 0 : 1) + (driveId.isBlank() ? 0 : 1);
        if (count > 1) throw new IllegalArgumentException("exactly_one_source_required: Provide at most one PDF source: " + fileField + ", " + base64Field + " or " + driveField);
        if (count == 0) return null;
        boolean explicitLegacyAnswers = "workbookFile".equals(fileField) && explicitFilename != null
                && explicitFilename.trim().toLowerCase(Locale.ROOT).startsWith("__answers__:");
        String selectedFilename = explicitLegacyAnswers ? explicitFilename.trim().substring("__answers__:".length()) : explicitFilename;
        ChatGptFileReference reference = hasFile
                ? requirePdfResolver().reference(arguments.get(fileField), fileField, selectedFilename, fallbackFilename) : null;
        String filename = reference == null ? normalizedPdfFilename(explicitFilename, fallbackFilename) : reference.filename();
        if (reference != null && explicitLegacyAnswers) filename = "__answers__:" + filename;
        return new McpPdfSource(filename, base64, driveId, reference, base64Field);
    }

    private PdfInput resolvePdfSource(McpPdfSource source, UUID teacherId) {
        if (source == null) return null;
        if (source.file() != null) {
            PdfInput file = requirePdfResolver().resolve(source.file());
            return new PdfInput(source.filename(), file.bytes(), file.fileId());
        }
        try {
            byte[] pdf = source.base64().isBlank()
                    ? teacherDriveDownloadService.downloadForTeacher(teacherId, source.driveId(), source.filename())
                    : decodePdfBase64(source.base64(), source.base64Field());
            if (!looksLikePdf(pdf) || pdf.length > MAX_DIRECT_PDF_BYTES) {
                throw new IllegalArgumentException("Lesson file must be a PDF of at most 15 MB");
            }
            return new PdfInput(source.filename(), pdf, "");
        } catch (org.springframework.web.server.ResponseStatusException | IllegalArgumentException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new IllegalArgumentException("The selected teacher's lesson PDF could not be imported");
        }
    }

    private ChatGptPdfResolver requirePdfResolver() {
        if (chatGptPdfResolver == null) throw new IllegalStateException("ChatGPT PDF uploads are unavailable");
        return chatGptPdfResolver;
    }

    private record McpPdfSource(String filename, String base64, String driveId, ChatGptFileReference file, String base64Field) {
        Map<String, Object> identity() {
            if (file != null) return Map.of("source", "file", "filename", filename, "file", file.identity());
            if (!driveId.isBlank()) return Map.of("source", "drive", "driveFileId", driveId, "filename", filename);
            String encoded = base64;
            int comma = encoded.indexOf(',');
            if (encoded.regionMatches(true, 0, "data:", 0, 5) && comma >= 0) encoded = encoded.substring(comma + 1);
            try {
                return Map.of("source", "base64", "filename", filename, "sha256",
                        java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                                .digest(encoded.getBytes(StandardCharsets.UTF_8))));
            } catch (java.security.NoSuchAlgorithmException failure) {
                throw new IllegalStateException("Unable to identify lesson PDF");
            }
        }
    }

    private LessonPreparationResponse attachLessonAnswers(Map<String, Object> arguments, AuthContext auth) throws Exception {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);
        String driveFileId = required(arguments, "driveFileId");
        String filename = normalizedPdfFilename(string(arguments.get("filename")), "lesson-answers.pdf");
        byte[] pdf = teacherDriveDownloadService.downloadForTeacher(teacher.id(), driveFileId, filename);
        if (!looksLikePdf(pdf)) throw new IllegalArgumentException("driveFileId does not point to a PDF file");
        return preparationService.uploadAnswers(teacher, eventId, filename, pdf);
    }

    private LessonPreparationResponse attachLessonTranscript(Map<String, Object> arguments, AuthContext auth) throws Exception {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);
        String driveFileId = required(arguments, "driveFileId");
        String rawFilename = required(arguments, "filename");
        String filename = normalizedPdfFilename(rawFilename, "lesson-transcript.pdf");
        transcriptLessonGuard.validate(teacher, eventId, filename);
        byte[] pdf = teacherDriveDownloadService.downloadForTeacher(teacher.id(), driveFileId, filename);
        if (!looksLikePdf(pdf)) throw new IllegalArgumentException("driveFileId does not point to a PDF file");
        return preparationService.uploadTranscript(teacher, eventId, filename, pdf);
    }

    private Map<String, Object> auditLessonTranscripts(AuthContext auth) {
        if (!auth.apiKey() && (auth.user() == null || auth.user().getRole() != Role.ADMIN)) {
            throw new IllegalArgumentException("audit_lesson_transcripts is admin-only");
        }
        return transcriptLessonGuard.auditAll();
    }

    private MonthlyPlanResponse getMonthPlan(Map<String, Object> arguments, AuthContext auth) {
        String targetType = required(arguments, "targetType");
        UUID targetId = uuid(required(arguments, "targetId"), "targetId");
        AuthenticatedUser teacher = homeworkTeacher(arguments, auth, targetType, targetId);
        return monthlyPlanService.get(teacher, targetType, targetId, required(arguments, "month"));
    }

    private MonthlyPlanResponse updateMonthPlan(Map<String, Object> arguments, AuthContext auth) {
        String targetType = required(arguments, "targetType");
        UUID targetId = uuid(required(arguments, "targetId"), "targetId");
        AuthenticatedUser teacher = homeworkTeacher(arguments, auth, targetType, targetId);
        return monthlyPlanService.save(
                teacher,
                targetType,
                targetId,
                required(arguments, "month"),
                required(arguments, "planJson"));
    }

    @SuppressWarnings("unchecked")
    private Map<String,Object> createLessonDraft(Map<String,Object> args,AuthContext auth) throws Exception {
        requireWorkbookStaff(auth);
        if(!java.util.Set.of("teacherId","eventId","lessonJson","contextToken","idempotencyKey").containsAll(args.keySet()))
            throw new IllegalArgumentException("Unsupported lesson draft arguments");
        String lessonJson=required(args,"lessonJson");
        if(lessonJson.length()>OwnerWorkbookPdfRenderService.MAX_INPUT_CHARS)throw new IllegalArgumentException("lessonJson is too large");
        Map<String,Object> parsed=objectMapper.readValue(lessonJson,Map.class);
        if (ownerWorkbookPdfRenderService != null
                && parsed.get("meta") instanceof Map<?,?>
                && parsed.get("workbookPages") instanceof List<?>
                && parsed.get("teacherPages") instanceof List<?>) {
            return writeWorkbookDraft("create_lesson_draft",args,auth,(teacher,eventId,scoped)->{
                GroupLessonResponse lesson=selectedWorkbookLesson(teacher,eventId);
                Map<String,Object> safeMeta=new LinkedHashMap<>((Map<String,Object>)parsed.get("meta"));
                safeMeta.put("durationMinutes",Math.toIntExact(java.time.Duration.between(lesson.startsAt(),lesson.endsAt()).toMinutes()));
                parsed.put("meta",safeMeta);
                Map<String,Object> generation=new LinkedHashMap<>(scoped);
                generation.put("lessonJson",objectMapper.writeValueAsString(parsed));
                generation.put("lessonPlan",string(parsed.get("lessonPlan")));
                generation.put("difficulties",string(parsed.get("difficulties")));
                return generateWorkbook(generation,auth);
            });
        }
        return writeWorkbookDraft("create_lesson_draft",args,auth,(teacher,eventId,scoped)->{
            GroupLessonResponse lesson=selectedWorkbookLesson(teacher,eventId);
            String name=lesson.groupName()!=null?lesson.groupName():lesson.studentName()!=null?lesson.studentName():lesson.title();
            return lessonPdfDraftService.create(teacher,eventId,name,lessonJson);
        });
    }

    private AuthenticatedUser draftTeacher(Map<String,Object> args, AuthContext auth) {
        requireWorkbookStaff(auth);
        AuthenticatedUser actor = personalWorkbookAccess.requireActor(auth.user());
        return personalWorkbookAccess.requireTeacher(actor,
                args.containsKey("teacherId") ? uuid(required(args,"teacherId"),"teacherId") : null);
    }

    private Map<String,Object> draftInfo(Map<String,Object> args, AuthContext auth) {
        AuthenticatedUser teacher = draftTeacher(args,auth);
        Map<String,Object> info = lessonPdfDraftService.info(teacher,uuid(required(args,"draftId"),"draftId"));
        requireLesson(teacher,String.valueOf(info.get("eventId")));
        return withWorkbookDownloadLinks(info,personalWorkbookAccess.requireActor(auth.user()),teacher);
    }

    private Map<String,Object> draftDownload(Map<String,Object> args, AuthContext auth) throws Exception {
        AuthenticatedUser teacher = draftTeacher(args,auth);
        UUID id = uuid(required(args,"draftId"),"draftId");
        Map<String,Object> info = lessonPdfDraftService.info(teacher,id);
        requireLesson(teacher,String.valueOf(info.get("eventId")));
        String kind=required(args,"kind");
        Map<String,Object> result=new LinkedHashMap<>(lessonPdfDraftService.download(teacher,id,kind));
        if(workbookDraftDownloads!=null) result.putAll(workbookDraftDownloads.create(personalWorkbookAccess.requireActor(auth.user()),teacher.id(),id,kind));
        return result;
    }
    private Map<String,Object> publishLessonDraft(Map<String,Object> args,AuthContext auth) throws Exception {
        requireWorkbookStaff(auth);
        AuthenticatedUser actor=personalWorkbookAccess.requireActor(auth.user());
        UUID requestedTeacher=args.containsKey("teacherId")?uuid(required(args,"teacherId"),"teacherId"):null;
        AuthenticatedUser teacher=personalWorkbookAccess.requireTeacher(actor,requestedTeacher);
        UUID id=uuid(required(args,"draftId"),"draftId");
        if(!booleanValue(args.get("confirm"),"confirm"))throw new IllegalArgumentException("Explicit confirmation required");
        Map<String,Object> d=lessonPdfDraftService.info(teacher,id);
        String eventId=String.valueOf(d.get("eventId"));
        @SuppressWarnings("unchecked") Map<String,Object> result=(Map<String,Object>)personalWorkbookReceipts.execute(actor,teacher.id(),"publish_lesson_draft",
                required(args,"idempotencyKey"),Map.of("teacherId",teacher.id().toString(),"draftId",id.toString(),"eventId",eventId),
                () -> requireLesson(personalWorkbookAccess.requireTeacher(actor,teacher.id()),eventId),
                () -> personalWorkbookAccess.asTeacher(actor,teacher,() -> {
                    try { return lessonPdfDraftService.publish(teacher,id,true); }
                    catch (RuntimeException ex) { throw ex; }
                    catch (Exception ex) { throw new IllegalStateException("Draft publication failed",ex); }
                }));
        LessonPreparationResponse current=preparationService.read(teacher,eventId);
        if(!current.hasWorkbook()||!current.hasAnswers()||!eventId.equals(current.eventId())
                ||!String.valueOf(result.get("workbookFilename")).equals(current.workbookFilename())
                ||!String.valueOf(result.get("answersFilename")).equals(current.answersFilename()))
            throw new IllegalStateException("Approved draft is no longer the lesson's current materials; review the lesson before publishing again");
        return result;
    }
    private Map<String, Object> findHomeworkTargets(Map<String, Object> arguments, AuthContext auth) {
        String query = string(arguments.get("query"));
        if (auth.user() != null && auth.user().getRole() == Role.TEACHER) return homeworkTargetsForTeacher(auth.user(), query);
        String requestedTeacherId = string(arguments.get("teacherId")).trim();
        if (!requestedTeacherId.isBlank()) return homeworkTargetsForTeacher(requireHomeworkTeacher(requestedTeacherId), query);
        List<Map<String, Object>> targets = new ArrayList<>();
        for (User teacher : accessibleTeachers(auth)) if (!teacher.isArchived()) targets.addAll(homeworkTargetListForTeacher(teacher, query));
        return Map.of("targets", targets);
    }

    private Map<String, Object> homeworkTargetsForTeacher(User teacher, String query) { return Map.of("targets", homeworkTargetListForTeacher(teacher, query)); }

    private List<Map<String, Object>> homeworkTargetListForTeacher(User teacher, String query) {
        Map<String, Object> result = homeworkSeriesService.findTargets(principal(teacher), query);
        List<Map<String, Object>> targets = new ArrayList<>();
        Object rawTargets = result.get("targets");
        if (!(rawTargets instanceof List<?> list)) return targets;
        for (Object rawTarget : list) {
            if (!(rawTarget instanceof Map<?, ?> rawMap)) continue;
            Map<String, Object> item = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : rawMap.entrySet()) item.put(String.valueOf(entry.getKey()), entry.getValue());
            item.put("teacherId", teacher.getId().toString());
            item.put("teacherName", teacher.getFullName());
            targets.add(item);
        }
        return targets;
    }

    private Map<String, Object> assignHomeworkSeries(Map<String, Object> arguments, AuthContext auth) throws Exception {
        String targetType = required(arguments, "targetType");
        UUID targetId = uuid(required(arguments, "targetId"), "targetId");
        AuthenticatedUser teacher = homeworkTeacher(arguments, auth, targetType, targetId);
        LocalDate startDate;
        try { startDate = LocalDate.parse(required(arguments, "startDate")); } catch (RuntimeException ex) { throw new IllegalArgumentException("startDate must use YYYY-MM-DD format"); }
        int days = integer(arguments.get("days"), "days");
        List<String> filenames = arguments.containsKey("filenames") ? stringList(arguments.get("filenames"), "filenames") : List.of();
        boolean hasDirect = arguments.containsKey("pdfBase64");
        boolean hasDrive = arguments.containsKey("driveFileIds");
        if (hasDirect == hasDrive) {
            throw new IllegalArgumentException("Provide exactly one PDF source: pdfBase64 or driveFileIds");
        }
        if (hasDirect) {
            List<String> encodedPdfs = stringList(arguments.get("pdfBase64"), "pdfBase64");
            List<byte[]> pdfs = new ArrayList<>();
            for (int i = 0; i < encodedPdfs.size(); i++) {
                pdfs.add(decodePdfBase64(encodedPdfs.get(i), "pdfBase64[" + i + "]"));
            }
            return homeworkSeriesService.assignDirectSeries(teacher, targetType, targetId, startDate, days, pdfs, filenames);
        }
        List<String> driveFileIds = stringList(arguments.get("driveFileIds"), "driveFileIds");
        return homeworkSeriesService.assignSeries(teacher, targetType, targetId, startDate, days, driveFileIds, filenames);
    }

    private AuthenticatedUser homeworkTeacher(Map<String, Object> arguments, AuthContext auth, String targetType, UUID targetId) {
        if (auth.user() != null && auth.user().getRole() == Role.TEACHER) return principal(auth.user());
        String requestedTeacherId = string(arguments.get("teacherId")).trim();
        if (!requestedTeacherId.isBlank()) return principal(requireHomeworkTeacher(requestedTeacherId));
        List<User> matches = new ArrayList<>();
        for (User teacher : accessibleTeachers(auth)) {
            if (teacher.isArchived()) continue;
            Map<String, Object> result = homeworkSeriesService.findTargets(principal(teacher), "");
            if (containsHomeworkTarget(result, targetType, targetId)) matches.add(teacher);
        }
        if (matches.isEmpty()) throw new IllegalArgumentException("Homework target was not found under any accessible teacher");
        if (matches.size() > 1) throw new IllegalArgumentException("Homework target is ambiguous across teachers; pass teacherId returned by find_homework_targets");
        return principal(matches.get(0));
    }

    private boolean containsHomeworkTarget(Map<String, Object> result, String targetType, UUID targetId) {
        Object rawTargets = result.get("targets");
        if (!(rawTargets instanceof List<?> list)) return false;
        String normalizedType = normalize(targetType);
        String expectedId = targetId.toString();
        for (Object rawTarget : list) {
            if (!(rawTarget instanceof Map<?, ?> rawMap)) continue;
            String type = normalize(string(rawMap.get("type")));
            String id = string(rawMap.get("id"));
            if (normalizedType.equals(type) && expectedId.equals(id)) return true;
        }
        return false;
    }

    private User requireHomeworkTeacher(String teacherId) {
        UUID id = uuid(teacherId, "teacherId");
        return userRepository.findById(id).filter(user -> user.getRole() == Role.TEACHER).filter(user -> !user.isArchived()).orElseThrow(() -> new IllegalArgumentException("Teacher not found"));
    }

    private AuthenticatedUser requireTeacher(Map<String, Object> arguments, AuthContext auth) {
        String teacherId = !arguments.containsKey("teacherId") && !auth.apiKey() && auth.user() != null && auth.user().getRole() == Role.TEACHER
                ? auth.user().getId().toString() : required(arguments, "teacherId");
        UUID id = uuid(teacherId, "teacherId");
        if (!auth.apiKey() && auth.user() != null && auth.user().getRole() == Role.TEACHER && !auth.user().getId().equals(id)) throw new IllegalArgumentException("You can access only your own lessons");
        User teacher = userRepository.findById(id).filter(user -> user.getRole() == Role.TEACHER).filter(user -> !user.isArchived()).orElseThrow(() -> new IllegalArgumentException("Teacher not found"));
        return principal(teacher);
    }

    private AuthenticatedUser principal(User teacher) { return new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole()); }
    private void requireLesson(AuthenticatedUser teacher, String eventId) { if (calendarLessonService.listGroupLessons(teacher).stream().noneMatch(lesson -> lesson.eventId().equals(eventId))) throw new IllegalArgumentException("Lesson event was not found in the current calendar window"); }

    private byte[] decodePdfBase64(String value, String field) {
        try {
            String encoded = value == null ? "" : value.trim();
            int comma = encoded.indexOf(',');
            if (encoded.regionMatches(true, 0, "data:", 0, 5) && comma >= 0) encoded = encoded.substring(comma + 1);
            byte[] bytes = Base64.getDecoder().decode(encoded);
            if (!looksLikePdf(bytes)) throw new IllegalArgumentException(field + " does not contain a valid PDF file");
            if (bytes.length > MAX_DIRECT_PDF_BYTES) throw new IllegalArgumentException(field + " exceeds the 15 MB direct-upload limit");
            return bytes;
        } catch (IllegalArgumentException ex) {
            if (ex.getMessage() != null && ex.getMessage().startsWith(field)) throw ex;
            throw new IllegalArgumentException(field + " must be valid base64 PDF data");
        }
    }

    private String normalizedPdfFilename(String filename, String fallback) {
        String value = filename == null ? "" : filename.trim();
        if (value.isBlank()) value = fallback;
        value = value.replace("/", "_").replace("\\", "_").replace("\"", "");
        if (!value.toLowerCase(Locale.ROOT).endsWith(".pdf")) value += ".pdf";
        return value;
    }

    private boolean looksLikePdf(byte[] bytes) { return bytes != null && bytes.length >= 5 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F' && bytes[4] == '-'; }

    private AuthContext authenticationContext(String authorization, String suppliedApiKey) {
        String explicitApiKey = suppliedApiKey == null ? "" : suppliedApiKey.trim();
        if (hasValidApiKey(explicitApiKey)) return new AuthContext(true, true, null);
        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            String bearer = authorization.substring(7).trim();
            User oauthUser = oauthService.resolveAccessToken(bearer).orElse(null);
            if (oauthUser != null && (oauthUser.getRole() == Role.ADMIN || oauthUser.getRole() == Role.TEACHER)) return new AuthContext(true, false, oauthUser);
            if (hasValidApiKey(bearer)) return new AuthContext(true, true, null);
        }
        return new AuthContext(false, false, null);
    }

    private boolean hasValidApiKey(String candidate) { return !apiKey.isBlank() && candidate != null && !candidate.isBlank() && MessageDigest.isEqual(apiKey.getBytes(StandardCharsets.UTF_8), candidate.getBytes(StandardCharsets.UTF_8)); }
    private Map<String, Object> readOnlyAnnotations() { return Map.of("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false); }
    private Map<String, Object> writeAnnotations() { return Map.of("readOnlyHint", false, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false); }
    private Map<String, Object> destructiveWriteAnnotations() { return Map.of("readOnlyHint", false, "destructiveHint", true, "idempotentHint", false, "openWorldHint", false); }
    private Map<String, Object> tool(String name, String description, Map<String, Object> inputSchema, Map<String, Object> annotations) {
        Map<String, Object> tool = new LinkedHashMap<>();
        tool.put("name", name); tool.put("description", description); tool.put("inputSchema", inputSchema); tool.put("annotations", annotations);
        if ("get_lesson_preparation".equals(name) || "list_personal_lesson_workbooks".equals(name)) {
            tool.put("_meta", Map.of("ui", Map.of("visibility", List.of("model", "app")), "openai/widgetAccessible", true));
        }
        return tool;
    }
    private Map<String, Object> fileTool(String name, String description, Map<String, Object> inputSchema,
            Map<String, Object> annotations, List<String> fileParameters) {
        Map<String, Object> result = tool(name, description + " For PDFs generated or attached in ChatGPT, prefer direct file input. Do not upload to Google Drive as an intermediate step. Use Google Drive only when the source document already exists there. When the PDFs already have ChatGPT file IDs, prefer prepare_lesson_file_transfer; its panel also provides a direct-transfer fallback when host file-argument translation fails.", inputSchema, annotations);
        result.put("_meta", Map.of("openai/fileParams", fileParameters));
        return result;
    }
    private Map<String, Object> personalPdfSourcesSchema(Map<String, Object> properties) {
        // Keep file-tool contracts flat for host schema normalization. Source
        // exclusivity and conditional filenames are validated before downloads.
        return schema(properties, List.of("teacherId", "eventId", "studentId", "idempotencyKey"));
    }
    private Map<String, Object> schema(Map<String, Object> properties, List<String> required) { Map<String, Object> schema = new LinkedHashMap<>(); schema.put("type", "object"); schema.put("properties", properties); if (!required.isEmpty()) schema.put("required", required); schema.put("additionalProperties", false); return schema; }
    private Map<String, Object> property(String type, String description) { return Map.of("type", type, "description", description); }
    private Map<String, Object> arrayProperty(String description) { Map<String, Object> value = new LinkedHashMap<>(); value.put("type", "array"); value.put("description", description); value.put("items", Map.of("type", "string")); return value; }
    private Map<String, Object> siteToolFailure(Exception failure) throws Exception {
        int status = 500;
        String message = "The site function could not be completed";
        if (failure instanceof org.springframework.security.access.AccessDeniedException) {
            status = 403;
            message = "This school account is not allowed to perform this action";
        } else if (failure instanceof org.springframework.web.server.ResponseStatusException expected) {
            status = expected.getStatusCode().value();
            if (status < 500) message = expected.getReason() == null ? "The site action was rejected" : expected.getReason();
        } else if (failure instanceof com.mcschool.flashcard.common.ResourceNotFoundException) {
            status = 404;
            message = "The requested school resource was not found or is not accessible";
        } else if (failure instanceof com.mcschool.flashcard.common.ConflictException) {
            status = 409;
            message = failure.getMessage() == null ? "The site action conflicts with current data" : failure.getMessage();
        } else if (failure instanceof IllegalArgumentException) {
            status = 400;
            message = failure.getMessage() == null ? "Invalid site function arguments" : failure.getMessage();
        } else if (failure instanceof jakarta.validation.ConstraintViolationException) {
            status = 400;
            message = "The supplied fields do not satisfy the website validation rules";
        }
        message = message.replaceAll("[\\r\\n]+", " ");
        if (message.length() > 400) message = message.substring(0, 400);
        Map<String, Object> result = toolResult(Map.of("success", false, "status", status, "message", message));
        result.put("isError", true);
        return result;
    }

    private Map<String, Object> toolResult(Object value) throws Exception { Map<String, Object> result = new LinkedHashMap<>(); result.put("content", List.of(Map.of("type", "text", "text", objectMapper.writeValueAsString(value)))); result.put("structuredContent", value); result.put("isError", false); return result; }
    private Map<String, Object> success(Object id, Object result) { Map<String, Object> response = new LinkedHashMap<>(); response.put("jsonrpc", "2.0"); response.put("id", id); response.put("result", result); return response; }
    private Map<String, Object> error(Object id, int code, String message) { Map<String, Object> response = new LinkedHashMap<>(); response.put("jsonrpc", "2.0"); response.put("id", id); response.put("error", Map.of("code", code, "message", message == null ? "Error" : message)); return response; }
    @SuppressWarnings("unchecked") private Map<String, Object> map(Object value) { if (value instanceof Map<?, ?> map) return (Map<String, Object>) map; return Map.of(); }
    private String required(Map<String, Object> values, String key) { String value = string(values.get(key)); if (value.isBlank()) throw new IllegalArgumentException(key + " is required"); return value; }
    private String optional(Map<String, Object> values, String key, String fallback) { if (!values.containsKey(key)) return fallback; Object raw = values.get(key); return raw == null ? null : String.valueOf(raw); }
    private String string(Object value) { return value == null ? "" : String.valueOf(value); }
    private String normalize(String value) { return string(value).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim(); }
    private UUID uuid(String value, String field) { try { return UUID.fromString(value); } catch (IllegalArgumentException ex) { throw new IllegalArgumentException(field + " must be a UUID"); } }
    private LocalDate date(Map<String, Object> values, String field) { try { return LocalDate.parse(required(values, field)); } catch (RuntimeException ex) { throw new IllegalArgumentException(field + " must use YYYY-MM-DD format"); } }
    private int integer(Object value, String field) { if (value instanceof Number number) return number.intValue(); try { return Integer.parseInt(string(value)); } catch (RuntimeException ex) { throw new IllegalArgumentException(field + " must be an integer"); } }
    private boolean booleanValue(Object value, String field) { if (value instanceof Boolean flag) return flag; String text = string(value).trim(); if ("true".equalsIgnoreCase(text)) return true; if ("false".equalsIgnoreCase(text)) return false; throw new IllegalArgumentException(field + " must be a boolean"); }
    private List<String> stringList(Object value, String field) { if (!(value instanceof List<?> list)) throw new IllegalArgumentException(field + " must be an array of strings"); List<String> result = new ArrayList<>(); for (Object item : list) { String text = string(item).trim(); if (text.isBlank()) throw new IllegalArgumentException(field + " cannot contain blank values"); result.add(text); } return result; }
    private record AuthContext(boolean authenticated, boolean apiKey, User user) {}
}
