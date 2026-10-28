import type { Context, Row } from '../db'
import { connectionCommand } from './connection'
import { mailboxSync } from './store'
import { preparePersonalMail, submitPersonalMail } from './sending'

export async function mailboxCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(command==='mailbox.sync')return mailboxSync(c,p)
 if(command==='mailbox.prepare')return preparePersonalMail(c,p)
 if(command==='mailbox.submit')return submitPersonalMail(c,p)
 return connectionCommand(c,command,p)
}
