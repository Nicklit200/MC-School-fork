package com.mcschool.flashcard.auth;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class TrialGuestJwtFilterScopeTest {
    @Test
    void guestOnlyReadsItsOwnClassAndOwnBasicIdentity() {
        UUID own = UUID.randomUUID(), other = UUID.randomUUID();
        assertTrue(allowed("GET", "/api/v1/online-classes/" + own, own));
        assertTrue(allowed("POST", "/api/v1/online-classes/" + own + "/connection", own));
        assertTrue(allowed("POST", "/api/v1/online-classes/" + own + "/join-requests", own));
        assertTrue(allowed("GET", "/api/v1/online-classes/" + own + "/document", own));
        assertTrue(allowed("GET", "/api/v1/auth/me", own));
        assertFalse(allowed("GET", "/api/v1/online-classes/" + other, own));
        assertFalse(allowed("POST", "/api/v1/online-classes/" + other + "/connection", own));
        assertFalse(allowed("GET", "/api/v1/student/lessons", own));
        assertFalse(allowed("POST", "/api/v1/lessons", own));
        assertFalse(allowed("GET", "/api/v1/lesson-preparations/foo", own));
        assertFalse(allowed("GET", "/api/v1/online-classes/" + own + "-suffix", own));
        assertFalse(allowed("POST", "/api/v1/auth/me", own));
        assertFalse(allowed("GET", "/api/v1/online-classes/" + own, null));
    }

    private boolean allowed(String method, String url, UUID scope) {
        return JwtAuthenticationFilter.isAllowedGuestRequest(new MockHttpServletRequest(method, url), scope);
    }
}
