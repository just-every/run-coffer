const form = document.querySelector('[data-giving-form-settings]')
if (form) {
 const status = form.querySelector('[data-form-status]')
 let pending = false, saving = false
 async function save() {
  pending = true
  if (saving) return
  saving = true
  while (pending) {
   pending = false
   if (!form.reportValidity()) break
   status.textContent = 'Saving…'
   try {
    const response = await fetch(form.action, {method: 'POST', headers: {'accept': 'application/json'}, body: new URLSearchParams(new FormData(form))})
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'The form could not be saved.')
    form.elements.version.value = result.version
    status.textContent = 'Saved'
   } catch (error) {
    status.textContent = error.message + ' Your changes are still here. Change a field to try again.'
    pending = false
   }
  }
  saving = false
 }
 form.addEventListener('change', save)
 form.addEventListener('submit', event => {event.preventDefault(); save()})
}
