"""Compare capture.sql JSON snapshots without resetting production statistics."""
import json,sys
from datetime import datetime

def read(path):
    value=json.load(open(path))
    if isinstance(value,list): value=value[0]
    return value.get('snapshot',value.get('baseline',value))

a,b=map(read,sys.argv[1:3])
assert a['stats_reset']==b['stats_reset'],'Statistics were reset: use a new baseline.'
seconds=(datetime.fromisoformat(b['captured_at'])-datetime.fromisoformat(a['captured_at'])).total_seconds()
assert seconds>0
result={'windowSeconds':seconds,'productionCpuPercent':'Requires Supabase host metrics; SQL duration is not CPU utilization.'}
for key in ['xact_commit','xact_rollback','blks_hit','blks_read','temp_bytes','deadlocks']:
    if key not in a['database'] or key not in b['database']:
        result[key]='Not captured in these snapshots'
        continue
    delta=b['database'][key]-a['database'][key]
    assert delta>=0,f'{key} reset: use a new baseline'
    result[key]={'delta':delta,'perSecond':round(delta/seconds,4)}
result['databaseGrowthBytes']=(b['database_bytes']-a['database_bytes']) if 'database_bytes' in a and 'database_bytes' in b else 'Not captured in these snapshots'
print(json.dumps(result,indent=2))
