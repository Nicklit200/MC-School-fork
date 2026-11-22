package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.skills.SkillBoardService;
import com.mcschool.flashcard.skills.SkillMasteryService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Exam skill links are edited through MCH3, never through the teacher calendar.
 * Readiness is computed at read time from the one canonical student mastery map.
 */
@Service
public class SchoolAssessmentSkillService {
    public record SkillRow(String id,String title,Integer percent) {}
    public record TopicRow(String title,Integer percent,int assessedCount,int totalCount) {}
    public record Readiness(UUID assessmentId,UUID studentId,String boardId,
                            List<SkillRow> skills,List<TopicRow> topics,List<String> unmappedTopics,
                            int assessedCount,int totalCount,int coveragePercent,
                            Integer percent,String status) {}
    public record Edit(long expectedRevision,String boardId,List<String> skillIds,
                       List<String> unmappedTopics,Map<String,List<String>> topicSkillIds) {}

    private final SchoolAssessmentService assessments;
    private final SkillBoardService boards;
    private final SkillMasteryService mastery;
    private final UserRepository users;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public SchoolAssessmentSkillService(SchoolAssessmentService assessments,
            SkillBoardService boards,SkillMasteryService mastery,UserRepository users,
            JdbcTemplate jdbc,ObjectMapper mapper) {
        this.assessments=assessments;this.boards=boards;this.mastery=mastery;
        this.users=users;this.jdbc=jdbc;this.mapper=mapper;
    }

    private record Linked(String boardId,List<String> ids,List<String> unmappedTopics,Map<String,List<String>> topicSkillIds) {}
    private Linked links(UUID id) {
        return jdbc.query("""
           SELECT board_id,skill_ids::text,unmapped_topics::text,topic_skill_ids::text
           FROM school_assessments WHERE id=?
           """,(rs,row)->new Linked(rs.getString(1),
                List.of(mapper.readValue(rs.getString(2),String[].class)),
                List.of(mapper.readValue(rs.getString(3),String[].class)),
                readTopicIds(rs.getString(4))),id)
                .stream().findFirst().orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Контрольная не найдена"));
    }

