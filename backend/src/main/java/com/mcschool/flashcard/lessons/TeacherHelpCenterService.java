package com.mcschool.flashcard.lessons;

import java.io.IOException;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.ObjectMapper;

/** Published handbook is shared between MCH3 and the authenticated website.
 *  Drafts never affect the connector until published. */
@Service
public class TeacherHelpCenterService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private static final String ID_RULE = "[a-z0-9-]{1,80}";

    public record Revision(long revision, String articleId, String publishedJson, Instant publishedAt) {}
    public record ImageData(String mimeType, byte[] bytes) {}
    public record EditorEntry(String id, McpTeacherGuideService.Article draft,
                              McpTeacherGuideService.Article published,
                              long revision, Instant publishedAt, Instant updatedAt) {}

    public TeacherHelpCenterService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc=jdbc; this.json=json;
    }

    public Map<String,McpTeacherGuideService.Article> published() {
        var result=new LinkedHashMap<String,McpTeacherGuideService.Article>();
        jdbc.query("SELECT article_id,published_json FROM teacher_help_articles WHERE published_json IS NOT NULL",
            rs -> result.put(rs.getString(1), parseArticle(rs.getString(2))));
        return result;
    }

    public List<EditorEntry> editorEntries() {
        return jdbc.query("SELECT article_id,draft_json,published_json,revision,published_at,updated_at FROM teacher_help_articles ORDER BY article_id",
            (rs,n)->new EditorEntry(rs.getString(1), parseNullable(rs.getString(2)),
                parseNullable(rs.getString(3)), rs.getLong(4),
                instant(rs.getTimestamp(5)), instant(rs.getTimestamp(6))));
    }

    public List<Revision> history(String id) {
        validateId(id);
        return jdbc.query("SELECT revision,article_id,published_json,published_at FROM teacher_help_history WHERE article_id=? ORDER BY revision DESC",
            (rs,n)->new Revision(rs.getLong(1),rs.getString(2),rs.getString(3),
                instant(rs.getTimestamp(4))), id);
    }

    public Optional<ImageData> image(String id) {
        if(id==null||!id.matches(ID_RULE))return Optional.empty();
        return jdbc.query("SELECT mime_type,image_data FROM teacher_help_images WHERE image_id=?",
            (rs,n)->new ImageData(rs.getString(1),rs.getBytes(2)),id).stream().findFirst();
    }

    public List<McpTeacherGuideService.GuideImage> customImages() {
        return jdbc.query("SELECT meta_json FROM teacher_help_images ORDER BY image_id",
            (rs,n)->readImage(rs.getString(1)));
    }

    /** Saves a draft only; the public website and MCH3 keep the previous published revision. */
    @Transactional
    public EditorEntry saveDraft(String id, McpTeacherGuideService.Article article) {
        validateId(id);
        var normalized=normalize(id,article);
        String payload=write(normalized);
        jdbc.update("""
            INSERT INTO teacher_help_articles(article_id,draft_json,updated_at) VALUES(?,?,now())
            ON CONFLICT(article_id) DO UPDATE SET draft_json=excluded.draft_json,updated_at=now()
            """,id,payload);
        return editorEntries().stream().filter(x->x.id().equals(id)).findFirst().orElseThrow();
    }

    @Transactional
    public EditorEntry publish(String id) {
        validateId(id);
        var draft=jdbc.query("SELECT draft_json FROM teacher_help_articles WHERE article_id=? FOR UPDATE",
            (rs,n)->rs.getString(1),id).stream().findFirst()
            .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Article not found"));
        if(draft==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Save a draft before publishing");
        var article=parseArticle(draft);
        for(var imageId:article.imageIds()){
            if(!imageId.matches(ID_RULE))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid image ID");
        }
        jdbc.update("UPDATE teacher_help_articles SET published_json=?,revision=revision+1,published_at=now(),updated_at=now() WHERE article_id=?",
            draft,id);
        jdbc.update("""
            INSERT INTO teacher_help_history(article_id,revision,published_json)
            SELECT article_id,revision,published_json FROM teacher_help_articles WHERE article_id=?
            """,id);
        return editorEntries().stream().filter(x->x.id().equals(id)).findFirst().orElseThrow();
    }

    @Transactional
    public EditorEntry restore(String id,long revision) {
        validateId(id);
        String payload=jdbc.query("SELECT published_json FROM teacher_help_history WHERE article_id=? AND revision=?",
            (rs,n)->rs.getString(1),id,revision).stream().findFirst()
            .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Revision not found"));
        jdbc.update("UPDATE teacher_help_articles SET draft_json=?,updated_at=now() WHERE article_id=?",payload,id);
        return publish(id);
    }

    @Transactional
    public McpTeacherGuideService.GuideImage uploadImage(String id,String title,String description,
                                                         String mime,byte[] bytes) {
        validateId(id);
        if(!Set.of("image/jpeg","image/png","image/webp").contains(mime)||bytes==null||bytes.length<16||bytes.length>500_000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Use a JPEG, PNG or WebP image up to 500 KB");
        boolean valid = mime.equals("image/png") ? bytes.length>=8 && bytes[0]==(byte)137 && bytes[1]==80
            : mime.equals("image/jpeg") ? bytes[0]==(byte)255 && bytes[1]==(byte)216
            : bytes.length>=12 && bytes[0]=='R' && bytes[1]=='I' && bytes[2]=='F' && bytes[3]=='F'
                && bytes[8]=='W' && bytes[9]=='E' && bytes[10]=='B' && bytes[11]=='P';
        if(!valid)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid image bytes");
        var meta=new McpTeacherGuideService.GuideImage(id,limit(title,150),limit(description,800),
            java.time.LocalDate.now(java.time.ZoneId.of("Europe/Berlin")).toString(),List.of(id));
        jdbc.update("""
            INSERT INTO teacher_help_images(image_id,meta_json,mime_type,image_data)
            VALUES(?,?,?,?) ON CONFLICT(image_id) DO UPDATE
            SET meta_json=excluded.meta_json,mime_type=excluded.mime_type,image_data=excluded.image_data,uploaded_at=now()
            """,id,write(meta),mime,bytes);
        return meta;
    }

    private McpTeacherGuideService.Article normalize(String id,McpTeacherGuideService.Article a) {
        if(a==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Article is required");
        String title=limit(a.title(),180),summary=limit(a.summary(),400),body=limit(a.body(),30000);
        if(title.isBlank()||body.isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Title and text required");
        var keywords=cleanList(a.keywords(),60,120);
        var related=cleanList(a.related(),50,80);
        var imageIds=cleanList(a.imageIds(),30,80);
        related.forEach(this::validateId);
        imageIds.forEach(this::validateId);
        // Administrators write guidance, not claims that code files were verified.
        return new McpTeacherGuideService.Article(id,title,summary,keywords,
            "/teacher/help",body,related,List.of("Administrator-published Mindcrafti handbook"),imageIds);
    }
    private List<String> cleanList(List<String> values,int maxItems,int maxLen) {
        if(values==null)return List.of();
        if(values.size()>maxItems)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Too many entries");
        return values.stream().map(v->limit(v,maxLen)).filter(s->!s.isBlank()).distinct().toList();
    }
    private static String limit(String value,int max) {
        if(value==null)return "";
        if(value.length()>max)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Text too long");
        return value.trim();
    }
    private static void validateId(String id){
        if(id==null||!id.matches(ID_RULE))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid article ID");
    }
    private McpTeacherGuideService.Article parseNullable(String payload){
        return payload==null?null:parseArticle(payload);
    }
    private McpTeacherGuideService.Article parseArticle(String payload){
        try{return json.readValue(payload,McpTeacherGuideService.Article.class);}
        catch(Exception e){throw new IllegalStateException("Invalid stored teacher help article",e);}
    }
    private McpTeacherGuideService.GuideImage readImage(String payload){
        try{return json.readValue(payload,McpTeacherGuideService.GuideImage.class);}
        catch(Exception e){throw new IllegalStateException("Invalid stored teacher help image",e);}
    }
    private String write(Object o){return json.writeValueAsString(o);}
    private static Instant instant(java.sql.Timestamp t){return t==null?null:t.toInstant();}
}
