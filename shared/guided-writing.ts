/** Guided goals never replace daily goals or the canonical activity ledger. */
export const GUIDED_PRESETS = [100, 250, 500, 750, 1000, 1500] as const;
export const GUIDED_MAX_WORDS = 10000;
export const GUIDED_INTENTIONS = ['continue', 'expand', 'new', 'perspective', 'surprise'] as const;
export type GuidedIntention = typeof GUIDED_INTENTIONS[number];
export type GuidedDirection = { goal: number; target_words: number; intention: GuidedIntention; sections: { title: string; words: number }[] };
export type GuidedRequest = { goal: number; written_words: number; intention: GuidedIntention; original_direction: string; session_text: string };
export type GuidedPlan = { version: 1; owner: string; documentId: string; goal: number; intention: GuidedIntention; sessionId: string | null; direction: { title: string; text: string; guided_direction: GuidedDirection } | null; contextKey: string; completionDismissed: boolean };
export function validGuidedGoal(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= GUIDED_MAX_WORDS; }
export function guidedProgress(words: number, goal: number) { const written = Math.max(0, Math.floor(words)); return { written, remaining: Math.max(0, goal-written), percent: Math.min(100, Math.floor(written/goal*100)), complete: written>=goal }; }
export function validGuidedDirection(value: unknown): value is GuidedDirection {
  if (!value || typeof value !== 'object') return false;
  const d = value as GuidedDirection;
  return validGuidedGoal(d.goal) && Number.isInteger(d.target_words) && d.target_words>0 && d.target_words<=d.goal && GUIDED_INTENTIONS.includes(d.intention) && Array.isArray(d.sections) && d.sections.length>=1 && d.sections.length<=5 && d.sections.every(s=>typeof s.title==='string' && s.title.length>0 && s.title.length<=100 && Number.isInteger(s.words) && s.words>0) && d.sections.reduce((n,s)=>n+s.words,0)===d.target_words;
}
export function readGuidedPlan(raw: string | null, owner: string, documentId: string): GuidedPlan | null {
  if(raw && raw.length>16000)return null;
  try { const p=JSON.parse(raw || 'null') as GuidedPlan; if (!p || p.version!==1 || p.owner!==owner || p.documentId!==documentId || !validGuidedGoal(p.goal) || !GUIDED_INTENTIONS.includes(p.intention) || (p.sessionId!==null && typeof p.sessionId!=='string') || typeof p.contextKey!=='string') return null;
    if(p.direction && (!validGuidedDirection(p.direction.guided_direction) || p.direction.guided_direction.goal!==p.goal || typeof p.direction.text!=='string' || p.direction.text.length>1100 || typeof p.direction.title!=='string' || p.direction.title.length>100)) return null;
    return p;
  } catch { return null; }
}
