import { operatorAuthPeople } from '../../modules/agent-door/index.ts'
import { operatorAuth, authConfig, type Bindings } from '../../auth.server'
export const people = (env: Bindings) => operatorAuthPeople({db:env.DB,allowList:authConfig(env).allowList,session:request=>operatorAuth(env).getSession(request)})
