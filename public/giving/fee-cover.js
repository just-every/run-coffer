// The server recomputes this estimate and refuses changed totals before Stripe.
const summary = document.getElementById('fee-cover-total')
if (summary) {
 const form = summary.closest('form'), amount = form.elements.amount, cover = form.elements.feeCover
 const quoted = form.elements.quotedAmountCents, button = form.querySelector('button.checkout')
 const unavailable = button.disabled
 const usd = cents => '$' + (Number(cents) / 100).toFixed(2)
 function update() {
  if (!/^[0-9]+([.][0-9]{1,2})?$/.test(amount.value)) {
   summary.textContent = 'Enter a valid gift amount to see the total.'; quoted.value = ''; button.disabled = true; return
  }
  const [whole, fraction = ''] = amount.value.split('.'), base = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  const denominator = 10000n - BigInt(summary.dataset.rate), numerator = (base + BigInt(summary.dataset.fixed)) * 10000n
  const total = cover.checked ? (numerator + denominator - 1n) / denominator : base
  const valid = base >= 100n && base <= 10000000n && total <= BigInt(Number.MAX_SAFE_INTEGER)
  quoted.value = valid ? String(total) : ''
  summary.textContent = valid ? `Estimated fee cover: ${usd(total - base)}. Total charged: ${usd(total)}${form.elements.frequency.value === 'monthly' ? ' each month until cancelled' : ''}. Your receipt includes the full amount paid. Actual Stripe fees may differ.` : 'Enter a gift between $1 and $100,000 to see the total.'
  button.disabled = unavailable || !valid
 }
 form.addEventListener('input', update); form.addEventListener('change', update); update()
}
