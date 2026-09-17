package com.mcschool.flashcard.lessons.dto;

public record GoogleCalendarConnectionResponse(boolean connected, String authorizationUrl) {
}
