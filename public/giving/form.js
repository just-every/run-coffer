const form = document.querySelector('.donation form')
for (const button of document.querySelectorAll('[data-gift-amount]')) {
 button.addEventListener('click', () => {
  form.elements.amount.value = (Number(button.dataset.giftAmount) / 100).toFixed(2)
  form.elements.amount.dispatchEvent(new Event('input', {bubbles: true}))
  form.elements.amount.focus()
 })
}
if (window.parent !== window) {
 const notify = () => parent.postMessage({type: 'coffer-form-height', height: document.documentElement.scrollHeight}, '*')
 new ResizeObserver(notify).observe(document.body)
 window.addEventListener('load', notify)
 notify()
}
