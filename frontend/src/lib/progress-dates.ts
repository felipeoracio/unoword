/** API date keys are already reporting-calendar dates. Never shift them again. */
export function progressDateLabel(key:string,language:string,monthly=false) {
  return new Intl.DateTimeFormat(language,{timeZone:"UTC",year:"numeric",month:monthly?"long":"short",...(monthly?{}:{day:"numeric"})}).format(new Date(key+"T12:00:00Z"));
}
export function reportingMonth(date:string) {
  const [year,month]=date.split("-").map(Number);
  const count=new Date(Date.UTC(year,month,0)).getUTCDate();
  const offset=(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7;
  return {offset,days:Array.from({length:count},(_,index)=>({day:index+1,key:`${date.slice(0,7)}-${String(index+1).padStart(2,"0")}`}))};
}
