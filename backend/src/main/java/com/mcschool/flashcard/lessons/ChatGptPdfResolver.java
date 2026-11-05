package com.mcschool.flashcard.lessons;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.apache.http.Header;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.conn.DnsResolver;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Resolves declared ChatGPT file parameters into bounded, validated PDF bytes.
 * The caller must authorize its actor and target before resolving a file.
 * This downloader never receives school, Google or OpenAI API credentials.
 */
@Service
public class ChatGptPdfResolver {
    public static final int MAX_PDF_BYTES = 15 * 1024 * 1024;
    private static final int MAX_URL_LENGTH = 8192;
    private static final Set<String> FILE_KEYS = Set.of("download_url", "file_id", "mime_type", "file_name");
    private static final ScheduledExecutorService TIMEOUTS = Executors.newSingleThreadScheduledExecutor(work -> {
        Thread thread = new Thread(work, "chatgpt-file-timeout");
        thread.setDaemon(true);
        return thread;
    });
    private final Set<String> allowedHosts;
    private final DnsResolver dns;
    private final DownloadTransport transport;

    @Autowired
    public ChatGptPdfResolver(
            @Value("${MINDCRAFTI_CHATGPT_FILE_HOSTS:files.oaiusercontent.com}") String exactHosts) {
        this(exactHosts, InetAddress::getAllByName, new ApacheDownloadTransport());
    }

    ChatGptPdfResolver(String exactHosts, DnsResolver dns, DownloadTransport transport) {
        if (exactHosts == null) throw invalid("Trusted ChatGPT file hosts must be configured");
        this.allowedHosts = Arrays.stream(exactHosts.split(","))
                .map(String::strip).map(value -> value.toLowerCase(Locale.ROOT))
                .filter(value -> !value.isEmpty()).collect(Collectors.toUnmodifiableSet());
        if (allowedHosts.isEmpty() || allowedHosts.stream().anyMatch(host -> !validConfiguredHost(host))) {
            throw invalid("Trusted ChatGPT file hosts must be exact DNS names without wildcards or URLs");
        }
        this.dns = host -> {
            if (!allowedHosts.contains(host.toLowerCase(Locale.ROOT))) throw new UnknownHostException("Untrusted file host");
            InetAddress[] addresses = dns.resolve(host);
            if (addresses == null || addresses.length == 0 || Arrays.stream(addresses).anyMatch(address -> !publicAddress(address))) {
                throw new UnknownHostException("File host must resolve only to public addresses");
            }
            return addresses.clone();
        };
        this.transport = transport;
    }

    /** Validate the tool argument and URL without DNS lookup, HTTP or other I/O. */
    public ChatGptFileReference reference(Object rawFile, String field, String explicitFilename, String fallbackFilename) {
        String label = field != null && field.matches("[A-Za-z0-9_.\\[\\]-]{1,80}") ? field : "file";
        if (!(rawFile instanceof Map<?, ?> raw) || raw.keySet().stream().anyMatch(key -> !(key instanceof String) || !FILE_KEYS.contains(key))) {
            throw invalid(label + " must be a declared ChatGPT file object");
        }
        String downloadUrl = requiredString(raw.get("download_url"), label + ".download_url", MAX_URL_LENGTH);
        String fileId = requiredString(raw.get("file_id"), label + ".file_id", 512);
        String mimeType = optionalString(raw.get("mime_type"), label + ".mime_type", 150);
        String suppliedName = optionalString(raw.get("file_name"), label + ".file_name", 1024);
        checkedUri(downloadUrl);
        String normalizedMime = mimeType == null ? "application/pdf" : mediaType(mimeType);
        // The declared attachment must be a PDF; octet-stream is accepted only
        // as the trusted server's binary transport content type after this check.
        if (!"application/pdf".equals(normalizedMime)) throw invalid(label + " must declare application/pdf");
        if (explicitFilename != null && explicitFilename.length() > 1024) throw invalid(label + " filename is too long");
        String filename = filename(explicitFilename == null || explicitFilename.isBlank() ? suppliedName : explicitFilename,
                fallbackFilename);
        return new ChatGptFileReference(downloadUrl, fileId, normalizedMime, filename);
    }

