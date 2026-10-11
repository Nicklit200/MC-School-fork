package com.mcschool.flashcard.trialleads;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

class TrialLeadMetaControllerTest {

    private TrialLeadMetaController controller(String token) {
        return new TrialLeadMetaController(mock(JdbcTemplate.class),
                mock(ObjectMapper.class),token,"");
    }

    @Test
    void normalizesPhoneOfParentNotChild() {
        assertThat(TrialLeadMetaController.normalizePhone("+49 151 12345678"))
                .isEqualTo("4915112345678");
        assertThat(TrialLeadMetaController.normalizePhone("0151 12345678"))
                .isEqualTo("4915112345678");
        assertThat(TrialLeadMetaController.normalizePhone("123")).isEmpty();
    }

    @Test
    void producesSha256WithoutTransmittingClearTextNumber() {
        String hashed=TrialLeadMetaController.sha256("4915112345678");
        assertThat(hashed).matches("[a-f0-9]{64}");
        assertThat(hashed).doesNotContain("4915112345678");
    }

    @Test
    void rejectsUnsignedPermissionBeforeAnyDatabaseAccess() {
        var input=new TrialLeadMetaController.SignedContractRequest(Instant.now(),false);
        assertThatThrownBy(()->controller("dummy").sendContract(UUID.randomUUID(),input))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(t->assertThat(((ResponseStatusException)t).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void rejectsInventedCurrentDateForOldContract() {
        var input=new TrialLeadMetaController.SignedContractRequest(
                Instant.now().minus(Duration.ofDays(10)),true);
        assertThatThrownBy(()->controller("dummy").sendContract(UUID.randomUUID(),input))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(t->assertThat(((ResponseStatusException)t).getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY));
    }

    @Test
    void refusesToSendWhenMetaTokenIsNotConfigured() {
        var input=new TrialLeadMetaController.SignedContractRequest(Instant.now(),true);
        assertThatThrownBy(()->controller("").sendContract(UUID.randomUUID(),input))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(t->assertThat(((ResponseStatusException)t).getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
    }
}
