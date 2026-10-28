import type { SourceDefinition } from './source-definitions'
import type { CustomImportMapping } from './types'
export type SourceRecord = {sourceObject?:'action'|'activity'|'note';kind:'constituent'|'gift'|'interaction'|'note';externalId:string;donorExternalId:string}
export type FieldMapping = {id:string;action:'field'|'tags'|'skip';field?:CustomImportMapping}
export type ValueResolution = {id:string;action:'fix'|'map'|'skip';value?:unknown}
export type ReviewValue = {id:string;fieldId:string;recordId:string;original:unknown;value?:string;reason?:string;state:'ready'|'waiting'|'skipped'}
export type CustomReview = {version:number;applied?:number;definitions:SourceDefinition[];mappings:FieldMapping[];resolutions:ValueResolution[];values:ReviewValue[];counts:{id:string;name:string;defined:number;source:number;carried:number;waiting:number;skipped:number}[]}
