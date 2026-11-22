/** Read-only monthly estimate from the current, explicitly assessed skill mastery.
 * No school-test forecasts or student progress writes. Missing skills are NOT zero.
 * Each month uses its linked topics; duplicate skills are counted once.
 */
export function calculateMonthReadiness(board, month, mastery = {}, schoolType = "") {
  const empty = {
    status: "NO_PLAN", percent: null, observedPercent: null, coveragePercent: 0,
    assessedCount: 0, totalCount: 0, mappedTopicCount: 0, topicCount: 0,
    topics: [], weakSkills: [], strongSkills: [], unassessedSkills: [], unmappedTopics: []
  };
  if (!month || !Array.isArray(month.topics) || !board?.nodes || !board?.edges) return empty;
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
  const enough = assessedCount >= Math.min(3, totalCount) && totalCount > 0
    && coveragePercent >= 60 && unmappedTopics.length === 0;
  const skills = [...all.values()].map(skill => ({
    id: skill.id, title: skill.title,
    value: assessed.has(skill.id) ? assessed.get(skill.id) : null
  }));
  return {
    status: enough ? "ESTIMATED" : totalCount === 0 ? "UNMAPPED"
      : assessedCount === 0 ? "NO_DATA" : "INSUFFICIENT_DATA",
    percent: enough ? observedPercent : null,
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
