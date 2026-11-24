(function () {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.mainnav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  const first = '/' + (location.pathname.split('/')[1] || '');
  document.querySelectorAll('.nav-links a').forEach((a) => {
    if (a.getAttribute('href') === first) a.classList.add('active');
  });

  const params = new URLSearchParams(location.search);
  const msg = document.getElementById('subscribe-msg');
  if (msg && params.has('subscribed')) {
    msg.textContent = params.get('subscribed') === '1' ? 'Thanks for subscribing!' : 'Please enter a valid email address.';
  }

  const sub = document.getElementById('subscribe-form');
  if (sub) {
    sub.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = sub.querySelector('button');
      btn.disabled = true;
      try {
        const res = await fetch('/subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: sub.email.value }),
        });
        const data = await res.json().catch(() => ({}));
        msg.textContent = res.ok ? 'Thanks for subscribing! You will get new job alerts by email.' : data.error || 'Something went wrong.';
        if (res.ok) sub.reset();
      } catch {
        msg.textContent = 'Network error. Please try again.';
      } finally {
        btn.disabled = false;
      }
    });
  }
})();
