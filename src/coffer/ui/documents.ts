import { documentState } from '../documents'
import { type Context } from '../db'
import { box, e, empty, field, hidden, select } from './common'

export async function documentsPanel(c: Context, donorId: string): Promise<string> {
 if (!['owner', 'admin', 'member'].includes(c.actor.role)) return ''
 const state = await documentState(c, donorId)
 const documents = state.documents.length ? `<ul class="list">${state.documents.map(d => {
  const path = `/api/coffer/documents/${encodeURIComponent(d.id)}`
  const target = state.targets.find(t => t.value === `${d.record_kind}:${d.record_id}`)
  return `<li><a href="${e(path)}/preview">${e(d.title)}</a><br><span class="muted">${e(d.file_name)}${target ? ` · ${e(target.label)}` : ''}</span> · <a href="${e(path)}/download">Download</a></li>`
 }).join('')}</ul>` : empty('No documents attached.')
 const upload = state.targets.length ? `<form method="post" action="/app/documents" enctype="multipart/form-data">${hidden('donorId', donorId)}${select('Attach to', 'recordRef', state.targets.map(t => [t.value, t.label] as [string, string]), `donor:${donorId}`, 'required')}${field('Document title', 'title', 'text', '', 'required maxlength="200"')}<label>Document (PDF, plain text, PNG or JPEG; up to 256,000 bytes)<input type="file" name="attachment" accept="application/pdf,text/plain,image/png,image/jpeg" required></label><button>Upload document</button></form>` : empty('No records are available for attaching documents.')
 return box('Documents', documents + upload, 'documents')
}
