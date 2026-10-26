import { e, money } from '../ui/common'
import type { Row } from '../db'
import type { ReportMetric } from './development-report-sources'

export function metricValue(metric:ReportMetric) {
 if(metric.value===null)return 'Not recorded'
 if(metric.format==='money')return money(metric.value)
 if(metric.format==='percent')return (metric.value*100).toFixed(1)+'%'
 if(metric.format==='days')return metric.value.toLocaleString('en-US')+' days'
 return metric.value.toLocaleString('en-US')
}
export function developmentReportDocument(r:Row,origin='') {
 const sources=JSON.parse(r.sources),notes=JSON.parse(r.notes)
 const href=(path:string)=>origin?new URL(path,origin).href:path
 const periodHref=href('/app/agent/reports?month='+sources.month+'&sources=1')
 return `<article class="development-report"><h2><a href="${e(periodHref)}">${e(r.subject)}</a></h2><p><a href="${e(periodHref)}">Reporting month: ${e(sources.month)}. Received-money period: ${e(sources.period.from)} to ${e(sources.period.through)}. Sources checked ${e(sources.period.asOf)} in ${e(sources.period.timezone)}.</a></p>
 ${r.introduction?`<p>${e(r.introduction)}</p>`:''}${sources.sections.map((section:Row)=>`<section id="report-${e(section.key)}"><h3>${e(section.title)}</h3><p>${section.metrics.length?`<a href="${e(href(section.metrics[0].source.href))}">${e(section.explanation)}</a>`:e(section.explanation)}</p>
 ${notes[section.key]?`<p>${e(notes[section.key])}</p>`:''}${section.metrics.length?`<dl>${section.metrics.map((metric:ReportMetric)=>`<dt>${e(metric.label)}</dt><dd><a href="${e(href(metric.source.href))}" data-source-api="${e(metric.source.api)}" data-source-pointer="${e(metric.source.pointer)}">${e(metricValue(metric))}</a></dd>`).join('')}</dl>`:'<p>No positive received gifts in this selection.</p>'}</section>`).join('')}
 <p>Source links require the reader’s usual authorized sign-in. Submission to a mail provider is separate from confirmed delivery.</p></article>`
}
export function developmentReportText(r:Row,origin:string) {
 const sources=JSON.parse(r.sources),notes=JSON.parse(r.notes)
 return [r.subject,`Reporting month: ${sources.month}. Received-money period: ${sources.period.from} to ${sources.period.through}. Sources checked ${sources.period.asOf} (${sources.period.timezone}).`,r.introduction,
  ...sources.sections.flatMap((section:Row)=>[section.title,section.explanation,notes[section.key]??'',...section.metrics.map((metric:ReportMetric)=>`${metric.label}: ${metricValue(metric)} — ${new URL(metric.source.href,origin).href}`)]),
  'Source links require your usual authorized sign-in. Mail provider acceptance does not confirm delivery.',
 ].filter(Boolean).join('\n\n')
}
