package com.mcschool.flashcard.liveclasses.dto;

import java.util.List;
import java.util.UUID;

/**
 * Board/navigation context for one online class.
 *
 * Students receive only their own private-board entry. The teacher receives all
 * students so the host can switch between private workspaces or open the grid.
 */
public record OnlineClassBoardContextResponse(
        UUID teacherId,
        List<OnlineClassBoardStudentResponse> students,
        OnlineClassWorkbookResponse workbook
) {}
