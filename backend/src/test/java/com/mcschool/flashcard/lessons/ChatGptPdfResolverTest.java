package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.http.conn.DnsResolver;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.junit.jupiter.api.Test;

class ChatGptPdfResolverTest {
    private static final String HOST = "files.oaiusercontent.com";
    private static final String URL = "https://" + HOST + "/file_123?sig=VERY_SECRET_SIGNATURE";

    @Test void fileSchemaDeclaresTheFourRuntimeFieldsAndOnlyTwoRequiredFields() {
        var schema = ChatGptPdfResolver.fileSchema();
        assertEquals("object", schema.get("type"));
        assertEquals(false, schema.get("additionalProperties"));
        assertEquals(List.of("download_url", "file_id"), schema.get("required"));
        Map<?, ?> properties = (Map<?, ?>) schema.get("properties");
        assertEquals(Set.of("download_url", "file_id", "mime_type", "file_name"), properties.keySet());
        properties.values().forEach(value -> assertEquals("string", ((Map<?, ?>) value).get("type")));
    }

    @Test void referenceValidationPerformsNoDnsOrHttpAndIdentityNeverIncludesSignedUrl() {
        AtomicInteger dnsCalls = new AtomicInteger();
        AtomicInteger opens = new AtomicInteger();
        var resolver = new ChatGptPdfResolver(HOST, host -> { dnsCalls.incrementAndGet(); return publicDns().resolve(host); },
                (uri, dns) -> { opens.incrementAndGet(); throw new IOException("must not open"); });
        var reference = resolver.reference(raw(URL), "file", "Задания.pdf", "document.pdf");
        assertEquals("Задания.pdf", reference.filename());
        assertEquals("application/pdf", reference.mimeType());
        assertEquals(0, dnsCalls.get()); assertEquals(0, opens.get());
        assertEquals(Set.of("fileId", "mimeType", "filename"), reference.identity().keySet());
        assertFalse(reference.identity().toString().contains("sig="));
        assertFalse(reference.toString().contains("VERY_SECRET"));
    }

    @Test void rejectsUntrustedUrlsPathsAndAmbiguousFileShapesBeforeAnyIo() {
        AtomicInteger calls = new AtomicInteger();
        var resolver = resolver((uri, dns) -> { calls.incrementAndGet(); throw new IOException("unused"); });
        for (String url : List.of("file:///etc/passwd", "http://" + HOST + "/file", "https://127.0.0.1/file",
                "https://" + HOST + ".evil.example/file", "https://evil.example/" + HOST,
                "https://user:password@" + HOST + "/file", "https://" + HOST + ":8443/file",
                "https://" + HOST + "/file#fragment", "https://" + HOST + ".")) {
            assertThrows(IllegalArgumentException.class, () -> resolver.reference(raw(url), "file", null, "document.pdf"));
        }
        assertThrows(IllegalArgumentException.class, () -> resolver.reference("/mnt/data/book.pdf", "file", null, "book.pdf"));
        assertThrows(IllegalArgumentException.class, () -> resolver.reference(Map.of("download_url", URL), "file", null, "book.pdf"));
        assertThrows(IllegalArgumentException.class, () -> resolver.reference(Map.of("download_url", URL, "file_id", "file_1", "path", "/tmp/book.pdf"), "file", null, "book.pdf"));
        assertThrows(IllegalArgumentException.class, () -> resolver.reference(Map.of("download_url", URL, "file_id", "file_1", "mime_type", "image/png"), "file", null, "book.pdf"));
        assertEquals(0, calls.get());
    }

    @Test void configuredHostsAreExactNamesAndDoNotAllowWildcardsOrIpAddresses() {
        for (String host : List.of("*.blob.core.windows.net", "*.oaiusercontent.com", "https://" + HOST, "127.0.0.1", "localhost", "")) {
            assertThrows(IllegalArgumentException.class, () -> new ChatGptPdfResolver(host, publicDns(), (uri, dns) -> null));
        }
        var resolver = new ChatGptPdfResolver(HOST + ",cdn.example.net", publicDns(), (uri, dns) -> null);
        assertNotNull(resolver.reference(raw("https://cdn.example.net/document?signature=123"), "file", null, "book.pdf"));
        assertThrows(IllegalArgumentException.class, () -> resolver.reference(raw("https://other.cdn.example.net/file"), "file", null, "book.pdf"));
    }

    @Test void declaredMimeMustBePdfWhileBinaryHttpTransportRemainsAllowed() throws Exception {
        AtomicInteger opens = new AtomicInteger();
        var resolver = resolver((uri, dns) -> {
            opens.incrementAndGet();
            return new StubResponse(200, Map.of("Content-Type", "application/octet-stream"), new ByteArrayInputStream(pdf(false)));
        });
        for (String mimeType : List.of("application/octet-stream", "image/jpeg")) {
            var file = new LinkedHashMap<String, Object>(raw(URL));
            file.put("mime_type", mimeType);
            assertThrows(IllegalArgumentException.class, () -> resolver.reference(file, "file", null, "book.pdf"));
        }
        assertEquals(0, opens.get());
        assertNotNull(resolver.resolve(ref(resolver)));
        assertEquals(1, opens.get());
    }

