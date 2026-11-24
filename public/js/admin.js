// Ask before destructive admin actions (forms with data-confirm).
document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