    @Transactional(readOnly=true)
    public Readiness readiness(AuthenticatedUser caller,UUID id) {
        SchoolAssessmentService.Assessment event=assessments.get(caller,id);
        Linked linked=links(id);
        if(linked.boardId()==null||linked.ids().isEmpty())
            return new Readiness(id,event.studentId(),linked.boardId(),List.of(),
                event.topics().stream().map(title->new TopicRow(title,null,0,0)).toList(),linked.unmappedTopics(),
                0,0,0,null,"NOT_LINKED");
        var board=boards.get(linked.boardId());
        var snapshot=mastery.get(linked.boardId(),event.studentId(),caller);
        User pupil=users.findById(event.studentId()).orElseThrow(
            ()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Ученик не найден"));
        var byId=new HashMap<String,SkillBoardService.Node>();
        for(var node:board.data().nodes())byId.put(node.id(),node);
        var rows=new ArrayList<SkillRow>();
        var unknown=new ArrayList<String>(linked.unmappedTopics());
        int sum=0,assessed=0;
        for(String skillId:linked.ids()) {
            var node=byId.get(skillId);
            if(node==null||!"skill".equals(node.kind())||node.archived()||
                    (node.schoolTypes()!=null&&!node.schoolTypes().isEmpty()
                      && !node.schoolTypes().contains(pupil.getSchoolType()))) {
                unknown.add("Навык больше не активен: "+skillId);
                continue;
            }
            Integer value=snapshot.mastery().get(skillId);
            if(value!=null){sum+=value;assessed++;}
            rows.add(new SkillRow(node.id(),node.title(),value));
        }
        int total=rows.size();
        int coverage=total==0?0:(int)Math.round(100d*assessed/total);
        Integer percent=assessed==0?null:(int)Math.round((double)sum/assessed);
        String status=total==0?"NO_VALID_SKILLS":
            assessed==0?"NOT_ASSESSED":
            assessed<total||!unknown.isEmpty()?"PARTIAL":"ESTIMATED";
        Map<String,SkillRow> bySkill=new HashMap<>();
        for(SkillRow row:rows)bySkill.put(row.id(),row);
        List<TopicRow> topicRows=new ArrayList<>();
        Set<String> linkedTopics=new HashSet<>();
        for(String title:event.topics()) {
            linkedTopics.add(title);
            List<String> topicIds=linked.topicSkillIds().getOrDefault(title,List.of());
            int counted=0,topicSum=0;
            Set<String> used=new HashSet<>();
            for(String skillId:topicIds) {
                SkillRow row=bySkill.get(skillId);
                if(row==null||!used.add(skillId))continue;
                if(row.percent()!=null){counted++;topicSum+=row.percent();}
            }
            topicRows.add(new TopicRow(title,counted==0?null:(int)Math.round((double)topicSum/counted),
                    counted,used.size()));
        }
        // The overall exam readiness is the mean of unique, assessed skill IDs,
        // not an average of per-topic values (which could double-count skills).
        return new Readiness(id,event.studentId(),linked.boardId(),List.copyOf(rows),
            List.copyOf(topicRows),List.copyOf(unknown),assessed,total,coverage,percent,status);
    }

    @Transactional
    public Readiness skills(AuthenticatedUser caller,UUID id,Edit input) {
        if(input==null||input.expectedRevision()<1)throw bad("Укажите текущую версию контрольной");
        var old=assessments.get(caller,id);
        if(old.revision()!=input.expectedRevision())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Событие изменилось. Обновите его");
        if(caller==null||caller.id()==null||!Set.of(Role.ADMIN,Role.TEACHER).contains(caller.role()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Нет доступа");
        if(input.boardId()==null||input.boardId().isBlank()||input.boardId().length()>128)
            throw bad("Укажите boardId");
        if(input.skillIds()==null||input.skillIds().size()>48||
           input.unmappedTopics()==null||input.unmappedTopics().size()>32||
           input.topicSkillIds()==null||input.topicSkillIds().size()>24)
            throw bad("Слишком много навыков или неизвестных тем");
        var ids=new ArrayList<String>();
        for(String skillId:input.skillIds()) {
            if(skillId==null||skillId.isBlank()||skillId.length()>128)
                throw bad("Неверный ID навыка");
            if(!ids.contains(skillId)) ids.add(skillId);
        }
        var unmapped=new ArrayList<String>();
        for(String topic:input.unmappedTopics()) {
            if(topic==null||topic.isBlank()||topic.length()>180)throw bad("Некорректная неизвестная тема");
            if(!unmapped.contains(topic.trim()))unmapped.add(topic.trim());
        }
        var board=boards.get(input.boardId());
        User pupil=users.findById(old.studentId()).orElseThrow(
            ()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Ученик не найден"));
        if(pupil.getGrade()==null||pupil.getGrade()!=board.data().grade())
            throw bad("Карта навыков не соответствует классу ученика");
        var allowed=new HashSet<String>();
        for(var node:board.data().nodes())
            if("skill".equals(node.kind())&&!node.archived()&&
                (node.schoolTypes()==null||node.schoolTypes().isEmpty()||
                    node.schoolTypes().contains(pupil.getSchoolType())))
                allowed.add(node.id());
        if(ids.stream().anyMatch(skillId->!allowed.contains(skillId)))
            throw bad("Указан архивный, отсутствующий или неподходящий школе навык");
        Set<String> selected=new HashSet<>(ids);
        Map<String,List<String>> topicMap=new LinkedHashMap<>();
        for(var entry:input.topicSkillIds().entrySet()){
            if(entry.getKey()==null||!old.topics().contains(entry.getKey()))
                throw bad("Тема отсутствует в контрольной");
            List<String> linkedIds=entry.getValue();
            if(linkedIds==null||linkedIds.size()>48||
                linkedIds.stream().anyMatch(value->!selected.contains(value)))
                throw bad("Тема должна содержать только навыки данной контрольной");
            topicMap.put(entry.getKey(),new ArrayList<>(new LinkedHashSet<>(linkedIds)));
        }
        // Require every linked skill to belong to at least one named exam topic.
        Set<String> linkedAll=new HashSet<>();
        for(List<String> group:topicMap.values())linkedAll.addAll(group);
        if(!linkedAll.containsAll(ids))throw bad("У каждого навыка должна быть тема контрольной");
        // Preserve previous event in the existing audit journal.
        jdbc.update("""
            INSERT INTO school_assessment_changes(assessment_id,old_revision,old_state,updated_by)
            SELECT id,revision,to_jsonb(school_assessments),? FROM school_assessments
            WHERE id=? AND teacher_id=? AND revision=?
            """,caller.id(),id,old.teacherId(),input.expectedRevision());
        int affected=jdbc.update("""
            UPDATE school_assessments
            SET board_id=?,skill_ids=CAST(? AS jsonb),
                unmapped_topics=CAST(? AS jsonb),topic_skill_ids=CAST(? AS jsonb),
                revision=revision+1,updated_at=now(),updated_by=?
            WHERE id=? AND teacher_id=? AND revision=?
            """,input.boardId(),mapper.writeValueAsString(ids),mapper.writeValueAsString(unmapped),
            mapper.writeValueAsString(topicMap),caller.id(),id,old.teacherId(),input.expectedRevision());
        if(affected!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Конфликт версии контрольной");
        return readiness(caller,id);
    }
    @SuppressWarnings("unchecked")
    private Map<String,List<String>> readTopicIds(String value) {
        if(value==null||value.isBlank())return Map.of();
        var parsed=mapper.readValue(value,Map.class);
        Map<String,List<String>> result=new LinkedHashMap<>();
        for(var item:parsed.entrySet()){
            if(!(item.getKey() instanceof String key)||!(item.getValue() instanceof List<?> items))continue;
            result.put(key,items.stream().filter(String.class::isInstance)
                .map(String.class::cast).toList());
        }
        return result;
    }

    private static ResponseStatusException bad(String reason){
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,reason);
    }
}
