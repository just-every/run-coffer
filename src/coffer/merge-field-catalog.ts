export const RECOGNITION_MERGE_FIELDS = ['recognition_name']
export const GIFT_DETAIL_MERGE_FIELDS = ['campaign', 'appeal', 'tribute_name']
/** Currency fields describe the recipient's own monetary ledger, never a
 * valuation of donated property or another constituent's giving. */
export const GIVING_MERGE_FIELDS = ['total_given','gift_count','first_gift_amount','first_gift_date','last_gift_amount','last_gift_date','largest_gift_amount','largest_gift_date','consecutive_giving_years','current_fiscal_year_given','previous_fiscal_year_given','open_pledge_balance','soft_credit_total','recurring_plan_count']


export const PLEDGE_CONTEXT_FIELDS=['installment_amount','due_date','pledged_amount','pledge_balance','installment_number','pledge_date']
export const PLEDGE_REQUIRED=['donor_name','installment_amount','due_date','fund','organization']

/** Counts and dates assign no monetary value to donated property. */
export const GIVING_DESCRIPTIVE_FIELDS=['gift_count','first_gift_date','last_gift_date','largest_gift_date','consecutive_giving_years','recurring_plan_count']
