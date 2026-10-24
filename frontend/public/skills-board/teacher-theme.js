// Presentation only. The administrator's map and all permissions stay unchanged.
if (new URLSearchParams(window.location.search).get('theme') === 'teacher') {
  document.documentElement.dataset.theme = 'teacher';
  document.addEventListener('DOMContentLoaded', () => {
    const brand = document.querySelector('.brand-icon');
    if (!brand) return;
    const logo = document.createElement('img');
    logo.src = '/brand/Mindcrafti_Logo_M_OFFICIAL.webp';
    logo.alt = 'Mindcrafti School';
    brand.replaceChildren(logo);
  });
}
