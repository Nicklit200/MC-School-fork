package com.mcschool.flashcard.users;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.dto.ChangePasswordRequest;
import com.mcschool.flashcard.users.dto.UpdateSettingsRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Self-service account settings, available to any authenticated user. */
@RestController
@RequestMapping("/api/v1/users/me")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PutMapping("/settings")
    public UserResponse updateSettings(@AuthenticationPrincipal AuthenticatedUser caller,
                                       @Valid @RequestBody UpdateSettingsRequest request) {
        return userService.updateSettings(caller, request);
    }

    @PutMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@AuthenticationPrincipal AuthenticatedUser caller,
                               @Valid @RequestBody ChangePasswordRequest request) {
        userService.changePassword(caller, request);
    }
}
