package com.mcschool.flashcard.trialbooking;

import java.time.Instant;

public record TrialSlotResponse(Instant startsAt, Instant endsAt) {}
