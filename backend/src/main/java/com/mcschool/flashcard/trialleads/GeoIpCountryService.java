package com.mcschool.flashcard.trialleads;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Resolves only a coarse ISO country code from a visitor IP.
 * The IP itself is never persisted by Mindcrafti.
 */
@Service
public class GeoIpCountryService {

    private static final Logger log = LoggerFactory.getLogger(GeoIpCountryService.class);
    private static final Pattern COUNTRY_PATTERN =
            Pattern.compile("\\\"country\\\"\\s*:\\s*\\\"([A-Za-z]{2})\\\"");

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(800))
            .build();

    public String resolveCountryCode(String ip) {
        String cleanIp = normalizeIp(ip);
        if (cleanIp == null || isLocalOrPrivate(cleanIp)) return null;

        try {
            String encoded = URLEncoder.encode(cleanIp, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("https://api.country.is/" + encoded))
                    .timeout(Duration.ofMillis(1200))
                    .header("Accept", "application/json")
                    .header("User-Agent", "Mindcrafti-School/1.0")
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) return null;

            Matcher matcher = COUNTRY_PATTERN.matcher(response.body());
            if (!matcher.find()) return null;
            return matcher.group(1).toUpperCase(Locale.ROOT);
        } catch (Exception ex) {
            log.debug("Country lookup failed", ex);
            return null;
        }
    }

    static String normalizeIp(String value) {
        if (value == null) return null;
        String ip = value.trim();
        if (ip.isBlank()) return null;
        if (ip.startsWith("[") && ip.contains("]")) {
            ip = ip.substring(1, ip.indexOf(']'));
        } else if (ip.indexOf(':') == ip.lastIndexOf(':') && ip.contains(":") && ip.contains(".")) {
            ip = ip.substring(0, ip.lastIndexOf(':'));
        }
        return ip;
    }

    static boolean isLocalOrPrivate(String ip) {
        String lower = ip.toLowerCase(Locale.ROOT);
        if ("localhost".equals(lower) || "::1".equals(lower) || lower.startsWith("fe80:") ||
                lower.startsWith("fc") || lower.startsWith("fd")) {
            return true;
        }
        if (lower.startsWith("127.") || lower.startsWith("10.") || lower.startsWith("192.168.") ||
                lower.startsWith("169.254.")) {
            return true;
        }
        if (lower.startsWith("172.")) {
            String[] parts = lower.split("\\.");
            if (parts.length >= 2) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    if (second >= 16 && second <= 31) return true;
                } catch (NumberFormatException ignored) {
                    return true;
                }
            }
        }
        return false;
    }
}
