-- Personal, optional rewards. Apply after unified account writing sync.
-- Additive evidence only: no writing, streak, subscription or quota resets.
begin;
create table if not exists public.writing_reward_definitions(
 id text primary key,name text not null,name_es text not null,description text not null,description_es text not null,
 category text not null check(category in ('words','streaks','goals','sessions','time','documents','growth')),
 metric text not null check(metric in ('words','streak','goals','sessions','seconds','documents','personal_best','month_days','month_sessions','return_days','goal_weeks')),
 threshold bigint not null check(threshold between 1 and 1000000000000),
 tier text not null check(tier in ('bronze','silver','gold','platinum','diamond')),pro_only boolean not null default false,
 active boolean not null default true,badge_image text,sort_order integer not null,revision integer not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.writing_reward_definitions enable row level security;
revoke all on public.writing_reward_definitions from public,anon,authenticated;
grant all on public.writing_reward_definitions to service_role;
create table if not exists public.writing_reward_preferences(
 user_id uuid primary key references auth.users on delete cascade,enabled boolean not null default true,
 celebrations boolean not null default true,widget boolean not null default true,showcase text[] not null default '{}',
 revision bigint not null default 0,observed_since timestamptz not null default now(),evaluated_at timestamptz,
 quiet_next boolean not null default true,last_celebrated_at timestamptz,check(cardinality(showcase)<=3)
);
alter table public.writing_reward_preferences enable row level security;
revoke all on public.writing_reward_preferences from public,anon,authenticated;
grant all on public.writing_reward_preferences to service_role;
create table if not exists public.writing_user_rewards(
 user_id uuid not null references auth.users on delete cascade,achievement_id text not null references public.writing_reward_definitions,
 awarded_at timestamptz not null default now(),achieved_on date not null,awarded_requirement bigint not null,
 notified_at timestamptz,primary key(user_id,achievement_id)
);
alter table public.writing_user_rewards enable row level security;
revoke all on public.writing_user_rewards from public,anon,authenticated;
grant all on public.writing_user_rewards to service_role;
create table if not exists public.writing_personal_milestones(
 user_id uuid not null references auth.users on delete cascade,kind text not null,event_key text not null,
 value bigint not null,previous_best bigint,occurred_on date not null,created_at timestamptz not null default now(),
 primary key(user_id,kind,event_key)
);
alter table public.writing_personal_milestones enable row level security;
revoke all on public.writing_personal_milestones from public,anon,authenticated;
grant all on public.writing_personal_milestones to service_role;
-- Outcome evidence, not another word/time ledger. No document content is copied.
create table if not exists public.writing_reward_goal_days(
 user_id uuid not null references auth.users on delete cascade,reporting_date date not null,target integer not null check(target>0),
 timezone text not null,locked boolean not null default false,achieved_at timestamptz,
 primary key(user_id,reporting_date)
);
alter table public.writing_reward_goal_days enable row level security;
revoke all on public.writing_reward_goal_days from public,anon,authenticated;
grant all on public.writing_reward_goal_days to service_role;
create table if not exists public.writing_reward_document_completions(
 user_id uuid not null references auth.users on delete cascade,document_id uuid not null,completed_at timestamptz not null,
 primary key(user_id,document_id)
);
alter table public.writing_reward_document_completions enable row level security;
revoke all on public.writing_reward_document_completions from public,anon,authenticated;
grant all on public.writing_reward_document_completions to service_role;
-- Start observation now for existing users; never replace another preference.
insert into public.writing_reward_preferences(user_id) select id from auth.users on conflict do nothing;
-- Only current saved completion state is verifiable before this migration.
insert into public.writing_reward_document_completions(user_id,document_id,completed_at)
 select user_id,id,completed_at from public.writing_documents where completion_status='completed' and completed_at is not null
 on conflict do nothing;
-- Lock today's known target for writers who already have activity. No past goal
-- dates are invented; changing a target must not retroactively complete old days.
insert into public.writing_reward_goal_days(user_id,reporting_date,target,timezone,locked)
 select a.user_id,(now() at time zone coalesce(p.timezone,'UTC'))::date,coalesce(p.daily_goal,250),coalesce(p.timezone,'UTC'),true
 from public.writing_activity a left join public.writing_progress_preferences p on p.user_id=a.user_id
 where a.typed_words>0 and (a.started_at at time zone coalesce(p.timezone,'UTC'))::date=(now() at time zone coalesce(p.timezone,'UTC'))::date
 group by a.user_id,p.timezone,p.daily_goal on conflict do nothing;
create or replace function public.writing_reward_capture_activity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare tz text; goal integer; day date; today date; evidence public.writing_reward_goal_days;
begin
 -- No additional work for a duplicate checkpoint or for metadata-only changes.
 if tg_op='UPDATE' and new.typed_words<=old.typed_words then return new;end if;
 if new.typed_words<=0 then return new;end if;
 select coalesce(timezone,'UTC'),daily_goal into tz,goal from public.writing_progress_preferences where user_id=new.user_id;
 tz:=coalesce(tz,'UTC');goal:=coalesce(goal,250);day:=(new.started_at at time zone tz)::date;today:=(now() at time zone tz)::date;
 if day=today and not exists(select 1 from public.writing_reward_goal_days g where g.user_id=new.user_id and g.reporting_date<>day and g.locked
 and tstzrange(g.reporting_date::timestamp at time zone g.timezone,(g.reporting_date+1)::timestamp at time zone g.timezone,'[)') && tstzrange(day::timestamp at time zone tz,(day+1)::timestamp at time zone tz,'[)')) then
 insert into public.writing_reward_goal_days(user_id,reporting_date,target,timezone,locked)
 values(new.user_id,day,goal,tz,true) on conflict(user_id,reporting_date) do update set locked=true;
 end if;
 -- Offline uploads can complete a day only if its target was actually captured.
 for evidence in select * from public.writing_reward_goal_days where user_id=new.user_id and achieved_at is null and locked and reporting_date=(new.started_at at time zone timezone)::date loop
 if (select coalesce(sum(typed_words),0) from public.writing_activity where user_id=new.user_id
 and (started_at at time zone evidence.timezone)::date=evidence.reporting_date and started_at<=now())>=evidence.target then
 update public.writing_reward_goal_days set achieved_at=clock_timestamp() where user_id=new.user_id and reporting_date=evidence.reporting_date;
 end if;
 end loop;
 return new;
end $$;
drop trigger if exists writing_reward_capture_activity on public.writing_activity;
create trigger writing_reward_capture_activity after insert or update of typed_words on public.writing_activity
 for each row execute function public.writing_reward_capture_activity();
create or replace function public.writing_reward_capture_goal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare tz text; day date; written bigint; prior integer;
begin
 tz:=coalesce(new.timezone,'UTC');day:=(now() at time zone tz)::date;
 select coalesce(sum(typed_words),0) into written from public.writing_activity where user_id=new.user_id and (started_at at time zone tz)::date=day;
 prior:=case when tg_op='UPDATE' then old.daily_goal else 250 end;
 if exists(select 1 from public.writing_reward_goal_days g where g.user_id=new.user_id and g.reporting_date<>day and g.locked
 and tstzrange(g.reporting_date::timestamp at time zone g.timezone,(g.reporting_date+1)::timestamp at time zone g.timezone,'[)') && tstzrange(day::timestamp at time zone tz,(day+1)::timestamp at time zone tz,'[)')) then
 update public.writing_reward_goal_days g set target=greatest(g.target,new.daily_goal) where g.user_id=new.user_id and g.achieved_at is null and (now() at time zone g.timezone)::date=g.reporting_date;
 return new;end if;

 insert into public.writing_reward_goal_days(user_id,reporting_date,target,timezone,locked)
 values(new.user_id,day,case when written>0 then greatest(prior,new.daily_goal) else new.daily_goal end,tz,written>0)
 on conflict(user_id,reporting_date) do update set target=case when writing_reward_goal_days.achieved_at is not null then writing_reward_goal_days.target
 when writing_reward_goal_days.locked then greatest(writing_reward_goal_days.target,excluded.target) else excluded.target end;
 return new;
end $$;
drop trigger if exists writing_reward_capture_goal on public.writing_progress_preferences;
create trigger writing_reward_capture_goal after insert or update of daily_goal,timezone on public.writing_progress_preferences
 for each row execute function public.writing_reward_capture_goal();
create or replace function public.writing_reward_capture_document() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.completion_status='completed' and new.completed_at is not null then
 insert into public.writing_reward_document_completions(user_id,document_id,completed_at) values(new.user_id,new.id,new.completed_at) on conflict do nothing;
 end if;return new;
end $$;
drop trigger if exists writing_reward_capture_document on public.writing_documents;
create trigger writing_reward_capture_document after insert or update of completion_status on public.writing_documents
 for each row execute function public.writing_reward_capture_document();
insert into public.writing_reward_definitions(id,name,name_es,description,description_es,category,metric,threshold,tier,pro_only,sort_order) values
('words_100','First Words','Primeras palabras','Write 100 total qualifying words.','Escribe 100 palabras válidas en total.','words','words',100,'bronze',false,1),
('words_500','Finding Your Voice','Encuentra tu voz','Write 500 total qualifying words.','Escribe 500 palabras válidas en total.','words','words',500,'bronze',false,2),
('words_1000','Getting Started','El comienzo','Write 1,000 total qualifying words.','Escribe 1,000 palabras válidas en total.','words','words',1000,'silver',false,3),
('words_5000','Building Momentum','Crea impulso','Write 5,000 total qualifying words.','Escribe 5,000 palabras válidas en total.','words','words',5000,'silver',false,4),
('words_10000','Dedicated Writer','Constancia al escribir','Write 10,000 total qualifying words.','Escribe 10,000 palabras válidas en total.','words','words',10000,'gold',false,5),
('words_25000','Word Explorer','Explora las palabras','Write 25,000 total qualifying words.','Escribe 25,000 palabras válidas en total.','words','words',25000,'gold',false,6),
('words_50000','Story Builder','Construye historias','Write 50,000 total qualifying words.','Escribe 50,000 palabras válidas en total.','words','words',50000,'platinum',false,7),
('words_100000','Wordsmith','Artesanía de palabras','Write 100,000 total qualifying words.','Escribe 100,000 palabras válidas en total.','words','words',100000,'platinum',false,8),
('words_250000','Master Wordsmith','Maestría con palabras','Write 250,000 total qualifying words.','Escribe 250,000 palabras válidas en total.','words','words',250000,'diamond',false,9),
('words_1000000','The Million Word Journey','El viaje del millón de palabras','Write 1,000,000 total qualifying words.','Escribe 1,000,000 palabras válidas en total.','words','words',1000000,'diamond',false,10),
('streaks_1','First Step','Primer paso','Reach a 1-day qualifying writing streak.','Alcanza una racha de 1 día de escritura.','streaks','streak',1,'bronze',false,11),
('streaks_3','Three-Day Spark','Tres días de inspiración','Reach a 3-day qualifying writing streak.','Alcanza una racha de 3 días de escritura.','streaks','streak',3,'bronze',false,12),
('streaks_7','One Week Strong','Una semana de constancia','Reach a 7-day qualifying writing streak.','Alcanza una racha de 7 días de escritura.','streaks','streak',7,'silver',false,13),
('streaks_14','Two Weeks of Dedication','Dos semanas de dedicación','Reach a 14-day qualifying writing streak.','Alcanza una racha de 14 días de escritura.','streaks','streak',14,'silver',true,14),
('streaks_30','Habit Builder','Construye tu hábito','Reach a 30-day qualifying writing streak.','Alcanza una racha de 30 días de escritura.','streaks','streak',30,'gold',true,15),
('streaks_60','Consistency Champion','Celebra tu constancia','Reach a 60-day qualifying writing streak.','Alcanza una racha de 60 días de escritura.','streaks','streak',60,'gold',true,16),
('streaks_100','100 Days of Writing','100 días escribiendo','Reach a 100-day qualifying writing streak.','Alcanza una racha de 100 días de escritura.','streaks','streak',100,'platinum',true,17),
('streaks_180','Half-Year Writer','Medio año escribiendo','Reach a 180-day qualifying writing streak.','Alcanza una racha de 180 días de escritura.','streaks','streak',180,'platinum',true,18),
('streaks_365','A Year of Words','Un año de palabras','Reach a 365-day qualifying writing streak.','Alcanza una racha de 365 días de escritura.','streaks','streak',365,'diamond',true,19),
('goals_1','Goal Getter','Tu primera meta','Reach your saved daily goal on 1 distinct day.','Alcanza tu meta diaria registrada en 1 día.','goals','goals',1,'bronze',false,20),
('goals_5','Goal Chaser','Sigue tus metas','Reach your saved daily goal on 5 distinct days.','Alcanza tu meta diaria registrada en 5 días distintos.','goals','goals',5,'bronze',false,21),
('goals_10','Goal Crusher','Diez metas alcanzadas','Reach your saved daily goal on 10 distinct days.','Alcanza tu meta diaria registrada en 10 días distintos.','goals','goals',10,'silver',false,22),
('goals_25','Goal Champion','Celebra tus metas','Reach your saved daily goal on 25 distinct days.','Alcanza tu meta diaria registrada en 25 días distintos.','goals','goals',25,'gold',false,23),
('goals_50','Goal Master','Cincuenta metas','Reach your saved daily goal on 50 distinct days.','Alcanza tu meta diaria registrada en 50 días distintos.','goals','goals',50,'gold',false,24),
('goals_100','Century of Goals','Cien metas','Reach your saved daily goal on 100 distinct days.','Alcanza tu meta diaria registrada en 100 días distintos.','goals','goals',100,'platinum',false,25),
('goals_365','A Year of Progress','Un año de progreso','Reach your saved daily goal on 365 distinct days.','Alcanza tu meta diaria registrada en 365 días distintos.','goals','goals',365,'diamond',false,26),
('sessions_1','First Session','Primera sesión','Complete 1 distinct writing session with typed words.','Completa 1 sesión con palabras escritas.','sessions','sessions',1,'bronze',false,27),
('sessions_5','Finding Focus','Encuentra tu enfoque','Complete 5 distinct writing sessions with typed words.','Completa 5 sesiones distintas con palabras escritas.','sessions','sessions',5,'bronze',false,28),
('sessions_10','In the Zone','Tu espacio de concentración','Complete 10 distinct writing sessions with typed words.','Completa 10 sesiones distintas con palabras escritas.','sessions','sessions',10,'silver',false,29),
('sessions_25','Dedicated Sessions','Sesiones con dedicación','Complete 25 distinct writing sessions with typed words.','Completa 25 sesiones distintas con palabras escritas.','sessions','sessions',25,'gold',false,30),
('sessions_50','Writing Regular','Escribe con regularidad','Complete 50 distinct writing sessions with typed words.','Completa 50 sesiones distintas con palabras escritas.','sessions','sessions',50,'gold',false,31),
('sessions_100','Session Master','Cien sesiones','Complete 100 distinct writing sessions with typed words.','Completa 100 sesiones distintas con palabras escritas.','sessions','sessions',100,'platinum',false,32),
('sessions_250','Writing Veteran','Un camino de escritura','Complete 250 distinct writing sessions with typed words.','Completa 250 sesiones distintas con palabras escritas.','sessions','sessions',250,'diamond',false,33),
('time_1','First Hour','Primera hora','Accumulate 1 hour of active writing.','Acumula 1 hora de escritura activa.','time','seconds',3600,'bronze',false,34),
('time_5','Focused Writer','Escritura con enfoque','Accumulate 5 hours of active writing.','Acumula 5 horas de escritura activa.','time','seconds',18000,'bronze',false,35),
('time_10','Time Well Written','Tiempo bien escrito','Accumulate 10 hours of active writing.','Acumula 10 horas de escritura activa.','time','seconds',36000,'silver',false,36),
('time_25','Dedicated Creator','Creación con dedicación','Accumulate 25 hours of active writing.','Acumula 25 horas de escritura activa.','time','seconds',90000,'silver',false,37),
('time_50','Writing Enthusiast','Entusiasmo al escribir','Accumulate 50 hours of active writing.','Acumula 50 horas de escritura activa.','time','seconds',180000,'gold',false,38),
('time_100','Hundred-Hour Writer','Cien horas escribiendo','Accumulate 100 hours of active writing.','Acumula 100 horas de escritura activa.','time','seconds',360000,'gold',false,39),
('time_250','Writing Devotee','Tu práctica de escritura','Accumulate 250 hours of active writing.','Acumula 250 horas de escritura activa.','time','seconds',900000,'platinum',false,40),
('time_500','Master of the Craft','Cultiva tu oficio','Accumulate 500 hours of active writing.','Acumula 500 horas de escritura activa.','time','seconds',1800000,'platinum',false,41),
('time_1000','A Thousand Hours','Mil horas','Accumulate 1,000 hours of active writing.','Acumula 1,000 horas de escritura activa.','time','seconds',3600000,'diamond',false,42),
('documents_1','Finished My First','Mi primer documento terminado','Complete 1 distinct document. Reopening a document never counts twice.','Completa 1 documento distinto. Volver a completar uno no lo cuenta dos veces.','documents','documents',1,'bronze',true,43),
('documents_5','The Finisher','Termina tus proyectos','Complete 5 distinct documents. Reopening a document never counts twice.','Completa 5 documentos distintos. Volver a completar uno no lo cuenta dos veces.','documents','documents',5,'bronze',true,44),
('documents_10','Project Builder','Construye proyectos','Complete 10 distinct documents. Reopening a document never counts twice.','Completa 10 documentos distintos. Volver a completar uno no lo cuenta dos veces.','documents','documents',10,'silver',true,45),
('documents_25','Creative Finisher','Creatividad con final','Complete 25 distinct documents. Reopening a document never counts twice.','Completa 25 documentos distintos. Volver a completar uno no lo cuenta dos veces.','documents','documents',25,'gold',true,46),
('documents_50','Completion Champion','Celebra lo terminado','Complete 50 distinct documents. Reopening a document never counts twice.','Completa 50 documentos distintos. Volver a completar uno no lo cuenta dos veces.','documents','documents',50,'platinum',true,47),
('documents_100','A Library of Work','Una biblioteca propia','Complete 100 distinct documents. Reopening a document never counts twice.','Completa 100 documentos distintos. Volver a completar uno no lo cuenta dos veces.','documents','documents',100,'diamond',true,48),
('personal_best','A New Personal Best','Una nueva marca personal','Reach a new highest day in your recorded writing history.','Alcanza tu mejor día en el historial de escritura registrado.','growth','personal_best',1,'silver',false,49),
('finding_rhythm','Finding Your Rhythm','Encuentra tu ritmo','Write on more days in one completed month than the completed month before it.','Escribe más días en un mes completo que en el mes completo anterior.','growth','month_days',1,'silver',false,50),
('growing_practice','Growing Your Practice','Cultiva tu práctica','Complete more sessions in one completed month than in the completed month before it.','Completa más sesiones en un mes completo que en el mes completo anterior.','growth','month_sessions',1,'silver',false,51),
('new_chapter','A New Chapter','Un nuevo capítulo','Return after at least 14 days without recorded writing. Welcome back.','Regresa tras al menos 14 días sin escritura registrada. Te damos la bienvenida.','growth','return_days',14,'silver',false,52),
('steady_progress','Steady Progress','Progreso constante','Reach your personal goal during four distinct writing weeks.','Alcanza tu meta personal durante cuatro semanas distintas.','growth','goal_weeks',4,'silver',false,53)
on conflict(id) do nothing;

create or replace function public.writing_rewards(p_user uuid,p_paid boolean,p_language text default 'en')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prefs public.writing_reward_preferences; tz text; today date; days jsonb; metrics jsonb;
 words bigint; seconds bigint; sessions bigint; goals bigint; documents bigint; streak integer; actual integer;
 record_day record; definition public.writing_reward_definitions; metric_value bigint; achieved date; quiet boolean;
 current_month date; previous_month date; earlier_month date; coverage date; month_days bigint:=0; month_sessions bigint:=0;
 result jsonb; catalog jsonb; first_day date; goal_weeks bigint; return_days bigint; personal_best bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,788));
 insert into public.writing_reward_preferences(user_id) values(p_user) on conflict do nothing;
 select * into prefs from public.writing_reward_preferences where user_id=p_user for update;
 select coalesce(timezone,'UTC') into tz from public.writing_progress_preferences where user_id=p_user;tz:=coalesce(tz,'UTC');if p_language='auto' then select coalesce(language,'en') into p_language from public.writing_progress_preferences where user_id=p_user;p_language:=coalesce(p_language,'en');end if;today:=(now() at time zone tz)::date;
 select coalesce(jsonb_agg(to_jsonb(d) order by reporting_date),'[]') into days from public.writing_daily_activity(p_user,tz) d;
 select coalesce(sum(typed_words),0),min(reporting_date) filter(where typed_words>0) into words,first_day
 from jsonb_to_recordset(days) as d(reporting_date date,typed_words bigint);
 select coalesce(sum(upper(span)-lower(span)),0)/1000 into seconds from unnest(public.writing_account_time_ranges(p_user)) span;
 select count(*) into sessions from public.writing_activity where user_id=p_user and typed_words>0 and timer->>'status'='ended' and started_at<=now();
 -- Reconcile concurrent activity commits using the same captured target.
 update public.writing_reward_goal_days g set achieved_at=now() where g.user_id=p_user and g.locked and g.achieved_at is null and
 (select coalesce(sum(a.typed_words),0) from public.writing_activity a where a.user_id=p_user and (a.started_at at time zone g.timezone)::date=g.reporting_date and a.started_at<=now())>=g.target;
 select count(*),count(distinct date_trunc('week',reporting_date::timestamp)) into goals,goal_weeks from public.writing_reward_goal_days where user_id=p_user and achieved_at is not null;
 select count(*) into documents from public.writing_reward_document_completions where user_id=p_user;
 streak:=public.writing_historical_streak(p_user,tz);actual:=public.writing_actual_streak(p_user,tz);
 -- Personal bests refer explicitly to retained recorded history, never other writers.
 for record_day in
  with history as(select reporting_date,typed_words,max(typed_words) over(order by reporting_date rows between unbounded preceding and 1 preceding) prior
   from jsonb_to_recordset(days) d(reporting_date date,typed_words bigint) where typed_words>0)
  select * from history where prior>0 and typed_words>prior
 loop
  insert into public.writing_personal_milestones(user_id,kind,event_key,value,previous_best,occurred_on)
   values(p_user,'personal_best',record_day.reporting_date::text,record_day.typed_words,record_day.prior,record_day.reporting_date)
   on conflict(user_id,kind,event_key) do update set value=greatest(writing_personal_milestones.value,excluded.value);
 end loop;
 select count(*) into personal_best from public.writing_personal_milestones where user_id=p_user and kind='personal_best';
 select coalesce(max(gap),0) into return_days from (
  select reporting_date-lag(reporting_date) over(order by reporting_date)-1 gap
  from jsonb_to_recordset(days) d(reporting_date date,typed_words bigint) where typed_words>0) gaps;
 current_month:=date_trunc('month',today)::date;previous_month:=(current_month-interval '1 month')::date;earlier_month:=(current_month-interval '2 months')::date;
 coverage:=(prefs.observed_since at time zone tz)::date;
 select greatest(coverage,coalesce((cleared_before at time zone tz)::date,coverage)) into coverage from public.writing_progress_preferences where user_id=p_user;
 coverage:=coalesce(coverage,(prefs.observed_since at time zone tz)::date);
 -- Compare TWO COMPLETED months only after both periods have been observed.
 if coverage<=earlier_month then
  select greatest(0,count(*) filter(where reporting_date>=previous_month and reporting_date<current_month)-count(*) filter(where reporting_date>=earlier_month and reporting_date<previous_month)) into month_days
  from jsonb_to_recordset(days) d(reporting_date date,typed_words bigint) where typed_words>0;
  select greatest(0,count(*) filter(where (started_at at time zone tz)::date>=previous_month and (started_at at time zone tz)::date<current_month)-count(*) filter(where (started_at at time zone tz)::date>=earlier_month and (started_at at time zone tz)::date<previous_month)) into month_sessions
  from public.writing_activity where user_id=p_user and typed_words>0 and timer->>'status'='ended';
 end if;
 metrics:=jsonb_build_object('words',words,'seconds',seconds,'sessions',sessions,'goals',goals,'documents',documents,'streak',streak,
  'personal_best',personal_best,'return_days',return_days,'month_days',month_days,'month_sessions',month_sessions,'goal_weeks',goal_weeks);
 quiet:=prefs.evaluated_at is null or prefs.quiet_next or not prefs.enabled or not prefs.celebrations;
 -- Evaluate paid awards too, preserving eligibility for a later upgrade, but
 -- never expose paid definitions, values, awards or events in a Free response.
 for definition in select d.* from public.writing_reward_definitions d where d.active and not exists(select 1 from public.writing_user_rewards a where a.user_id=p_user and a.achievement_id=d.id) loop
  metric_value:=coalesce((metrics->>definition.metric)::bigint,0);
  if metric_value<definition.threshold then continue;end if;
  achieved:=today;
  if definition.metric in ('words','seconds') then
   select reporting_date into achieved from (
    select reporting_date,sum(case when definition.metric='words' then typed_words else duration_seconds end) over(order by reporting_date) total
    from jsonb_to_recordset(days) d(reporting_date date,typed_words bigint,duration_seconds bigint)) cumulative
    where total>=definition.threshold order by reporting_date limit 1;
  elsif definition.metric='streak' then
   select min(writing_day) into achieved from (
    select writing_day,row_number() over(partition by group_key order by writing_day) n from (
     select writing_day,writing_day-(row_number() over(order by writing_day))::integer group_key from (
      select distinct (started_at at time zone tz)::date writing_day from public.writing_activity where user_id=p_user and typed_words>0 and started_at<=now()) dates) islands) counts where n>=definition.threshold;
  elsif definition.metric='goals' then
   select reporting_date into achieved from public.writing_reward_goal_days where user_id=p_user and achieved_at is not null order by reporting_date offset (definition.threshold-1) limit 1;
  elsif definition.metric='documents' then
   select (completed_at at time zone tz)::date into achieved from public.writing_reward_document_completions where user_id=p_user order by completed_at,document_id offset (definition.threshold-1) limit 1;
  elsif definition.metric='sessions' then
   select (to_timestamp((timer->>'changed_at')::numeric/1000) at time zone tz)::date into achieved from public.writing_activity where user_id=p_user and typed_words>0 and timer->>'status'='ended' and started_at<=now() order by (timer->>'changed_at')::numeric,id offset (definition.threshold-1) limit 1;
  elsif definition.metric='personal_best' then
   select min(occurred_on) into achieved from public.writing_personal_milestones where user_id=p_user and kind='personal_best';
  elsif definition.metric in ('month_days','month_sessions') then achieved:=current_month-1;
  end if;
  insert into public.writing_user_rewards(user_id,achievement_id,achieved_on,awarded_requirement,notified_at)
  values(p_user,definition.id,coalesce(achieved,today),definition.threshold,case when quiet or (definition.pro_only and not p_paid) then now() else null end) on conflict do nothing;
 end loop;
 if quiet then update public.writing_user_rewards set notified_at=coalesce(notified_at,now()) where user_id=p_user;end if;
 update public.writing_reward_preferences set evaluated_at=now(),quiet_next=false where user_id=p_user;
 if not prefs.enabled then
 select coalesce(array_agg(selected.id),'{}') into prefs.showcase from unnest(prefs.showcase) selected(id) where exists(select 1 from public.writing_reward_definitions d where d.id=selected.id and (p_paid or(not d.pro_only and not(d.metric='streak' and d.threshold>7))));
 return jsonb_build_object('user_id',p_user,'preferences',to_jsonb(prefs)-array['last_celebrated_at','quiet_next','evaluated_at','observed_since'],'achievements','[]'::jsonb,'language',p_language,'enabled',false);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',case when p_language='es' then d.name_es else d.name end,
 'description',case when p_language='es' then d.description_es else d.description end,'category',d.category,'metric',d.metric,'tier',d.tier,'badge_image',d.badge_image,
 'requirement',coalesce(a.awarded_requirement,d.threshold),'progress',case when d.metric='streak' then case when p_paid then actual else least(actual,7) end else coalesce((metrics->>d.metric)::bigint,0) end,
 'unlocked',a.achievement_id is not null,'earned_on',a.achieved_on,'awarded_at',a.awarded_at,'active',d.active) order by d.sort_order),'[]') into catalog
 from public.writing_reward_definitions d left join public.writing_user_rewards a on a.achievement_id=d.id and a.user_id=p_user
 where (d.active or a.achievement_id is not null) and (p_paid or (not d.pro_only and not(d.metric='streak' and d.threshold>7)));
 select coalesce(array_agg(id),'{}') into prefs.showcase from unnest(prefs.showcase) id where exists(select 1 from jsonb_array_elements(catalog) a where a->>'id'=id and (a->>'unlocked')::boolean);
 result:=jsonb_build_object('user_id',p_user,'enabled',true,'language',p_language,'timezone',tz,
 'preferences',to_jsonb(prefs)-array['last_celebrated_at','quiet_next','evaluated_at','observed_since'],
 'achievements',catalog,'totals',jsonb_build_object('words',words,'sessions',sessions,'seconds',seconds,'goals',goals,'streak',case when p_paid then actual else least(actual,7) end),
 'journey',jsonb_build_object('first_writing_day',first_day,'first_goal_day',(select min(reporting_date) from public.writing_reward_goal_days where user_id=p_user and achieved_at is not null),
 'first_document_day',case when p_paid then (select min((completed_at at time zone tz)::date) from public.writing_reward_document_completions where user_id=p_user) else null end),
 'personal_milestones',(select coalesce(jsonb_agg(to_jsonb(m)-array['user_id','event_key']),'[]') from (select kind,value,previous_best,occurred_on from public.writing_personal_milestones where user_id=p_user order by occurred_on desc limit 50) m),
 'history_notes',jsonb_build_object('goals_from_captured_targets_only',true,'monthly_comparisons_require_two_observed_complete_months',true),'updated_at',now());
 return result;
