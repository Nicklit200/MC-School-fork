package com.mcschool.flashcard.liveclasses;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** School accounting, never available to a teacher or a pupil session. */
@RestController
@RequestMapping("/api/v1/admin/kolyn-usage")
@PreAuthorize("hasRole('ADMIN')")
public class KolinUsageAdminController {
    private final KolinPageAnalysisStore store;
    public KolinUsageAdminController(KolinPageAnalysisStore store) { this.store=store; }

    @GetMapping
    public ResponseEntity<List<KolinPageAnalysisStore.UsageLesson>> lessons(@RequestParam(defaultValue="30") int days) {
        if(days<1 || days>365) throw new IllegalArgumentException("days must be from 1 to 365");
        ZoneId zone=ZoneId.of("Europe/Berlin");
        var from=LocalDate.now(zone).minusDays(days-1L).atStartOfDay(zone).toInstant();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(store.usageLessons(from));
    }

    @GetMapping("/{classId}")
    public ResponseEntity<Map<String,Object>> detail(@PathVariable UUID classId,@RequestParam UUID teacherId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(
            Map.of("totals",store.usageTotals(classId,teacherId),"pages",store.pageUsage(classId,teacherId)));
    }
}
