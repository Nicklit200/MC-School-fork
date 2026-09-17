package com.mcschool.flashcard.groups.dto;

import com.mcschool.flashcard.cards.dto.ParsedCard;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.List;

public record ImportGroupCardsRequest(
        @NotNull LocalDate startDate,
        @NotEmpty List<@Valid ParsedCard> cards
) {
}
