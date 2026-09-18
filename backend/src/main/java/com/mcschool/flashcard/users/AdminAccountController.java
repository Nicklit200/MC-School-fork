package com.mcschool.flashcard.users;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/admin/accounts")
@PreAuthorize("hasRole('ADMIN')")
public class AdminAccountController {

    private final UserRepository userRepository;

    public AdminAccountController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping
    public List<UserResponse> listAccounts(@RequestParam Role role) {
        if (role != Role.STUDENT && role != Role.PARENT) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only STUDENT and PARENT accounts are available here");
        }
        return userRepository.findAllByRoleOrderByFullNameAsc(role).stream()
                .filter(user -> !user.isArchived())
                .map(UserResponse::from)
                .toList();
    }
}