end $$;

create or replace function public.writing_reward_settings(p_user uuid,p_revision bigint,p_patch jsonb,p_paid boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prefs public.writing_reward_preferences; item text; ids text[];
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,788));
 insert into public.writing_reward_preferences(user_id) values(p_user) on conflict do nothing;
 select * into prefs from public.writing_reward_preferences where user_id=p_user for update;
 if prefs.revision<>p_revision then return jsonb_build_object('conflict',true);end if;
 if p_patch ? 'showcase' then
  select coalesce(array_agg(distinct value),'{}') into ids from jsonb_array_elements_text(p_patch->'showcase');
  if cardinality(ids)>3 then raise exception 'invalid_showcase' using errcode='22023';end if;
  foreach item in array ids loop
   if not exists(select 1 from public.writing_user_rewards a join public.writing_reward_definitions d on d.id=a.achievement_id
    where a.user_id=p_user and a.achievement_id=item and (p_paid or (not d.pro_only and not(d.metric='streak' and d.threshold>7)))) then
    raise exception 'invalid_showcase' using errcode='22023';end if;
  end loop;
 end if;
 update public.writing_reward_preferences set enabled=coalesce((p_patch->>'enabled')::boolean,enabled),
 celebrations=coalesce((p_patch->>'celebrations')::boolean,celebrations),widget=coalesce((p_patch->>'widget')::boolean,widget),
 showcase=case when p_patch ? 'showcase' then ids else showcase end,revision=revision+1,
 quiet_next=quiet_next or (not enabled and coalesce((p_patch->>'enabled')::boolean,false))
 where user_id=p_user;
 -- Turning off/re-enabling never replays an old queue across any device.
 update public.writing_user_rewards set notified_at=coalesce(notified_at,now()) where user_id=p_user;
 return jsonb_build_object('updated',true);
