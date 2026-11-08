package com.mcschool.flashcard.liveclasses;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Fixed public failures. Provider bodies, task text and renderer logs never become API messages. */
public final class KolinRequestException extends ResponseStatusException {
    private final String errorCode;
    private KolinRequestException(HttpStatus status,String code,String message) {
        super(status,message); errorCode=code;
    }
    public String getErrorCode() { return errorCode; }
    public static KolinRequestException busy() {
        return new KolinRequestException(HttpStatus.TOO_MANY_REQUESTS,"KOLIN_BUSY",
                "Kolyn ещё готовит ответ. Повторите через несколько секунд.");
    }
    public static KolinRequestException invalid() {
        return new KolinRequestException(HttpStatus.BAD_GATEWAY,"KOLIN_TASK_INVALID",
                "Не удалось проверить задания. Повторите запрос.");
    }
    public static KolinRequestException failed() {
        return new KolinRequestException(HttpStatus.BAD_GATEWAY,"KOLIN_GENERATION_FAILED",
                "Kolyn не смог завершить ответ. Попробуйте отправить запрос ещё раз.");
    }
}