    @Test void blocksNonPublicIpv4Ipv6AndMixedDnsAnswers() throws Exception {
        for (String ip : List.of("127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254",
                "100.64.0.1", "0.0.0.0", "224.0.0.1", "192.0.2.1", "198.18.0.1", "203.0.113.1",
                "::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "::ffff:127.0.0.1",
                "64:ff9b::127.0.0.1", "2001:db8::1", "2002:7f00:1::")) {
            assertFalse(ChatGptPdfResolver.publicAddress(InetAddress.getByName(ip)), ip);
        }
        assertTrue(ChatGptPdfResolver.publicAddress(InetAddress.getByName("8.8.8.8")));
        assertTrue(ChatGptPdfResolver.publicAddress(InetAddress.getByName("2606:4700:4700::1111")));
        AtomicInteger opens = new AtomicInteger();
        var resolver = new ChatGptPdfResolver(HOST,
                host -> new InetAddress[] {InetAddress.getByName("8.8.8.8"), InetAddress.getByName("10.0.0.1")},
                (uri, dns) -> { opens.incrementAndGet(); return null; });
        assertThrows(IllegalArgumentException.class, () -> resolver.resolve(ref(resolver)));
        assertEquals(0, opens.get());
    }

    @Test void validatesDnsAgainAtConnectionSoRebindingCannotReachPrivateAddress() throws Exception {
        AtomicInteger resolutions = new AtomicInteger();
        var resolver = new ChatGptPdfResolver(HOST, host -> new InetAddress[] {
                InetAddress.getByName(resolutions.incrementAndGet() == 1 ? "8.8.8.8" : "127.0.0.1")},
                (uri, checkedDns) -> {
                    checkedDns.resolve(uri.getHost()); // Same hook used by the production Apache connection manager.
                    fail("A private rebound DNS response must fail before a socket is opened"); return null;
                });
        assertThrows(IllegalArgumentException.class, () -> resolver.resolve(ref(resolver)));
        assertEquals(2, resolutions.get());
    }

    @Test void downloadsAndParsesValidPdfAndReturnsDefensiveByteCopies() throws Exception {
        byte[] bytes = pdf(false);
        var response = new StubResponse(200, Map.of("Content-Type", "application/pdf; charset=binary"), new ByteArrayInputStream(bytes));
        var resolver = resolver((uri, dns) -> response);
        PdfInput result = resolver.resolve(resolver.reference(raw(URL), "workbookFile", null, "Рабочая тетрадь.pdf"));
        assertEquals("Рабочая тетрадь.pdf", result.filename());
        assertEquals("file_123", result.fileId());
        assertArrayEquals(bytes, result.bytes());
        byte[] callerCopy = result.bytes(); callerCopy[0] = 'X';
        assertEquals('%', result.bytes()[0]);
        assertTrue(response.closed);
        PdfInput independentlyConstructed = new PdfInput("document.pdf", bytes, "file_123");
        bytes[0] = 'X';
        assertEquals('%', independentlyConstructed.bytes()[0]);
    }

    @Test void safeUnicodeFilenameCannotIntroduceDirectoriesControlsOrBrokenSurrogates() {
        var resolver = resolver((uri, dns) -> null);
        var file = new LinkedHashMap<String, Object>(raw(URL));
        file.put("file_name", "C:\\private\\Математика\u202e\u0000\r\n\"📘.pdf");
        String name = resolver.reference(file, "file", null, "book.pdf").filename();
        assertEquals("Математика📘.pdf", name);
        String longName = resolver.reference(raw(URL), "file", "📘".repeat(300), "book.pdf").filename();
        assertTrue(longName.length() <= 255);
        assertTrue(longName.endsWith(".pdf"));
        assertFalse(longName.codePoints().anyMatch(cp -> Character.getType(cp) == Character.SURROGATE));
    }

    @Test void rejectsRedirectsCompressionHtmlAndExpiredLinksWithoutLeakingUrlOrProviderBody() throws Exception {
        for (StubResponse response : List.of(
                new StubResponse(302, Map.of("Location", "http://169.254.169.254/?sig=VERY_SECRET"), InputStream.nullInputStream()),
                new StubResponse(200, Map.of("Content-Encoding", "gzip"), new ByteArrayInputStream(pdf(false))),
                new StubResponse(200, Map.of("Content-Type", "text/html"), new ByteArrayInputStream("<html>VERY_SECRET</html>".getBytes())),
                new StubResponse(403, Map.of(), new ByteArrayInputStream("VERY_SECRET_SIGNATURE".getBytes())))) {
            var resolver = resolver((uri, dns) -> response);
            var error = assertThrows(IllegalArgumentException.class, () -> resolver.resolve(ref(resolver)));
            assertFalse(error.toString().contains("VERY_SECRET"));
            assertFalse(error.toString().contains("169.254"));
            assertNull(error.getCause());
            assertTrue(response.closed);
        }
    }

