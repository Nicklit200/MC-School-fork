/** Read-only monthly coverage-weighted readiness from the current skill mastery.
 * Unassessed linked skills contribute 0 to READINESS (not stored mastery or observed score).
 * No school-test forecasts or student progress writes. Duplicate skills count once.
 */
export function calculateMonthReadiness(board, month, mastery = {}, schoolType = "") {
  const empty = {
    status: "NO_PLAN", percent: null, observedPercent: null, coveragePercent: 0,
    assessedCount: 0, totalCount: 0, mappedTopicCount: 0, topicCount: 0,
    topics: [], weakSkills: [], strongSkills: [], unassessedSkills: [], unmappedTopics: []
  };
  if (!month || !Array.isArray(month.topics) || !board?.nodes || !board?.edges) return empty;
  // Prefer exact month-to-skill mappings when the calendar provides them.
  // This also works if the optional, pupil-specific monthly-plan endpoint is
  // empty or unavailable; percentages always come from LIVE student mastery.
  // Never average an entire topic subtree if the month lists precise skills.
  if (Array.isArray(month.skillIds) && month.skillIds.length) {
    const unmapped = [
      ...(Array.isArray(month.unmappedTopics) ? month.unmappedTopics : []),
      ...month.topics.filter(topic => !topic?.boardTopicId).map(topic => topic.name)
    ];
    const result = calculateIndividualMonthReadiness(board, {
      skillIds: month.skillIds,
      topics: month.topics.map(topic => topic.name),
      unmappedTopics: [...new Set(unmapped)]
    }, mastery, schoolType);
    if (result) return {...result, source: "CALENDAR_SKILL_MAP"};
  }
  const nodes = new Map(board.nodes.map(node => [node.id, node]));
  const children = new Map();
  for (const edge of board.edges) {
    if (edge.kind !== "contains") continue;
    if (!children.has(edge.source)) children.set(edge.source, []);
    children.get(edge.source).push(edge.target);
  }
  const findSkills = rootId => {
    const found = [], seen = new Set([rootId]), queue = [rootId];
    while (queue.length) {
      const current = queue.shift();
      for (const childId of children.get(current) || []) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        const child = nodes.get(childId);
        if (!child || child.archived) continue;
        if (child.kind === "skill"
          && (!Array.isArray(child.schoolTypes) || child.schoolTypes.length === 0
            || !schoolType || child.schoolTypes.includes(schoolType))) found.push(child);
        queue.push(childId);
      }
    }
    return found;
  };
  const assessed = new Map(), all = new Map(), topics = [], unmappedTopics = [];
  for (const topic of month.topics) {
    const label = topic?.name || "Тема без названия";
    const linked = nodes.get(topic?.boardTopicId);
    const skills = linked?.kind === "topic" && !linked.archived ? findSkills(linked.id) : [];
    const skillRows = [];
    if (!skills.length) unmappedTopics.push(label);
    for (const skill of skills) {
      all.set(skill.id, skill);
      const raw = mastery && Object.hasOwn(mastery, skill.id) ? mastery[skill.id] : null;
      const value = raw !== null && raw !== "" && Number.isFinite(Number(raw))
        && Number(raw) >= 0 && Number(raw) <= 100 ? Number(raw) : null;
      if (value !== null) assessed.set(skill.id, value);
      skillRows.push({ id: skill.id, title: skill.title, value });
    }
    const assessedHere = skillRows.filter(skill => skill.value !== null);
    topics.push({
      name: label, boardTopicId: linked?.kind === "topic" ? linked.id : null,
      totalCount: skillRows.length, assessedCount: assessedHere.length,
      observedPercent: assessedHere.length
        ? Math.round(assessedHere.reduce((sum, skill) => sum + skill.value, 0) / assessedHere.length) : null,
      skills: skillRows
    });
  }
  const assessedCount = assessed.size, totalCount = all.size;
  const observedPercent = assessedCount
    ? Math.round([...assessed.values()].reduce((sum, value) => sum + value, 0) / assessedCount) : null;
  const coveragePercent = totalCount ? Math.round(100 * assessedCount / totalCount) : 0;
  // Missing assessments have no demonstrated mastery, so 0 is used exclusively
  // as their contribution to the readiness estimate. Never write it to the board.
  const percent = totalCount
    ? Math.round([...assessed.values()].reduce((sum, value) => sum + value, 0) / totalCount) : null;
  const skills = [...all.values()].map(skill => ({
    id: skill.id, title: skill.title,
    value: assessed.has(skill.id) ? assessed.get(skill.id) : null
  }));
  return {
    status: totalCount ? "ESTIMATED" : "UNMAPPED",
    percent,
    observedPercent, coveragePercent, assessedCount, totalCount,
    mappedTopicCount: topics.length - unmappedTopics.length, topicCount: topics.length, topics,
    weakSkills: skills.filter(skill => skill.value !== null && skill.value < 60)
      .sort((a, b) => a.value - b.value),
    strongSkills: skills.filter(skill => skill.value !== null && skill.value >= 80)
      .sort((a, b) => b.value - a.value),
    unassessedSkills: skills.filter(skill => skill.value === null),
    unmappedTopics
  };
}