end $$;
create or replace function public.writing_reward_claim(p_user uuid,p_paid boolean)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare picked text; prefs public.writing_reward_preferences;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,788));
 select * into prefs from public.writing_reward_preferences where user_id=p_user for update;
 if not found or not prefs.enabled or not prefs.celebrations or prefs.last_celebrated_at>now()-interval '5 minutes' then return null;end if;
 if exists(select 1 from public.writing_activity where user_id=p_user and timer->>'status'='active' and updated_at>now()-interval '90 seconds') then return null;end if;
 select a.achievement_id into picked from public.writing_user_rewards a join public.writing_reward_definitions d on d.id=a.achievement_id
 where a.user_id=p_user and a.notified_at is null and d.active and (p_paid or(not d.pro_only and not(d.metric='streak' and d.threshold>7)))
 order by a.awarded_at desc,d.sort_order desc limit 1 for update of a skip locked;
 if picked is not null then
  update public.writing_user_rewards set notified_at=coalesce(notified_at,now()) where user_id=p_user;
  update public.writing_reward_preferences set last_celebrated_at=now() where user_id=p_user;
 end if;return picked;
end $$;
-- No client can award badges, submit totals, select a paid flag, or invoke these
-- functions through raw REST. The API binds p_user and p_paid to verified auth.
do $$ declare f regprocedure; t text;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
 ('writing_rewards','writing_reward_settings','writing_reward_claim','writing_reward_capture_activity','writing_reward_capture_goal','writing_reward_capture_document') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
 for t in select unnest(array['writing_reward_definitions','writing_reward_preferences','writing_user_rewards','writing_personal_milestones','writing_reward_goal_days','writing_reward_document_completions']) loop
 execute format('alter table public.%I force row level security',t);
 end loop;
