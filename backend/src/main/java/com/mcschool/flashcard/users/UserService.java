package com.mcschool.flashcard.users;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.dto.ChangePasswordRequest;
import com.mcschool.flashcard.users.dto.UpdateSettingsRequest;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Operations a user performs on their own account, available to every role. */
@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public UserResponse updateSettings(AuthenticatedUser caller, UpdateSettingsRequest request) {
        User user = requireUser(caller.id());
        user.changeLanguage(request.preferredLanguage());
        return UserResponse.from(user);
    }

    /** Changes the logged-in user's password without requiring the old password. */
    @Transactional
    public void changePassword(AuthenticatedUser caller, ChangePasswordRequest request) {
        User user = requireUser(caller.id());
        user.changePasswordHash(passwordEncoder.encode(request.password()));
    }

    private User requireUser(UUID userId) {
        return userRepository.findById(userId)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Account no longer exists"));
    }
}
