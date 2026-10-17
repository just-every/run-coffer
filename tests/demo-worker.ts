// The test Worker under Base's demo mode, seeded as `rer demo` and the hosted demo are.
import { withDemo } from '../src/modules/demo/index.mjs'
import worker from './worker'
import { seedDemo } from '../src/demo'
export default withDemo(worker, { seed: seedDemo })
