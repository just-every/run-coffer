import { e, money } from '../ui/common'
import type { Row } from '../db'

export function givingQuestion(q: Row) {
 const name = 'answer.' + q.key, required = q.required ? ' required' : ''
 const label = e(q.label) + (q.required ? '' : ' (optional)')
 const choices: unknown[] = typeof q.choices === 'string' ? JSON.parse(q.choices) : q.choices
 if (q.entry === 'pick-many') return `<fieldset class="form-question"><legend>${label}</legend>${choices.map((v, i) => `<label class="consent"><input type="checkbox" name="${e(name)}" value="${e(v)}"><span>${e(v)}</span></label>`).join('')}${q.required ? '<p class="availability">Choose at least one answer.</p>' : ''}</fieldset>`
 if (q.entry === 'pick-one') return `<label class="field"><span>${label}</span><select name="${e(name)}" aria-label="${label}"${required}><option value="">Choose an answer</option>${choices.map(v => `<option value="${e(v)}">${e(v)}</option>`).join('')}</select></label>`
 if (q.type === 'checkbox') return `<label class="field"><span>${label}</span><select name="${e(name)}" aria-label="${label}"${required}><option value="">Choose an answer</option><option value="true">Yes</option><option value="false">No</option></select></label>`
 const type = q.type === 'date' ? 'date' : ['number', 'currency', 'year'].includes(q.type) ? 'number' : 'text'
 const numeric = q.type === 'currency' ? ' step="0.01"' : q.type === 'number' ? ' step="any"' : q.type === 'year' ? ' min="1000" max="9999" step="1"' : ''
 return `<label class="field"><span>${label}</span><input name="${e(name)}" type="${type}"${numeric}${required} maxlength="2000"></label>`
}

export function givingFormFields(config: Row) {
 return `<input type="hidden" name="formVersion" value="${config.version}">${config.designations.length > 1 ? `<label class="field"><span>Designation</span><select name="designation" aria-label="Designation">${config.designations.map((fund: string) => `<option value="${e(fund)}">${e(fund)}</option>`).join('')}</select></label>` : `<input type="hidden" name="designation" value="${e(config.designations[0])}">`}${config.employerEnabled ? '<label class="field"><span>Employer (optional)</span><input name="employer" maxlength="200"></label>' : ''}${config.commentEnabled ? '<label class="field"><span>Comment (optional)</span><textarea name="comment" maxlength="2000" rows="3"></textarea></label>' : ''}${config.questions.map(givingQuestion).join('')}`
}

export function suggestedAmounts(config: Row) {
 return `<fieldset class="suggested-amounts"><legend>Suggested gift amounts</legend><div>${config.suggestedAmountsCents.map((n: number) => `<button type="button" data-gift-amount="${n}">${money(n)}</button>`).join('')}</div></fieldset>`
}

export function givingBrandStyle(config: Row) {
 // Every interpolated value is a validated six-digit hexadecimal color.
 return `.configured-form{--form-primary:${config.primaryColor};background:${config.backgroundColor};color:${config.textColor}}.configured-form header,.configured-form h1,.configured-form .description,.configured-form .eyebrow{color:${config.textColor}}.configured-form .scene{display:none}.configured-form .checkout{background:${config.primaryColor}}.configured-form .intro{align-self:start}.configured-form header img{object-fit:contain;width:72px;height:56px}.configured-form .checkout:focus-visible{outline-color:${config.textColor}}`
}
