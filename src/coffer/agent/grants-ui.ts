import { automationGrants } from '../automation-grants'
import type { Context } from '../db'
import { area, box, e, field, hidden, select } from '../ui/common'

export async function automationGrantPanel(c:Context) {
 const grants=await automationGrants(c)
 return box('Background agent grants','<p>These named grants cover existing scheduled reconciliation, missing-receipt preparation, payment notices and meeting readiness. They add no new sending permission. Stopping a grant or the global agent switch stops its next action; existing Stripe payment retries continue at Stripe.</p>'+grants.map(g=>`<details><summary>${e(g.name)} · ${g.enabled?'Enabled':'Stopped'}</summary><p>Allowed actions: ${e(JSON.parse(g.commands).join(', '))}</p><form method="post" action="/app/agent/grants">${hidden('id',g.id)}${hidden('version',g.version)}${select('Background grant status','enabled',[['yes','Enabled'],['no','Stopped']],g.enabled?'yes':'no')}${select('Record scope','scope',g.id==='reconciliation'?[['all','Complete ledger']]:[['all','All current records'],['selected','Only selected donors']],g.donor_ids?'selected':'all')}${area('Donor identifiers','donorIds',g.donor_ids?JSON.parse(g.donor_ids).join('\n'):'')}${field('Daily action limit','dailyLimit','number',g.daily_limit,'required min="1" max="10000"')}<button>Save background grant</button></form></details>`).join(''),'background-grants')
}