    public PdfInput resolve(ChatGptFileReference file) {
        if (file == null) throw invalid("A ChatGPT PDF file is required");
        // Revalidate even a reference constructed directly by another caller.
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("download_url", file.downloadUrl()); raw.put("file_id", file.fileId());
        if (file.mimeType() != null) raw.put("mime_type", file.mimeType());
        if (file.filename() != null) raw.put("file_name", file.filename());
        ChatGptFileReference validated = reference(raw, "file", null, "document.pdf");
        URI uri = checkedUri(validated.downloadUrl());
        try {
            if (Thread.currentThread().isInterrupted()) throw new IOException("Interrupted");
            // The transport receives this same validating DNS resolver for actual connection
            // resolution, so a second DNS answer cannot rebind the connection to a private IP.
            dns.resolve(uri.getHost());
            try (DownloadResponse response = transport.open(uri, dns)) {
                int status = response.statusCode();
                if (status == 401 || status == 403 || status == 404 || status == 410) {
                    throw invalid("ChatGPT file is expired or unavailable. Attach the PDF again");
                }
                if (status >= 300 && status < 400) throw invalid("ChatGPT file redirects are not allowed");
                if (status != 200) throw invalid("ChatGPT file download did not succeed");
                String encoding = response.header("Content-Encoding");
                if (encoding != null && !encoding.isBlank() && !"identity".equalsIgnoreCase(encoding.strip())) {
                    throw invalid("Compressed ChatGPT file responses are not accepted");
                }
                String type = response.header("Content-Type");
                if (type != null && !type.isBlank() && !pdfMediaType(mediaType(type))) {
                    throw invalid("ChatGPT file response must contain a PDF");
                }
                String length = response.header("Content-Length");
                if (length != null && !length.isBlank()) {
                    long declared;
                    try { declared = Long.parseLong(length.strip()); }
                    catch (NumberFormatException error) { throw invalid("Invalid ChatGPT file response length"); }
                    if (declared < 0 || declared > MAX_PDF_BYTES) throw invalid("PDF must not exceed the 15 MB direct-upload limit");
                }
                byte[] bytes = readBounded(response.body());
                try { LessonPdfUpload.validate(bytes); }
                catch (ResponseStatusException error) { throw invalid("ChatGPT file must be a readable, unencrypted PDF with at least one page"); }
                return new PdfInput(validated.filename(), bytes, validated.fileId());
            }
        } catch (FileResolutionException error) {
            throw error;
        } catch (IOException | RuntimeException error) {
            // Never include provider exception text, signed URLs or response bodies.
            throw invalid("Could not download the ChatGPT PDF. Attach it again or retry later");
        }
    }

    public static Map<String, Object> fileSchema() {
        return Map.of("type", "object", "properties", Map.of(
                "download_url", Map.of("type", "string", "maxLength", MAX_URL_LENGTH),
                "file_id", Map.of("type", "string", "minLength", 1, "maxLength", 512),
                "mime_type", Map.of("type", "string", "maxLength", 150),
                "file_name", Map.of("type", "string", "maxLength", 1024)),
                "required", List.of("download_url", "file_id"), "additionalProperties", false);
    }

