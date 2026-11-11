import type { ContextScope, ResourceRef } from "@/lib/use-project-workspace";
import { sharesCurrentDraft } from "@/lib/coaching-modes";
const scopeLabels: Record<ContextScope,[string,string]> = {
  current_project:["Current project","Proyecto actual"], selected_resources:["Selected resources","Recursos seleccionados"],
  all_projects:["Full library","Biblioteca completa"],profile_only:["Writing profile only","Solo perfil de escritura"],none:["No library context","Sin contexto de biblioteca"],
};
export default function CoachingContext({scope,selected,documentId,project,language,onReview}:{
  scope:ContextScope;selected:ResourceRef[];documentId?:string;project:string;language:string;onReview:()=>void;
}) {
  const es=language==="es",t=(en:string,spanish:string)=>es?spanish:en;
  const included=!!documentId && sharesCurrentDraft(scope,selected,documentId);
  return <section className="uw-coach-context" aria-label={t("Context for this request","Contexto de esta solicitud")}>
    <div><h3>{t("Context for this request","Contexto de esta solicitud")}</h3><button type="button" onClick={onReview}>{t("Review","Revisar")}</button></div>
    <dl><div><dt>{t("Project","Proyecto")}</dt><dd>{project}</dd></div><div><dt>{t("Library scope","Ámbito de biblioteca")}</dt><dd>{scopeLabels[scope][es?1:0]}{scope==="selected_resources"?` · ${selected.length}`:""}</dd></div><div><dt>{t("Current draft","Borrador actual")}</dt><dd>{included?t("Shared only when you request","Se comparte solo cuando lo pides"):t("Excluded by this scope","Excluido por este ámbito")}</dd></div></dl>
    <p>{t("Only authorized resources in this scope can be used. Changing scope does not grant source permissions.","Solo se pueden usar recursos autorizados de este ámbito. Cambiar el ámbito no concede permisos sobre las fuentes.")}</p>
  </section>;
}