/**
 * The individual monthly curriculum is authoritative for which skills belong
 * to that student's month. Unlike the broad textbook topics, this does not
 * count unrelated future skills in the same curriculum section.
 * An unassessed mapped skill contributes zero to this conservative readiness,
 * while still remaining unknown in the actual skill map and evidence records.
 * An unmapped topic is flagged and is NEVER silently treated as a 0%-skill.
 */
export function calculateIndividualMonthReadiness(board, individual, mastery = {}, schoolType = "") {
  if (!individual || !Array.isArray(individual.skillIds) || individual.skillIds.length === 0) return null;
  const nodes = new Map((board?.nodes || []).map(node => [node.id, node]));
  const ids = [...new Set(individual.skillIds)];
  const skills = ids.map(id => nodes.get(id)).filter(node =>
    node?.kind === "skill" && !node.archived
      && (!Array.isArray(node.schoolTypes) || !node.schoolTypes.length
          || !schoolType || node.schoolTypes.includes(schoolType)))
    .map(node => {
      const raw = Object.hasOwn(mastery || {}, node.id) ? mastery[node.id] : null;
      const value = typeof raw === "number" && Number.isFinite(raw)
        && raw >= 0 && raw <= 100 ? raw : null;
      return {id: node.id, title: node.title, value};
    });
  const assessed = skills.filter(skill => skill.value !== null);
  const totalCount = skills.length, assessedCount = assessed.length;
  const observedPercent = assessedCount
    ? Math.round(assessed.reduce((sum, skill) => sum + skill.value, 0) / assessedCount) : null;
  const percent = totalCount
    ? Math.round(assessed.reduce((sum, skill) => sum + skill.value, 0) / totalCount) : null;
  const missingIds = ids.filter(id => !skills.some(skill => skill.id === id));
  const unmappedTopics = [...(individual.unmappedTopics || []),
    ...missingIds.map(id => "Нет активного навыка: " + id)];
  return {
    source: "INDIVIDUAL_PLAN",
    status: totalCount ? "ESTIMATED" : "UNMAPPED",
    percent, observedPercent,
    coveragePercent: totalCount ? Math.round(100 * assessedCount / totalCount) : 0,
    assessedCount, totalCount, mappedTopicCount: 1, topicCount: 1,
    topics: [{
      name: (individual.topics || []).join(" · ") || "Навыки индивидуального плана",
      boardTopicId: null, totalCount, assessedCount, observedPercent, skills
    }],
    weakSkills: assessed.filter(skill => skill.value < 60).sort((a, b) => a.value - b.value),
    strongSkills: assessed.filter(skill => skill.value >= 80).sort((a, b) => b.value - a.value),
    unassessedSkills: skills.filter(skill => skill.value === null),
    unmappedTopics
  };
}
