package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import java.util.Enumeration;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StoryTemplateMasterService {
    private static final short MASTER_ID = 1;
    private static final int MAX_PPTX_BYTES = 15 * 1024 * 1024;
    private static final int MCP_CHUNK_BYTES = 512 * 1024;
    private static final int MAX_ZIP_ENTRIES = 600;
    private static final Pattern SLIDE_ENTRY = Pattern.compile("ppt/slides/slide[0-9]+\\.xml");
    private final StoryTemplateMasterRepository repository;

    public StoryTemplateMasterService(StoryTemplateMasterRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> info(AuthenticatedUser user) {
        requireAdmin(user);
        return readMetadata();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> infoForMcp(User user, boolean apiKey) {
        requireMcpAdmin(user, apiKey);
        return readMetadata();
    }

    private Map<String, Object> readMetadata() {
        StoryTemplateMaster master = requireMaster();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("configured", master.isConfigured());
        result.put("filename", master.getFilename());
        result.put("version", master.getVersion());
        result.put("sha256", master.getSha256());
        result.put("sizeBytes", master.isConfigured() ? master.getPptxData().length : 0);
        result.put("updatedAt", master.getUpdatedAt() == null ? null : master.getUpdatedAt().toString());
        result.put("format", "PPTX");
        result.put("slideCount", master.isConfigured() ? 3 : 0);
        result.put("safeZone", Map.of("top", 125, "bottom", 125, "left", 65, "right", 65, "canvasWidth", 1080, "canvasHeight", 1920));
        result.put("rules", "Always download the current complete PPTX, clone it without changing background, fixed photo, logo, positions or graphic elements. Only replace text fields. Do not use long dash or promotional CTA. Render and visually inspect all three slides.");
        return result;
    }

    @Transactional
    public Map<String, Object> upload(AuthenticatedUser user, String filename, byte[] pptx) {
        requireAdmin(user);
        return replace(filename, pptx);
    }

    @Transactional
    public Map<String, Object> uploadFromMcp(User user, boolean apiKey, String filename, String base64, Long expectedVersion) {
        requireMcpAdmin(user, apiKey);
        StoryTemplateMaster current = requireMaster();
        if (expectedVersion == null || !expectedVersion.equals(current.getVersion())) {
            throw new IllegalArgumentException("Stale template version. Refresh get_story_template_info, then confirm replacement.");
        }
        byte[] decoded;
        try {
            String encoded = base64 == null ? "" : base64.trim();
            int comma = encoded.indexOf(',');
            if (encoded.startsWith("data:") && comma >= 0) encoded = encoded.substring(comma + 1);
            decoded = Base64.getDecoder().decode(encoded.replaceAll("\\s+", ""));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("pptxBase64 must contain valid base64 data");
        }
        return replace(filename, decoded);
    }

    private Map<String, Object> replace(String filename, byte[] bytes) {
        validatePptx(bytes);
        String safeName = filename == null ? "" : filename.replace('\\', '_').replace('/', '_').trim();
        if (safeName.isBlank()) safeName = "Mindcrafti_Stories_Master.pptx";
        if (!safeName.toLowerCase(java.util.Locale.ROOT).endsWith(".pptx")) {
            throw new IllegalArgumentException("File extension must be .pptx");
        }
        if (safeName.length() > 255) throw new IllegalArgumentException("File name too long");
        String digest;
        try {
            digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
        StoryTemplateMaster master = requireMaster();
        master.replace(safeName, bytes, digest);
        repository.saveAndFlush(master);
        return readMetadata();
    }

    @Transactional(readOnly = true)
    byte[] downloadForValidatedLink() {
        return readBytes();
    }

    @Transactional(readOnly = true)
    public byte[] download(AuthenticatedUser user) {
        requireAdmin(user);
        return readBytes();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> chunkForMcp(User user, boolean apiKey, long requestedVersion, int index) {
        requireMcpAdmin(user, apiKey);
        StoryTemplateMaster master = requireMaster();
        if (!master.isConfigured()) throw new IllegalArgumentException("Story master is not uploaded yet");
        if (master.getVersion() != requestedVersion) throw new IllegalArgumentException("Template version changed. Request info again.");
        byte[] bytes = master.getPptxData();
        int chunkCount = (bytes.length + MCP_CHUNK_BYTES - 1) / MCP_CHUNK_BYTES;
        if (index < 0 || index >= chunkCount) throw new IllegalArgumentException("chunkIndex is out of range");
        int start = index * MCP_CHUNK_BYTES;
        int length = Math.min(MCP_CHUNK_BYTES, bytes.length - start);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("filename", master.getFilename());
        result.put("version", master.getVersion());
        result.put("sha256", master.getSha256());
        result.put("chunkIndex", index);
        result.put("chunkCount", chunkCount);
        result.put("base64", Base64.getEncoder().encodeToString(java.util.Arrays.copyOfRange(bytes, start, start + length)));
        return result;
    }

    private byte[] readBytes() {
        StoryTemplateMaster master = requireMaster();
        if (!master.isConfigured()) throw new IllegalArgumentException("Story master is not uploaded yet");
        return master.getPptxData().clone();
    }

    private StoryTemplateMaster requireMaster() {
        return repository.findById(MASTER_ID).orElseThrow(() -> new IllegalStateException("Story master record is missing"));
    }

    private static void validatePptx(byte[] bytes) {
        if (bytes == null || bytes.length < 10 || bytes.length > MAX_PPTX_BYTES) {
            throw new IllegalArgumentException("PPTX must be between 10 bytes and 15 MB");
        }
        if (bytes[0] != 'P' || bytes[1] != 'K') throw new IllegalArgumentException("PPTX must be a ZIP-based Office file");
        int entries = 0;
        int slides = 0;
        boolean presentation = false;
        boolean contentTypes = false;
        long expandedBytes = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > MAX_ZIP_ENTRIES) throw new IllegalArgumentException("PPTX has too many ZIP entries");
                String name = entry.getName();
                if (name.contains("..") || name.startsWith("/")) throw new IllegalArgumentException("Unsafe file path in PPTX");
                if (SLIDE_ENTRY.matcher(name).matches()) slides++;
                if ("ppt/presentation.xml".equals(name)) presentation = true;
                if ("[Content_Types].xml".equals(name)) contentTypes = true;
                byte[] buf = new byte[8192];
                int n;
                while ((n = zip.read(buf)) != -1) {
                    expandedBytes += n;
                    if (expandedBytes > 120L * 1024 * 1024) throw new IllegalArgumentException("PPTX decompressed content exceeds safety limit");
                }
                zip.closeEntry();
            }
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("Invalid PPTX archive", e);
        }
        if (!presentation || !contentTypes || slides != 3) {
            throw new IllegalArgumentException("Expected an editable PPTX containing exactly 3 slides");
        }
    }

    private static void requireAdmin(AuthenticatedUser user) {
        if (user == null || user.role() != Role.ADMIN) throw new IllegalArgumentException("Administrator access required");
    }
    private static void requireMcpAdmin(User user, boolean apiKey) {
        if (!apiKey && (user == null || user.getRole() != Role.ADMIN)) throw new IllegalArgumentException("Administrator access required");
    }
}
