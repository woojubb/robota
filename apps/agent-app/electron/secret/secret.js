const form = document.getElementById('secret-form');
const type = document.getElementById('secret-type');
const value = document.getElementById('secret-value');
const cancel = document.getElementById('cancel');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const credential = value.value;
  value.value = '';
  window.desktopSecret.submit(type.value, credential);
});
cancel.addEventListener('click', () => {
  value.value = '';
  window.desktopSecret.cancel();
});
