import type { ContextScope, ResourceRef } from "./use-project-workspace";

export function sharesCurrentDraft(scope: ContextScope, selected: ResourceRef[], documentId: string) {
  return !["none","profile_only"].includes(scope) &&
    (scope!=="selected_resources" || selected.some(resource=>resource.kind==="document" && resource.id===documentId));
}
/** Matches workspace_ai's existing actions and quota buckets; no request aliases change. */
export const coachingModes = [
  {id:"next",label:["What should I write next?","¿Qué escribo ahora?"],description:["Explore three possible directions for your next writing session.","Explora tres posibles caminos para tu próxima sesión."],guidance:false},
  {id:"guidance",label:["Help Me Continue","Ayúdame a continuar"],description:["Find a question or a small next step in your own draft.","Encuentra una pregunta o un pequeño paso en tu borrador."],guidance:true},
  {id:"block",label:["Overcome writer’s block","Superar el bloqueo creativo"],description:["Try a fresh angle without replacing your writing.","Prueba un nuevo enfoque sin reemplazar tu escritura."],guidance:false},
  {id:"brainstorm",label:["Brainstorm ideas","Explorar ideas"],description:["Consider three ideas and choose the direction that feels right.","Considera tres ideas y elige el camino que prefieras."],guidance:false},
  {id:"organization",label:["Organize my writing","Organizar mi escritura"],description:["Explore structure and connections; keep the wording yours.","Explora la estructura y las conexiones; las palabras son tuyas."],guidance:true},
  {id:"research",label:["Research guidance","Preguntas de investigación"],description:["Find questions to investigate using the context you choose.","Encuentra preguntas para investigar con el contexto que elijas."],guidance:true},
  {id:"feedback",label:["Constructive feedback","Comentarios constructivos"],description:["Reflect on your draft with coaching questions and observations.","Reflexiona sobre tu borrador con preguntas y observaciones."],guidance:true},
] as const;
export function usesGuidanceAllowance(action: string) {
  return action==="continue" || coachingModes.some(mode=>mode.id===action && mode.guidance);
}
