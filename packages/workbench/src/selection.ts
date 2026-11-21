/** 发布或试问返回时，只有仍停在发起时的项目和场景才写回页面。 */
export function sameSelection(
  requested: { projectId: string; scenarioId: string },
  current: { projectId: string; scenarioId: string },
): boolean {
  return requested.projectId === current.projectId && requested.scenarioId === current.scenarioId;
}