    @Test void declaredOversizedLengthFailsBeforeReadingAndChunkedBodyCannotBypassLimit() {
        AtomicInteger reads = new AtomicInteger();
        var oversized = new StubResponse(200, Map.of("Content-Length", String.valueOf(ChatGptPdfResolver.MAX_PDF_BYTES + 1L)),
                new InputStream() { public int read() { reads.incrementAndGet(); return 'A'; } });
        var resolver = resolver((uri, dns) -> oversized);
        assertThrows(IllegalArgumentException.class, () -> resolver.resolve(ref(resolver)));
        assertEquals(0, reads.get()); assertTrue(oversized.closed);
        for (Map<String, String> headers : List.of(Map.<String, String>of(), Map.of("Content-Length", "1"))) {
            var chunked = new StubResponse(200, headers, new InputStream() {
                private int remaining = ChatGptPdfResolver.MAX_PDF_BYTES + 1024;
                public int read() { return remaining-- > 0 ? 'A' : -1; }
                public int read(byte[] bytes, int offset, int length) {
                    if (remaining <= 0) return -1;
                    int count = Math.min(length, remaining);
                    java.util.Arrays.fill(bytes, offset, offset + count, (byte) 'A'); remaining -= count; return count;
                }
            });
            var bounded = resolver((uri, dns) -> chunked);
            assertThrows(IllegalArgumentException.class, () -> bounded.resolve(ref(bounded)));
            assertTrue(chunked.closed);
        }
    }

    @Test void rejectsCorruptEmptyAndEncryptedPdfDespitePdfHeaders() throws Exception {
        for (byte[] bytes : List.of(new byte[0], "%PDF-invalid".getBytes(), pdf(true))) {
            var response = new StubResponse(200, Map.of("Content-Type", "application/pdf"), new ByteArrayInputStream(bytes));
            var resolver = resolver((uri, dns) -> response);
            assertThrows(IllegalArgumentException.class, () -> resolver.resolve(ref(resolver)));
            assertTrue(response.closed);
        }
    }

    @Test void timeoutAndUnexpectedTransportErrorsHaveSanitizedMessagesAndNoCause() {
        for (ChatGptPdfResolver.DownloadTransport transport : List.<ChatGptPdfResolver.DownloadTransport>of(
                (uri, dns) -> { throw new SocketTimeoutException("VERY_SECRET_SIGNATURE " + URL); },
                (uri, dns) -> { throw new IllegalStateException("VERY_SECRET_SIGNATURE " + URL); })) {
            var resolver = resolver(transport);
            var error = assertThrows(IllegalArgumentException.class, () -> resolver.resolve(ref(resolver)));
            assertFalse(error.toString().contains("VERY_SECRET")); assertNull(error.getCause());
        }
    }

    @Test void directlyConstructedReferenceCannotBypassHostValidation() {
        AtomicInteger opens = new AtomicInteger();
        var resolver = resolver((uri, dns) -> { opens.incrementAndGet(); return null; });
        assertThrows(IllegalArgumentException.class,
                () -> resolver.resolve(new ChatGptFileReference("https://internal.example/private", "file_1", "application/pdf", "book.pdf")));
        assertEquals(0, opens.get());
    }

    private static ChatGptPdfResolver resolver(ChatGptPdfResolver.DownloadTransport transport) {
        return new ChatGptPdfResolver(HOST, publicDns(), transport);
    }
    private static DnsResolver publicDns() {
        return host -> new InetAddress[] { InetAddress.getByAddress(new byte[] {8, 8, 8, 8}) };
    }
    private static ChatGptFileReference ref(ChatGptPdfResolver resolver) {
        return resolver.reference(raw(URL), "file", null, "book.pdf");
    }
    private static Map<String, Object> raw(String url) { return Map.of("download_url", url, "file_id", "file_123"); }
    private static byte[] pdf(boolean encrypted) throws IOException {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            document.addPage(new PDPage());
            if (encrypted) document.protect(new StandardProtectionPolicy("owner-password", "user-password", new AccessPermission()));
            document.save(bytes); return bytes.toByteArray();
        }
    }
    private static final class StubResponse implements ChatGptPdfResolver.DownloadResponse {
        private final int status;
        private final Map<String, String> headers;
        private final InputStream input;
        private boolean closed;
        private StubResponse(int status, Map<String, String> headers, InputStream input) {
            this.status = status; this.headers = headers; this.input = input;
        }
        public int statusCode() { return status; }
        public String header(String name) {
            return headers.entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase(name)).map(Map.Entry::getValue).findFirst().orElse(null);
        }
        public InputStream body() { return input; }
        public void close() throws IOException { closed = true; input.close(); }
    }
}
