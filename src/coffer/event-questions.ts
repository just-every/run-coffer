import { customValue } from './custom-fields'
import { all, commit, event, fail, guard, id, newId, one, sql, text, type Context, type Row } from './db'

export async function eventQuestions(c:{db:D1Database},eventId:string):Promise<Row[]> {
 return all(c,`SELECT q.id,q.field_key,q.label,q.required,f.kind,f.type,f.entry,f.choices,f.version
 FROM cf_event_questions q JOIN cf_custom_fields f ON f.key=q.field_key WHERE q.event_id=? ORDER BY q.created_at,q.id`,eventId)
}

export async function defineEventQuestion(c:Context,p:Row) {
 const eventId=id(p.eventId,'Event'),fieldKey=text(p.fieldKey,'Custom field',80),label=text(p.label,'Question',200)
 const field=await one(c,"SELECT * FROM cf_custom_fields WHERE key=? AND kind='constituent'",fieldKey)
 if(!field)fail('INPUT','Choose a defined constituent custom field.',400)
 if(![true,false,'yes','no',undefined].includes(p.required))fail('INPUT','Choose whether an answer is required.',400)
 const questionId=newId(),required=p.required===true||p.required==='yes'?1:0
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_fundraising_events WHERE id=?)','EVENT','Choose an event.',eventId),
  guard("EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND kind='constituent' AND version=?)",'VERSION','The custom field changed. Review the question again.',fieldKey,field.version),
  guard('NOT EXISTS(SELECT 1 FROM cf_event_questions WHERE event_id=? AND field_key=?)','QUESTION_EXISTS','That custom field already has a question.',eventId,fieldKey),
  sql('INSERT INTO cf_event_questions VALUES(?,?,?,?,?,?)',questionId,eventId,fieldKey,label,required,c.now),event(c,'event.question','eventQuestion',questionId,null,{eventId,fieldKey,required})])
 return {id:questionId,eventId}
}

/** Save native typed values while keeping the question definitions quoted at checkout. */
export function eventAnswers(questions:Row[],input:unknown):Row {
 let values=input
 if(typeof values==='string'){try{values=JSON.parse(values)}catch{fail('INPUT','Answers must be a JSON object.',400)}}
 if(values===undefined||values===null)values={}
 if(!values||typeof values!=='object'||Array.isArray(values))fail('INPUT','Answers must be an object.',400)
 const source=values as Row,answers:Row={}
 if(Object.keys(source).some(key=>!questions.some(q=>q.field_key===key)))fail('INPUT','An answer does not belong to this event.',400)
 for(const q of questions){
  const value=source[q.field_key]
  if(value===undefined||value===null||value===''||Array.isArray(value)&&!value.length){if(q.required)fail('INPUT','Answer '+q.label+'.',400);continue}
  answers[q.field_key]=JSON.parse(customValue(q,value))
 }
 return answers
}
