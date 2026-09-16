package com.mcschool.flashcard.study;

import static org.assertj.core.api.Assertions.assertThat;

import com.mcschool.flashcard.study.dto.AnswerRequest;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AnswerRequestValidationTest {

    private final Validator validator;

    AnswerRequestValidationTest() {
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        this.validator = factory.getValidator();
    }

    @Test
    void selectedAnswerCannotExceedDatabaseColumnLength() {
        AnswerRequest request = new AnswerRequest(UUID.randomUUID(), "x".repeat(501), false);

        assertThat(validator.validate(request))
                .anyMatch(violation -> violation.getPropertyPath().toString().equals("selectedAnswer"));
    }
}
