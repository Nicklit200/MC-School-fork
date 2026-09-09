package com.mcschool.flashcard.config;

import com.mcschool.flashcard.auth.JwtAuthenticationFilter;
import com.mcschool.flashcard.common.ApiErrorResponse;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import tools.jackson.databind.ObjectMapper;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final ObjectMapper objectMapper;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter, ObjectMapper objectMapper) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
        this.objectMapper = objectMapper;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
                .csrf(csrf -> csrf.disable())
                .cors(cors -> {})
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'none'; frame-ancestors 'none'"))
                        .referrerPolicy(referrer -> referrer.policy(ReferrerPolicy.NO_REFERRER)))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/login", "/api/v1/auth/activate").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/public/trial-leads").permitAll()
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/public/trial-leads/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/push/config").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/google-calendar/oauth/callback").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/google-meet/events").permitAll()
                        .requestMatchers(
                                "/.well-known/oauth-protected-resource",
                                "/.well-known/oauth-protected-resource/**",
                                "/.well-known/oauth-authorization-server",
                                "/.well-known/oauth-authorization-server/**",
                                "/.well-known/openid-configuration",
                                "/.well-known/openid-configuration/**",
                                "/api/v1/mcp/.well-known/oauth-authorization-server",
                                "/api/v1/mcp/.well-known/openid-configuration").permitAll()
                        .requestMatchers("/api/v1/integrations/**").permitAll()
                        .requestMatchers("/api/v1/mcp/**").permitAll()
                        .requestMatchers("/actuator/health/**").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint((request, response, ex) -> writeError(response,
                                HttpServletResponse.SC_UNAUTHORIZED, "UNAUTHORIZED",
                                "Authentication required", request.getRequestURI()))
                        .accessDeniedHandler((request, response, ex) -> writeError(response,
                                HttpServletResponse.SC_FORBIDDEN, "ACCESS_DENIED",
                                "You are not allowed to perform this action", request.getRequestURI())))
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                .build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(
            @Value("${app.cors.allowed-origins}") String allowedOrigins,
            @Value("${PUBLIC_BASE_URL:${MINDCRAFTI_PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}}") String publicBaseUrl,
            @Value("${RAILWAY_PUBLIC_DOMAIN:}") String railwayPublicDomain) {
        CorsConfiguration configuration = new CorsConfiguration();
        String railwayOrigin = normalizeOrigin(railwayPublicDomain);
        List<String> origins = Stream.concat(
                        Arrays.stream(allowedOrigins.split(",")),
                        Stream.of(
                                publicBaseUrl,
                                railwayOrigin,
                                "https://mindcrafti-school-production.up.railway.app"))
                .map(String::trim)
                .map(SecurityConfig::stripTrailingSlash)
                .filter(origin -> !origin.isBlank())
                .distinct()
                .toList();
        configuration.setAllowedOrigins(origins);
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Mindcrafti-Api-Key", "MCP-Protocol-Version", "MCP-Session-Id"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        source.registerCorsConfiguration("/.well-known/**", configuration);

        return request -> {
            if ("/api/v1/mcp/oauth/authorize".equals(request.getRequestURI())
                    && "POST".equalsIgnoreCase(request.getMethod())) {
                return null;
            }
            return source.getCorsConfiguration(request);
        };
    }

    private static String normalizeOrigin(String value) {
        if (value == null || value.isBlank()) return "";
        String result = value.trim();
        if (!result.startsWith("http://") && !result.startsWith("https://")) {
            result = "https://" + result;
        }
        return stripTrailingSlash(result);
    }

    private static String stripTrailingSlash(String value) {
        if (value == null) return "";
        String result = value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    private void writeError(HttpServletResponse response, int status, String code, String message, String path) throws java.io.IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(), ApiErrorResponse.of(status, code, message, path));
    }
}
