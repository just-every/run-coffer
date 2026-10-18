import { choice } from './db'

// Closed reasons keep personal data out of the financial audit retained after
// erasure. Store the readable explanation, not merely an operation name.
export const reassignmentReasons = {
 merge: [['duplicate_record', 'Duplicate records for the same donor']],
 undo: [['incorrect_match', 'The records belong to different donors'], ['restore_separate_records', 'Restore the donor records kept separately']],
 erase: [['donor_request', 'The donor requested erasure'], ['retention_policy', 'The retention policy requires erasure'], ['legal_requirement', 'A legal requirement requires erasure']],
} satisfies Record<string, [string, string][]>

export function reassignmentReason(operation: keyof typeof reassignmentReasons, value: unknown): string {
 const options = reassignmentReasons[operation]
 const code = choice(value, options.map(([code]) => code), 'a reason')
 return options.find(([key]) => key === code)![1]
}
