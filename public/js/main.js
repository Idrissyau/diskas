// Diskas main.js — all JS for the public-facing site

// ── Vote handler (post detail page) ───────────────────────────────────────
document.querySelectorAll('.vote-group').forEach(group => {
  group.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id   = group.dataset.id;
      const type = group.dataset.type;
      const vote = btn.dataset.vote;

      try {
        const res = await fetch('/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, type, value: vote }),
        });
        if (res.status === 401) { window.location = '/auth/login'; return; }
        const data = await res.json();
        if (data.success) {
          const totalEl = group.querySelector('.vote-total');
          if (totalEl) totalEl.textContent = data.total;
          // Toggle voted class
          group.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('voted'));
          btn.classList.add('voted');
        }
      } catch (e) { /* ignore network errors */ }
    });
  });
});