end $$;
create or replace function public.writing_reward_admin_catalog() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('unlock_count',(select count(*) from public.writing_user_rewards a where a.achievement_id=d.id)) order by d.sort_order),'[]') from public.writing_reward_definitions d;
$$;
create or replace function public.writing_reward_admin_update(p_id text,p_revision integer,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.writing_reward_definitions;
begin
 update public.writing_reward_definitions set name=coalesce(p_patch->>'name',name),name_es=coalesce(p_patch->>'name_es',name_es),
 description=coalesce(p_patch->>'description',description),description_es=coalesce(p_patch->>'description_es',description_es),
 threshold=coalesce((p_patch->>'threshold')::bigint,threshold),active=coalesce((p_patch->>'active')::boolean,active),
 badge_image=case when p_patch ? 'badge_image' then p_patch->>'badge_image' else badge_image end,revision=revision+1,updated_at=now()
 where id=p_id and revision=p_revision returning * into result;
 if not found then return null;end if;
 return to_jsonb(result);
end $$;
revoke all on function public.writing_reward_admin_catalog(),public.writing_reward_admin_update(text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.writing_reward_admin_catalog(),public.writing_reward_admin_update(text,integer,jsonb) to service_role;
-- Bounded, resumable launch backfill. It never runs as part of a writer's save.
create or replace function public.writing_reward_backfill(p_after uuid default null,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid; last_id uuid:=p_after; processed integer:=0;
begin
 for owner in select id from auth.users where p_after is null or id>p_after order by id limit least(50,greatest(1,p_limit)) loop
  perform public.writing_rewards(owner,false,'auto');last_id:=owner;processed:=processed+1;
 end loop;
 return jsonb_build_object('processed',processed,'next_cursor',last_id,'has_more',exists(select 1 from auth.users where last_id is null or id>last_id));
end $$;
revoke all on function public.writing_reward_backfill(uuid,integer) from public,anon,authenticated;
grant execute on function public.writing_reward_backfill(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
