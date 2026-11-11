import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import { useStudioAccount } from "./use-studio-account";
import { useAccountWriting, type WritingPreferences } from "./use-account-writing";
import type { Rewards } from "./rewards";

export type ProgressRange = "today" | "week" | "month" | "year";
export type ProgressBucket = {key:string;label:string;words:number;sessions:number;activeWritingSeconds:number};
export type ProgressStatistics = {
  user_id:string;range:ProgressRange;timezone:string;totalWords:number;sessionCount:number;
  activeWritingSeconds:number;longestSessionWords:number;buckets:ProgressBucket[];
};

/** Read existing account totals. This page never mounts the writing/session hook. */
export function useStudioProgress(selectedRange:ProgressRange,language:string) {
  const account=useStudioAccount(),{owner,paid,online}=account;
  const preferences=useQuery({queryKey:["studio-home-preferences",owner],queryFn:async()=>{
    const value=await apiGet<WritingPreferences>("/progress/preferences");
    if(value.user_id!==owner)throw Error("account_changed");return value;
  },enabled:!!owner&&online,retry:false,gcTime:0,refetchInterval:15000,refetchOnWindowFocus:true,refetchOnReconnect:true});
  const preferredTimezone=preferences.data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const summary=useAccountWriting(owner,paid,preferredTimezone);
  const value=summary.isError?undefined:summary.data;
  const timezone=value?.timezone || preferredTimezone;
  const range:ProgressRange=paid?selectedRange:"today";
  const date=value?.reportingDate;
  function statisticsOptions(period:ProgressRange,enabled:boolean) {
    return {queryKey:["progress-statistics",owner,paid,period,timezone,date],queryFn:async()=>{
      const result=await apiGet<ProgressStatistics>(`/progress/statistics?range=${period}&timezone=${encodeURIComponent(timezone)}`);
      if(result.user_id!==owner || result.range!==period || result.timezone!==timezone)throw Error("reporting_period_changed");
      const anchor=period==="year"?date?.slice(0,7)+"-01":date;
      if(!anchor || !result.buckets.some(bucket=>bucket.key===anchor))throw Error("reporting_period_changed");
      return result;
    },enabled:enabled&&!!owner&&!!date&&online,retry:false,gcTime:0,refetchInterval:15000,refetchOnWindowFocus:true,refetchOnReconnect:true};
  }
  const statistics=useQuery(statisticsOptions(range,true));
  // The calendar needs daily month buckets, even when the trend uses weeks/months.
  // Free never enables this query or a history range.
  const calendar=useQuery(statisticsOptions("month",paid));
  const rewards=useQuery({queryKey:["progress-rewards",owner,paid,language],queryFn:async()=>{
    const result=await apiGet<Rewards>("/rewards?language="+language);
    if(result.user_id!==owner)throw Error("account_changed");return result;
  },enabled:!!owner&&online,retry:false,gcTime:0,refetchInterval:15000,refetchOnWindowFocus:true,refetchOnReconnect:true});
  return {...account,preferences,summary,statistics,calendar,rewards,timezone,range,date,
    refresh:()=>Promise.all([account.account.refetch(),preferences.refetch(),summary.refetch(),...(date?[statistics.refetch(),...(paid&&range!=="month"?[calendar.refetch()]:[])]:[]),rewards.refetch()])};
}
