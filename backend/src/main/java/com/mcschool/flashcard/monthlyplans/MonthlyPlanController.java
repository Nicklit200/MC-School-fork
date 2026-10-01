package com.mcschool.flashcard.monthlyplans;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.monthlyplans.dto.MonthlyPlanResponse;
import com.mcschool.flashcard.monthlyplans.dto.UpdateMonthlyPlanRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/monthly-plans")
@PreAuthorize("hasRole('TEACHER')")
public class MonthlyPlanController {
    private final MonthlyPlanService service;

    public MonthlyPlanController(MonthlyPlanService service) {
        this.service = service;
    }

    @GetMapping("/{targetType}/{targetId}")
    public MonthlyPlanResponse get(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable String targetType,
            @PathVariable UUID targetId,
            @RequestParam String month) {
        return service.get(caller, targetType, targetId, month);
    }

    @PutMapping("/{targetType}/{targetId}")
    public MonthlyPlanResponse save(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable String targetType,
            @PathVariable UUID targetId,
            @RequestParam String month,
            @Valid @RequestBody UpdateMonthlyPlanRequest request) {
        return service.save(caller, targetType, targetId, month, request.planJson());
    }
}
