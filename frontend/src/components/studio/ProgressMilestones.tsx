import { Link } from "react-router-dom";
import { Badge } from "@/components/rewards/Rewards";
import { StudioCard } from "./StudioPrimitives";
import type { Rewards } from "@/lib/rewards";
import { progressDateLabel } from "@/lib/progress-dates";
import feather from "@/assets/studio/milestones/feather.webp";
import book from "@/assets/studio/milestones/open-book.webp";
import flame from "@/assets/studio/milestones/flame.webp";
import flag from "@/assets/studio/milestones/flag.webp";
import star from "@/assets/studio/milestones/star.webp";
import mountain from "@/assets/studio/milestones/mountain.webp";

const artwork:Record<string,string>={words:feather,sessions:book,seconds:mountain,streak:flame,goals:flag,documents:book,personal_best:star};
export default function ProgressMilestones({data,paid,language}:{data:Rewards;paid:boolean;language:string}) {
  const es=language==="es",t=(en:string,spanish:string)=>es?spanish:en;
  if(!data.enabled || !data.preferences.widget)return <StudioCard><p>{t("Your milestone preview is off. Earned achievements stay saved.","Tu vista previa de hitos está desactivada. Los logros obtenidos se conservan.")}</p><Link to="/rewards">{t("View milestone settings","Ver los ajustes de logros")}</Link></StudioCard>;
  const earned=data.achievements.filter(achievement=>achievement.unlocked && (paid || achievement.metric!=="streak" || achievement.requirement<=7))
    .sort((a,b)=>(b.awarded_at || b.earned_on || "").localeCompare(a.awarded_at || a.earned_on || "")).slice(0,3);
  return earned.length?<div className="uw-progress-milestone-grid">{earned.map(achievement=><StudioCard className="uw-progress-milestone" key={achievement.id}><Badge achievement={achievement} fallbackImage={artwork[achievement.metric]||star}/><div><span className="uw-progress-eyebrow">{t("Earned milestone","Hito obtenido")}</span><h3>{achievement.name}</h3><p>{achievement.description}</p>{achievement.earned_on && <time dateTime={achievement.earned_on}>{t("Earned","Obtenido")} {progressDateLabel(achievement.earned_on,language)}</time>}</div></StudioCard>)}</div>
    :<StudioCard className="uw-progress-milestone-empty"><img src={star} alt="" width={512} height={512}/><div><h3>{t("Every writing day is a beginning.","Cada día de escritura es un comienzo.")}</h3><p>{t("Your verified milestones will appear here as you write. There are no comparisons or penalties.","Tus hitos verificados aparecerán aquí mientras escribes. No hay comparaciones ni penalizaciones.")}</p></div></StudioCard>;
}
