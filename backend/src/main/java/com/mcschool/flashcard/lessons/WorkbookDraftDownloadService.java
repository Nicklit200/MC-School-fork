package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Five-minute staff-issued capabilities. Every redemption rechecks live authority. */
@Service
public class WorkbookDraftDownloadService {
    private final McpAccessService access;
    private final LessonPdfDraftService drafts;
    private final GoogleCalendarLessonService lessons;
    private final byte[] key;
    private final String baseUrl;
    private final Clock clock;

    @Autowired
    public WorkbookDraftDownloadService(McpAccessService access, LessonPdfDraftService drafts,
            GoogleCalendarLessonService lessons,
            @Value("${WORKBOOK_DOWNLOAD_SECRET:${JWT_SECRET:}}") String secret,
            @Value("${PUBLIC_BASE_URL:${MINDCRAFTI_PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}}") String baseUrl) {
        this(access,drafts,lessons,secret,baseUrl,Clock.systemUTC());
    }

    WorkbookDraftDownloadService(McpAccessService access,LessonPdfDraftService drafts,GoogleCalendarLessonService lessons,
            String secret,String baseUrl,Clock clock) {
        this.access=access; this.drafts=drafts; this.lessons=lessons;
        this.key=(secret==null?"":secret).getBytes(StandardCharsets.UTF_8);
        this.baseUrl=baseUrl.replaceAll("/+$",""); this.clock=clock;
    }

    /**
     * Authenticated website preview. No expiring capability is issued:
     * every request rechecks staff status, selected teacher, exact lesson,
     * and the original draft ownership before returning private PDF bytes.
     */
    public LessonPdfDraftService.PreviewFile staffPreview(AuthenticatedUser actor,
            UUID teacherId, UUID draftId, String kind) {
        AuthenticatedUser current = access.requireCurrentActor(actor);
        requireStaff(current);
        AuthenticatedUser teacher = access.requireTeacher(current, teacherId);
        return authorizedFile(teacher, draftId, kind(kind));
    }

    public Map<String,Object> create(AuthenticatedUser actor,UUID teacherId,UUID draftId,String kind) {
        requireConfigured();
        kind=kind(kind);
        AuthenticatedUser current=access.requireCurrentActor(actor);
        requireStaff(current);
        AuthenticatedUser teacher=access.requireTeacher(current,teacherId);
        if(teacher==null||teacher.role()!=Role.TEACHER||!teacher.id().equals(teacherId))throw denied();
        LessonPdfDraftService.PreviewFile file=authorizedFile(teacher,draftId,kind);
        long expires=clock.instant().plusSeconds(300).getEpochSecond();
        String hash=hash(file.bytes());
        String payload="v1:"+current.id()+":"+current.role()+":"+teacher.id()+":"+draftId+":"+kind+":"+expires+":"+hash;
        String encoded=Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        String token=encoded+"."+Base64.getUrlEncoder().withoutPadding().encodeToString(sign(encoded));
        return Map.of("downloadUrl",baseUrl+"/api/v1/public/workbook-drafts/download?token="+token,
                "expiresAt",Instant.ofEpochSecond(expires).toString(),"filename",file.filename(),
                "sizeBytes",file.bytes().length,"sha256",hash);
    }

    public LessonPdfDraftService.PreviewFile download(String token) {
        requireConfigured();
        if(token==null||token.isBlank()||token.length()>800)throw denied();
        String[] parts=token.split("\\.",-1);
        if(parts.length!=2)throw denied();
        byte[] signature;
        try { signature=Base64.getUrlDecoder().decode(parts[1]); }
        catch(IllegalArgumentException ex) { throw denied(); }
        // No database access happens until authentication of the complete payload.
        if(signature.length!=32||!MessageDigest.isEqual(sign(parts[0]),signature))throw denied();
        String[] fields;
        try { fields=new String(Base64.getUrlDecoder().decode(parts[0]),StandardCharsets.UTF_8).split(":",-1); }
        catch(IllegalArgumentException ex) { throw denied(); }
        if(fields.length!=8||!"v1".equals(fields[0]))throw denied();
        try {
            long expires=Long.parseLong(fields[6]), now=clock.instant().getEpochSecond();
            if(expires<=now||expires>now+300)throw denied();
            AuthenticatedUser actor=access.requireCurrentActor(new AuthenticatedUser(UUID.fromString(fields[1]),null,Role.valueOf(fields[2])));
            requireStaff(actor);
            AuthenticatedUser teacher=access.requireTeacher(actor,UUID.fromString(fields[3]));
            if(teacher==null||teacher.role()!=Role.TEACHER||!teacher.id().equals(UUID.fromString(fields[3])))throw denied();
            LessonPdfDraftService.PreviewFile file=authorizedFile(teacher,UUID.fromString(fields[4]),kind(fields[5]));
            if(!MessageDigest.isEqual(hash(file.bytes()).getBytes(StandardCharsets.US_ASCII),fields[7].getBytes(StandardCharsets.US_ASCII)))throw denied();
            return file;
        } catch(IllegalArgumentException ex) { throw denied(); }
    }

    private LessonPdfDraftService.PreviewFile authorizedFile(AuthenticatedUser teacher,UUID draftId,String kind) {
        Map<String,Object> info=drafts.info(teacher,draftId);
        String event=String.valueOf(info.get("eventId"));
        if(lessons.listGroupLessons(teacher).stream().noneMatch(lesson->event.equals(lesson.eventId())))throw denied();
        LessonPdfDraftService.PreviewFile file=drafts.previewFile(teacher,draftId,kind);
        if(!event.equals(file.eventId())||file.bytes()==null||file.bytes().length>15*1024*1024)throw denied();
        return file;
    }

    private void requireConfigured() {
        if(key.length<32)throw new IllegalStateException("Draft download links require a configured WORKBOOK_DOWNLOAD_SECRET or JWT_SECRET of at least 32 bytes");
    }
    private static void requireStaff(AuthenticatedUser actor) {
        if(actor==null||(actor.role()!=Role.TEACHER&&actor.role()!=Role.ADMIN))throw denied();
    }
    private static String kind(String kind) {
        if(!"workbook".equals(kind)&&!"answers".equals(kind))throw denied();
        return kind;
    }
    private String hash(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch(Exception ex) { throw new IllegalStateException("Cannot hash workbook draft",ex); }
    }
    private byte[] sign(String payload) {
        try {
            Mac mac=Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key,"HmacSHA256"));
            return mac.doFinal(("mindcrafti-workbook-download\n"+payload).getBytes(StandardCharsets.UTF_8));
        } catch(Exception ex) { throw new IllegalStateException("Cannot sign workbook draft link",ex); }
    }
    private static ResponseStatusException denied() { return new ResponseStatusException(HttpStatus.FORBIDDEN,"Invalid, expired or no longer authorized workbook draft link"); }
}
