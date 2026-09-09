const SKILLS_CONTEXT_BUDGET_WARNING =
  "Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";

/** Codex supplies no warning code. Match only this notice, allowing line wraps. */
export function isCodexSkillsBudgetWarning(text: string): boolean {
  return text.replace(/\s+/g, " ").trim() === SKILLS_CONTEXT_BUDGET_WARNING;
}
