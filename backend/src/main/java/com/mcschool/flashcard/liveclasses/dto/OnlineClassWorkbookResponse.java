package com.mcschool.flashcard.liveclasses.dto;

/** Workbook attached to the calendar lesson that backs an online class. */
public record OnlineClassWorkbookResponse(
        boolean hasWorkbook,
        String filename,
        int pageCount,
        float pageWidth,
        float pageHeight
) {}
