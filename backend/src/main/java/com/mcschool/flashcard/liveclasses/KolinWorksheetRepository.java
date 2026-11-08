package com.mcschool.flashcard.liveclasses;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.*;

public interface KolinWorksheetRepository extends JpaRepository<KolinWorksheet, UUID> {
    @Modifying(flushAutomatically=true)
    @Query(value="""
        INSERT INTO kolin_worksheets
          (id,class_id,teacher_id,client_message_id,request_hash,state,task_count,page_count,created_at,updated_at,version)
        VALUES (:id,:classId,:teacherId,:clientId,:hash,'NEW',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0)
        ON CONFLICT (class_id,teacher_id,client_message_id) DO NOTHING
        """, nativeQuery=true)
    int reserve(UUID id, UUID classId, UUID teacherId, UUID clientId, String hash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from KolinWorksheet w where w.classId=:classId and w.teacherId=:teacherId and w.clientMessageId=:clientId")
    Optional<KolinWorksheet> findRequestForUpdate(UUID classId, UUID teacherId, UUID clientId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from KolinWorksheet w where w.id=:id and w.classId=:classId and w.teacherId=:teacherId")
    Optional<KolinWorksheet> findForUpdate(UUID id, UUID classId, UUID teacherId);

    Optional<KolinWorksheet> findByIdAndClassIdAndTeacherId(UUID id, UUID classId, UUID teacherId);
    java.util.List<KolinWorksheet> findByParentIdAndClassIdAndTeacherIdOrderByMaterialIndex(UUID parentId, UUID classId, UUID teacherId);
    interface DraftContext { UUID getStudentId(); String getTaskContent(); }
    @Query("select w.studentId as studentId,w.taskContent as taskContent from KolinWorksheet w "
            + "where w.classId=:classId and w.teacherId=:teacherId and w.parentId is null and w.resultType in ('worksheet','interactive','materials') "
            + "and w.state in ('READY','ADDED') order by w.createdAt desc,w.id desc")
    java.util.List<DraftContext> latestDraftContext(UUID classId,UUID teacherId,org.springframework.data.domain.Pageable page);
}
