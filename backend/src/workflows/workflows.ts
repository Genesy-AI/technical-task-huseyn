import { proxyActivities } from '@temporalio/workflow'
import type * as activities from './activities'

// Temporal's default retry policy retries forever. Cap it so a slow or failing
// verification surfaces as a failure instead of hanging the workflow.
const { verifyEmail } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 second',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
})

export async function verifyEmailWorkflow(email: string): Promise<boolean> {
  return await verifyEmail(email)
}