    private URI checkedUri(String value) {
        URI uri;
        try { uri = URI.create(value); }
        catch (IllegalArgumentException error) { throw invalid("Invalid ChatGPT file download URL"); }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getFragment() != null
                || (uri.getPort() != -1 && uri.getPort() != 443)
                || !allowedHosts.contains(uri.getHost().toLowerCase(Locale.ROOT))) {
            throw invalid("ChatGPT file URL must use HTTPS on a trusted runtime host");
        }
        return uri;
    }

    private static byte[] readBounded(InputStream input) throws IOException {
        if (input == null) throw invalid("ChatGPT file is empty");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int total = 0;
        for (int count; (count = input.read(buffer, 0, Math.min(buffer.length, MAX_PDF_BYTES + 1 - total))) != -1;) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("Interrupted");
            total += count;
            if (total > MAX_PDF_BYTES) throw invalid("PDF must not exceed the 15 MB direct-upload limit");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    static boolean publicAddress(InetAddress address) {
        if (address == null || address.isAnyLocalAddress() || address.isLoopbackAddress()
                || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int a = bytes[0] & 255, b = bytes[1] & 255, c = bytes[2] & 255;
            return a != 0 && a != 10 && a != 127 && a < 224
                    && !(a == 100 && b >= 64 && b <= 127)
                    && !(a == 169 && b == 254) && !(a == 172 && b >= 16 && b <= 31)
                    && !(a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2))))
                    && !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                    && !(a == 203 && b == 0 && c == 113);
        }
        if (bytes.length != 16 || (bytes[0] & 0xe0) != 0x20) return false; // Global unicast 2000::/3 only.
        int b0 = bytes[0] & 255, b1 = bytes[1] & 255, b2 = bytes[2] & 255, b3 = bytes[3] & 255;
        return !(b0 == 0x20 && b1 == 0x02) // 6to4 can encapsulate private IPv4.
                && !(b0 == 0x20 && b1 == 0x01 && ((b2 == 0 && b3 == 0) || (b2 == 0x0d && b3 == 0xb8)));
    }

    private static boolean validConfiguredHost(String host) {
        return host.length() <= 253 && host.contains(".") && !host.matches("[0-9.]+")
                && Arrays.stream(host.split("\\.", -1)).allMatch(label -> label.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"));
    }

    private static String requiredString(Object raw, String field, int limit) {
        if (!(raw instanceof String value) || value.isBlank() || value.length() > limit
                || value.codePoints().anyMatch(Character::isISOControl)) throw invalid(field + " must be a bounded nonempty string");
        return value.strip();
    }

    private static String optionalString(Object raw, String field, int limit) {
        if (raw == null) return null;
        if (!(raw instanceof String value) || value.length() > limit) throw invalid(field + " must be a bounded string");
        return value.isBlank() ? null : value.strip();
    }

    private static String filename(String requested, String fallback) {
        String safeFallback = fallback == null || fallback.isBlank() ? "document.pdf" : fallback;
        String value = requested == null || requested.isBlank() ? safeFallback : requested;
        value = Normalizer.normalize(value, Normalizer.Form.NFC);
        value = LessonPdfUpload.filename(value, "document.pdf");
        StringBuilder safe = new StringBuilder();
        value.codePoints().filter(cp -> !Character.isISOControl(cp) && Character.getType(cp) != Character.FORMAT
                && Character.getType(cp) != Character.SURROGATE && "<>:|?*\"".indexOf(cp) < 0).forEach(safe::appendCodePoint);
        value = safe.toString().strip().replaceAll("[. ]+$", "");
        if (value.isBlank() || ".pdf".equalsIgnoreCase(value)) value = "document.pdf";
        String stem = value.toLowerCase(Locale.ROOT).endsWith(".pdf") ? value.substring(0, value.length() - 4) : value;
        int limit = Math.min(stem.length(), 251);
        if (limit > 0 && Character.isHighSurrogate(stem.charAt(limit - 1))) limit--;
        stem = stem.substring(0, limit);
        return stem.isBlank() ? "document.pdf" : stem + ".pdf";
    }

    private static String mediaType(String value) { return value.split(";", 2)[0].strip().toLowerCase(Locale.ROOT); }
    private static boolean pdfMediaType(String value) { return "application/pdf".equals(value) || "application/octet-stream".equals(value); }
    private static FileResolutionException invalid(String message) { return new FileResolutionException(message); }
    private static final class FileResolutionException extends IllegalArgumentException {
        private FileResolutionException(String message) { super(message); }
    }

    @FunctionalInterface interface DownloadTransport { DownloadResponse open(URI uri, DnsResolver checkedDns) throws IOException; }
    interface DownloadResponse extends AutoCloseable {
        int statusCode();
        String header(String name);
        InputStream body() throws IOException;
        @Override void close() throws IOException;
    }

    /** The actual socket DNS lookup uses the validated resolver while TLS verifies the original hostname. */
    private static final class ApacheDownloadTransport implements DownloadTransport {
        public DownloadResponse open(URI uri, DnsResolver checkedDns) throws IOException {
            CloseableHttpClient client = HttpClients.custom().setDnsResolver(checkedDns)
                    .disableRedirectHandling().disableContentCompression().disableAutomaticRetries()
                    .setDefaultRequestConfig(RequestConfig.custom().setConnectTimeout(5000)
                            .setConnectionRequestTimeout(5000).setSocketTimeout(10000).build()).build();
            HttpGet request = new HttpGet(uri);
            request.setHeader("Accept", "application/pdf, application/octet-stream");
            request.setHeader("Accept-Encoding", "identity");
            ScheduledFuture<?> timeout = TIMEOUTS.schedule(request::abort, 30, TimeUnit.SECONDS);
            try {
                CloseableHttpResponse response = client.execute(request);
                return new DownloadResponse() {
                    public int statusCode() { return response.getStatusLine().getStatusCode(); }
                    public String header(String name) {
                        Header header = response.getFirstHeader(name);
                        return header == null ? null : header.getValue();
                    }
                    public InputStream body() throws IOException {
                        return response.getEntity() == null ? InputStream.nullInputStream() : response.getEntity().getContent();
                    }
                    public void close() throws IOException {
                        timeout.cancel(false);
                        try { response.close(); } finally { client.close(); }
                    }
                };
            } catch (IOException | RuntimeException error) {
                timeout.cancel(false);
                client.close();
                throw error;
            }
        }
    }
}
