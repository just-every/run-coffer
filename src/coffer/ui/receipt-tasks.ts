import { receiptTasks } from '../receipt-tasks'
import type { Context } from '../db'
import { area, box, e, form, when } from './common'

export async function receiptTasksPanel(c: Context, timezone: string, donorId?: string) {
 const tasks=await receiptTasks(c,donorId)
 if(!tasks.length)return ''
 return box('Receipt address follow-up',`<ul class="list">${tasks.map(t=>`<li><strong>${t.completed_at?'Address task completed':'Fix email address'}</strong> · <a href="/app/donors/${e(t.donor_id)}">${e(t.donor_name)}</a><p>The provider reported a bounce. Check the donor’s current email before future mail. This document is available to print.</p><p><a href="/app/letters/${e(t.batch_id)}/print?letter=${e(t.letter_id)}">Print this document</a> · <a href="/app/letters/${e(t.batch_id)}">Delivery details</a></p>${t.completed_at?`<p>${when(t.completed_at,timezone)} · ${e(t.resolution)}</p>`:form('receiptTask.complete',area('How the address was checked','resolution','','required maxlength="1000"'),'Complete address task',{taskId:t.id,version:t.version,returnDonorId:t.donor_id})}</li>`).join('')}</ul>`)
}
