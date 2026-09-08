package com.mcschool.flashcard.trialbooking;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/public/trials")
public class PublicTrialBookingController {

    private final PublicTrialBookingService service;

    public PublicTrialBookingController(PublicTrialBookingService service) {
        this.service = service;
    }

    @GetMapping("/teachers")
    public List<PublicTrialTeacherResponse> teachers() {
        return service.listTeachers();
    }

    @GetMapping("/teachers/{teacherId}/slots")
    public List<TrialSlotResponse> slots(@PathVariable UUID teacherId) {
        return service.listSlots(teacherId);
    }

    @PostMapping("/book")
    @ResponseStatus(HttpStatus.CREATED)
    public TrialBookingResponse book(@Valid @RequestBody TrialBookingRequest request) {
        return service.book(request);
    }
}
