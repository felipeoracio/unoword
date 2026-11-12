import { useState } from "react";
import { StudioCard } from "./StudioPrimitives";
import { formatWritingTime } from "@/lib/use-account-writing";
import type { ProgressStatistics } from "@/lib/use-studio-progress";
import { progressDateLabel } from "@/lib/progress-dates";
import { useSurfaceCue } from "@/lib/use-surface-cue";
import emptyArt from "@/assets/studio/empty-states/progress.webp";

export default function ProgressTrend({data,date,language}:{data:ProgressStatistics;date:string;language:string}) {
  const es=language==="es",t=(en:string,spanish:string)=>es?spanish:en;
  const [metric,setMetric]=useState<"words"|"time">("words"),[selected,setSelected]=useState("");
  const buckets=data.buckets.filter(bucket=>bucket.key<=date);
  const maximum=Math.max(1,...buckets.map(bucket=>metric==="words"?bucket.words:bucket.activeWritingSeconds));
  const choice=buckets.find(bucket=>bucket.key===selected);
  const monthly=data.range==="year";
  const number=(value:number)=>value.toLocaleString(language);
  const label=(key:string)=>progressDateLabel(key,language,monthly);
  const empty=buckets.every(bucket=>bucket.words===0 && bucket.activeWritingSeconds===0);
  const chartCue=useSurfaceCue<HTMLDivElement>(metric, !empty, false);
  return <>
    <div className="uw-progress-chart-heading"><label>{t("Chart measure","Medida del gráfico")}<select value={metric} onChange={event=>setMetric(event.target.value as "words"|"time")}><option value="words">{t("Typed words","Palabras escritas")}</option><option value="time">{t("Active writing time","Tiempo de escritura activa")}</option></select></label><p>{t("Select a bar to explore its totals.","Selecciona una barra para explorar sus totales.")}</p></div>
    {empty?<StudioCard className="uw-progress-empty"><img src={emptyArt} alt="" width={1000} height={700}/><div><h3>{t("A little space for your next writing day.","Un pequeño espacio para tu próximo día de escritura.")}</h3><p>{t("Your recorded activity will appear here. Begin at your own pace.","Tu actividad registrada aparecerá aquí. Empieza a tu ritmo.")}</p></div></StudioCard>
      :<div {...chartCue} className="uw-progress-chart" role="group" aria-label={metric==="words"?t("Typed words over time","Palabras escritas a lo largo del tiempo"):t("Active writing time over time","Tiempo de escritura activa a lo largo del tiempo")}>
        <div className="uw-progress-axis" aria-hidden="true"><span>{metric==="words"?number(maximum):formatWritingTime(maximum)}</span><span>0</span></div>
        <div className="uw-progress-bars">{buckets.map(bucket=>{
          const amount=metric==="words"?bucket.words:bucket.activeWritingSeconds;
          const full=`${label(bucket.key)} · ${number(bucket.words)} ${t("typed words","palabras escritas")} · ${formatWritingTime(bucket.activeWritingSeconds)}`;
          return <button key={bucket.key} type="button" className="uw-progress-bar" aria-label={full} aria-pressed={selected===bucket.key} title={full} onClick={()=>setSelected(bucket.key)}>
            <span className="uw-progress-bar-track" aria-hidden="true"><span style={{height:`${amount/maximum*100}%`}}/></span><span aria-hidden="true">{monthly?new Intl.DateTimeFormat(language,{month:"short",timeZone:"UTC"}).format(new Date(bucket.key+"T12:00:00Z")):Number(bucket.key.slice(8))}</span>
          </button>;
        })}</div>
      </div>}
    {choice && <p className="uw-progress-selection" role="status">{label(choice.key)}: <strong>{number(choice.words)} {t("typed words","palabras escritas")}</strong> · {formatWritingTime(choice.activeWritingSeconds)} {t("active writing time","de escritura activa")} · {number(choice.sessions)} {t("sessions","sesiones")}</p>}
    <details className="uw-progress-data"><summary>{t("View chart data table","Ver la tabla de datos del gráfico")}</summary><div className="uw-progress-table-scroll" tabIndex={0} role="region" aria-label={t("Chart data","Datos del gráfico")}><table><caption>{t("Recorded writing activity","Actividad de escritura registrada")}</caption><thead><tr><th scope="col">{t("Date","Fecha")}</th><th scope="col">{t("Typed words","Palabras escritas")}</th><th scope="col">{t("Active time","Tiempo activo")}</th><th scope="col">{t("Sessions","Sesiones")}</th></tr></thead><tbody>{buckets.map(bucket=><tr key={bucket.key}><th scope="row">{label(bucket.key)}</th><td>{number(bucket.words)}</td><td>{formatWritingTime(bucket.activeWritingSeconds)}</td><td>{number(bucket.sessions)}</td></tr>)}</tbody></table></div></details>
    <p className="uw-progress-note">{monthly?t("Monthly totals; the current month is still in progress.","Totales mensuales; el mes actual sigue en curso."):t("Daily totals in your reporting timezone. Future dates are not plotted.","Totales diarios en tu zona horaria de registro. No se muestran fechas futuras.")}</p>
  </>;
}
