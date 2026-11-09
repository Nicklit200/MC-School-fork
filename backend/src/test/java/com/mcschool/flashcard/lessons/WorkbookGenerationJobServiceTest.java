package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;
import tools.jackson.databind.ObjectMapper;

class WorkbookGenerationJobServiceTest {
    private final AuthenticatedUser actor = new AuthenticatedUser(UUID.randomUUID(),"admin@test.local",Role.ADMIN);
    private final AuthenticatedUser teacher = new AuthenticatedUser(UUID.randomUUID(),"teacher@test.local",Role.TEACHER);

    private PlatformTransactionManager transactions() {
        PlatformTransactionManager tx=mock(PlatformTransactionManager.class);
        when(tx.getTransaction(any(TransactionDefinition.class))).thenAnswer(call->new SimpleTransactionStatus());
        return tx;
    }

    @Test
    void claimsAndRunsThreeJobsInParallelWithoutLosingTheirLeases() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        McpAccessService access=mock(McpAccessService.class);
        PlatformTransactionManager tx=transactions();
        when(access.requireCurrentActor(any(AuthenticatedUser.class))).thenAnswer(call->call.getArgument(0));
        when(access.requireTeacher(any(AuthenticatedUser.class),eq(teacher.id()))).thenReturn(teacher);

        var jobs=List.of(
                new WorkbookGenerationJobService.Job(UUID.randomUUID(),actor.id(),actor.role(),teacher.id(),"lesson-1","h1","{}","QUEUED",null,null,Instant.now()),
                new WorkbookGenerationJobService.Job(UUID.randomUUID(),actor.id(),actor.role(),teacher.id(),"lesson-2","h2","{}","QUEUED",null,null,Instant.now()),
                new WorkbookGenerationJobService.Job(UUID.randomUUID(),actor.id(),actor.role(),teacher.id(),"lesson-3","h3","{}","QUEUED",null,null,Instant.now()));
        AtomicInteger claim=new AtomicInteger();
        when(jdbc.query(contains("WHERE state='QUEUED'"),any(RowMapper.class))).thenAnswer(call->{
            int index=claim.getAndIncrement();
            return index<jobs.size()?List.of(jobs.get(index)):List.of();
        });
        when(jdbc.update(contains("SET state='SUCCEEDED'"),any(),any(),any())).thenReturn(1);

        CountDownLatch started=new CountDownLatch(3);
        CountDownLatch release=new CountDownLatch(1);
        WorkbookGenerationJobService service=new WorkbookGenerationJobService(jdbc,access,new ObjectMapper(),tx,3,24,60);
        service.setGenerator((owner,args)->{
            started.countDown();
            if(!release.await(5,TimeUnit.SECONDS))throw new IllegalStateException("test release timeout");
            return Map.of("draftId",UUID.randomUUID().toString());
        });
        try {
            service.tick();
            assertThat(started.await(3,TimeUnit.SECONDS))
                    .as("all three worker slots should start before any renderer is released")
                    .isTrue();
            release.countDown();
            verify(jdbc,timeout(3000).times(3)).update(contains("SET state='SUCCEEDED'"),any(),any(),any());
            assertThat(claim.get()).isEqualTo(3);
        } finally {
            release.countDown();
            service.close();
        }
    }

    @Test
    void reportsQueueCapacityWithoutExposingJobOrStudentIdentifiers() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        McpAccessService access=mock(McpAccessService.class);
        when(access.requireCurrentActor(actor)).thenReturn(actor);
        when(jdbc.queryForObject(contains("actor_id"),eq(Integer.class),eq(actor.id()))).thenReturn(7);
        when(jdbc.queryForObject(contains("state='QUEUED'"),eq(Integer.class))).thenReturn(5);
        when(jdbc.queryForObject(contains("state='RUNNING'"),eq(Integer.class))).thenReturn(3);
        when(jdbc.queryForObject(contains("MIN(created_at)"),eq(Long.class))).thenReturn(42L);
        WorkbookGenerationJobService service=new WorkbookGenerationJobService(jdbc,access,new ObjectMapper(),transactions(),3,24,60);
        try {
            Map<String,Object> status=service.capacity(actor);
            assertThat(status).containsEntry("activeForAccount",7)
                    .containsEntry("maxPendingPerAccount",24)
                    .containsEntry("queuedSchoolWide",5)
                    .containsEntry("runningSchoolWide",3)
                    .containsEntry("maxGlobalActive",60)
                    .containsEntry("workersPerBackend",3)
                    .containsEntry("oldestQueuedSeconds",42L);
            assertThat(status).doesNotContainKeys("jobIds","studentIds","teacherIds");
        } finally {
            service.close();
        }
    }

    @Test
    void enforcesPerAccountLimitBeforeAcceptingMoreJobs() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        McpAccessService access=mock(McpAccessService.class);
        AuthenticatedUser owner=new AuthenticatedUser(UUID.randomUUID(),"teacher@test.local",Role.TEACHER);
        when(access.requireCurrentActor(owner)).thenReturn(owner);
        when(access.requireTeacher(owner,owner.id())).thenReturn(owner);
        when(jdbc.query(any(String.class),any(RowMapper.class),any(),any(),any())).thenReturn(List.of());
        when(jdbc.queryForObject(contains("actor_id"),eq(Integer.class),eq(owner.id()))).thenReturn(24);
        WorkbookGenerationJobService service=new WorkbookGenerationJobService(
                jdbc,access,new ObjectMapper(),transactions(),3,24,60);
        try {
            assertThatThrownBy(()->service.enqueue(owner,owner.id(),"lesson","queue-limit-account",Map.of("lessonJson","{}")))
                    .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
                    .hasMessageContaining("per-account limit is 24");
        } finally {
            service.close();
        }
    }

    @Test
    void enforcesSchoolWideLimitBeforeAcceptingMoreJobs() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        McpAccessService access=mock(McpAccessService.class);
        AuthenticatedUser owner=new AuthenticatedUser(UUID.randomUUID(),"teacher@test.local",Role.TEACHER);
        when(access.requireCurrentActor(owner)).thenReturn(owner);
        when(access.requireTeacher(owner,owner.id())).thenReturn(owner);
        when(jdbc.query(any(String.class),any(RowMapper.class),any(),any(),any())).thenReturn(List.of());
        when(jdbc.queryForObject(contains("actor_id"),eq(Integer.class),eq(owner.id()))).thenReturn(2);
        when(jdbc.queryForObject(contains("state IN ('QUEUED','RUNNING')"),eq(Integer.class))).thenReturn(60);
        WorkbookGenerationJobService service=new WorkbookGenerationJobService(
                jdbc,access,new ObjectMapper(),transactions(),3,24,60);
        try {
            assertThatThrownBy(()->service.enqueue(owner,owner.id(),"lesson","queue-limit-global",Map.of("lessonJson","{}")))
                    .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
                    .hasMessageContaining("school workbook queue is full");
        } finally {
            service.close();
        }
    }

    @Test
    void rejectsUnsafeWorkerAndQueueConfigurations() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        McpAccessService access=mock(McpAccessService.class);
        ObjectMapper json=new ObjectMapper();
        PlatformTransactionManager tx=transactions();
        assertThatThrownBy(()->new WorkbookGenerationJobService(jdbc,access,json,tx,0,24,60))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->new WorkbookGenerationJobService(jdbc,access,json,tx,4,24,60))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->new WorkbookGenerationJobService(jdbc,access,json,tx,3,2,60))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->new WorkbookGenerationJobService(jdbc,access,json,tx,3,24,12))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
