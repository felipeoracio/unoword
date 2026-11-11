import { useState } from "react";
import type { ProgressStatistics } from "@/lib/use-studio-progress";
import { progressDateLabel, reportingMonth } from "@/lib/progress-dates";
import { formatWritingTime } from "@/lib/use-account-writing";

export default function ProgressCalendar({data,date,language}:{data:ProgressStatistics;date:string;language:string}) {
  const es=language==="es",t=(en:string,spanish:string)=>es?spanish:en;
  const [selected,setSelected]=useState(date);
  const {offset,days}=reportingMonth(date),byDate=new Map(data.buckets.map(bucket=>[bucket.key,bucket]));
  const chosen=byDate.get(selected);
  const weekdays=es?["L","M","X","J","V","S","D"]:["M","T","W","T","F","S","S"];
  return <>
    <p className="uw-progress-calendar-month">{progressDateLabel(date.slice(0,7)+"-01",language,true)}</p>
    <div className="uw-progress-calendar" role="group" aria-label={t("Writing activity calendar","Calendario de actividad de escritura")}>
      {weekdays.map((day,index)=><span key={"week-"+index} className="uw-progress-weekday" aria-hidden="true">{day}</span>)}
      {Array.from({length:offset},(_,index)=><span key={"blank-"+index} aria-hidden="true"/>)}
      {days.map(day=>{
        const bucket=byDate.get(day.key),future=day.key>date;
        const activity=bucket && (bucket.words>0 || bucket.activeWritingSeconds>0);
        const label=progressDateLabel(day.key,language);
        return future || !bucket?<span key={day.key} className="uw-progress-calendar-day is-unavailable" aria-label={label+" · "+(future?t("Future date","Fecha futura"):t("Data unavailable","Datos no disponibles"))}>{day.day}</span>
          :<button type="button" key={day.key} className={`uw-progress-calendar-day${activity?" has-activity":""}${bucket.words>0?" has-words":""}`} aria-label={`${label} · ${bucket.words.toLocaleString(language)} ${t("typed words","palabras escritas")} · ${formatWritingTime(bucket.activeWritingSeconds)}`} aria-pressed={selected===day.key} aria-current={day.key===date?"date":undefined} onClick={()=>setSelected(day.key)}>{day.day}<span aria-hidden="true"/></button>;
      })}
    </div>
    <p className="uw-progress-calendar-legend"><span aria-hidden="true"/>{t("Recorded activity","Actividad registrada")}</p>
    {chosen && selected<=date && <p className="uw-progress-selection" role="status">{progressDateLabel(selected,language)}: <strong>{chosen.words.toLocaleString(language)} {t("typed words","palabras escritas")}</strong> · {formatWritingTime(chosen.activeWritingSeconds)} {t("active writing time","de escritura activa")} · {chosen.sessions.toLocaleString(language)} {t("sessions","sesiones")}</p>}
    <p className="uw-progress-note">{t("Select a date for its recorded totals. A day can have active writing time even when no typed words were recorded.","Selecciona una fecha para ver sus totales registrados. Un día puede tener tiempo de escritura activa aunque no se hayan registrado palabras escritas.")}</p>
  </>;
}
