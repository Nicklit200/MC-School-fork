package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Structural guard on authorization.
 *
 * <p>Online classes carry two independent gates: a role gate on the endpoint and
 * an <em>object-level</em> gate that proves the caller belongs to that specific
 * class. A one-off audit cannot stop the next endpoint from omitting one, so the
 * invariant is asserted here instead.
 *
 * <p>This reads the source rather than reflecting, because what matters is that
 * the check is written at all — a runtime test would only cover the paths it
 * happens to exercise.
 */
class LiveClassAuthorizationArchitectureTest {

    private static final Path PACKAGE =
            Path.of("src/main/java/com/mcschool/flashcard/liveclasses");

    /**
     * Endpoints exempt from the user role gate, each with its own stronger
     * verification. Additions here should be deliberate and rare.
     */
    private static final List<String> NON_USER_CONTROLLERS = List.of(
            // Verifies an HMAC signature over the raw body instead.
            "LiveKitWebhookController.java",
            // Requires the internal worker secret, constant-time compared.
            "TranscriptIngestionController.java");

    private static List<Path> sources(String suffix) throws IOException {
        try (var stream = Files.list(PACKAGE)) {
            return stream.filter(path -> path.getFileName().toString().endsWith(suffix))
                    .sorted()
                    .toList();
        }
    }

    @Test
    @DisplayName("every user-facing endpoint has a role gate")
    void everyEndpointHasARoleGate() throws IOException {
        List<String> ungated = new ArrayList<>();

        for (Path source : sources("Controller.java")) {
            String name = source.getFileName().toString();
            if (NON_USER_CONTROLLERS.contains(name)) {
                continue;
            }
            List<String> lines = Files.readAllLines(source);
            boolean classGate = lines.stream()
                    .anyMatch(line -> line.contains("@PreAuthorize"));

            for (int i = 0; i < lines.size(); i++) {
                if (!lines.get(i).matches(".*@(Get|Post|Put|Delete)Mapping.*")) {
                    continue;
                }
                boolean methodGate = false;
                for (int j = i + 1; j < Math.min(i + 6, lines.size()); j++) {
                    if (lines.get(j).contains("@PreAuthorize")) {
                        methodGate = true;
                        break;
                    }
                    if (lines.get(j).contains("public ")) {
                        break;
                    }
                }
                if (!classGate && !methodGate) {
                    ungated.add(name + ":" + (i + 1));
                }
            }
        }

        assertThat(ungated)
                .withFailMessage("Endpoints without any role gate: %s", ungated)
                .isEmpty();
    }

    @Test
    @DisplayName("every service method taking a caller performs an object-level check")
    void everyCallerFacingServiceMethodChecksOwnership() throws IOException {
        List<String> unchecked = new ArrayList<>();

        for (Path source : sources("Service.java")) {
            // The access service IS the checker; it cannot delegate to itself.
            if (source.getFileName().toString().equals("OnlineClassAccessService.java")) {
                continue;
            }
            String body = Files.readString(source);
            if (!body.contains("OnlineClassAccessService")) {
                // Not a caller-facing service (e.g. retention runs on a schedule).
                continue;
            }
            for (MethodBody method : publicMethodsTakingCaller(body)) {
                if (reachesAccessService(method.body(), body)) {
                    continue;
                }
                // Scoping a query by the caller's own id is an equally valid
                // object-level control for list endpoints.
                if (method.body().contains("caller.id()")) {
                    continue;
                }
                unchecked.add(source.getFileName() + "#" + method.name());
            }
        }

        assertThat(unchecked)
                .withFailMessage(
                        "Service methods that accept a caller but never check ownership: %s",
                        unchecked)
                .isEmpty();
    }

    /**
     * True when the body checks directly, or delegates to a private helper in
     * the same class that does.
     */
    private boolean reachesAccessService(String methodBody, String classBody) {
        if (methodBody.contains("accessService.")) {
            return true;
        }
        Matcher calls = Pattern.compile("\\b(\\w+)\\(caller\\b").matcher(methodBody);
        while (calls.find()) {
            String helper = calls.group(1);
            // A delegate may be private or a public sibling (exportText ->
            // segments), so match either.
            Matcher helperBody = Pattern.compile(
                    "(?:private|public)[\\w<>,\\[\\]\\. ]+\\s" + Pattern.quote(helper)
                            + "\\([^)]*\\)\\s*\\{")
                    .matcher(classBody);
            if (helperBody.find()) {
                String extracted = extractBody(classBody, helperBody.end());
                if (extracted.contains("accessService.")) {
                    return true;
                }
            }
        }
        return false;
    }

    private record MethodBody(String name, String body) {
    }

    private List<MethodBody> publicMethodsTakingCaller(String source) {
        List<MethodBody> methods = new ArrayList<>();
        Matcher matcher = Pattern.compile(
                "public\\s+[\\w<>,\\[\\]\\. ]+\\s+(\\w+)\\(([^)]*AuthenticatedUser[^)]*)\\)\\s*\\{")
                .matcher(source);
        while (matcher.find()) {
            methods.add(new MethodBody(matcher.group(1), extractBody(source, matcher.end())));
        }
        return methods;
    }

    /** Returns the balanced body starting just after an opening brace. */
    private String extractBody(String source, int afterOpeningBrace) {
        int depth = 1;
        int index = afterOpeningBrace;
        while (index < source.length() && depth > 0) {
            char character = source.charAt(index);
            if (character == '{') {
                depth++;
            } else if (character == '}') {
                depth--;
            }
            index++;
        }
        return source.substring(afterOpeningBrace, Math.min(index, source.length()));
    }

    @Test
    @DisplayName("the exempt controllers still verify their own callers")
    void exemptControllersVerifyTheirCallersAnotherWay() throws IOException {
        String webhook = Files.readString(PACKAGE.resolve("LiveKitWebhookController.java"));
        String ingestion = Files.readString(PACKAGE.resolve("TranscriptIngestionController.java"));

        // These are JWT-exempt by necessity; they must never be unverified.
        assertThat(webhook).contains("webhookService.verify");
        assertThat(ingestion).contains("workerAuth.matches");
    }
}
