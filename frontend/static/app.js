// ---------- Carregador de seções (pages/*.html) ----------
const content = document.getElementById('content');
const navItems = document.querySelectorAll('.nav-item');

// JS específico de cada seção, executado após injetar o HTML dela
const initPage = {
  upload() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const handleFile = (file) => file && alert(`Arquivo selecionado: ${file.name}`);

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { handleFile(fileInput.files[0]); fileInput.value = ''; });

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFile(e.dataTransfer.files[0]);
    });
  },
  historico() {},
  configuracoes() {},
};

async function loadPage(page) {
  const res = await fetch(`pages/${page}.html`);
  content.innerHTML = await res.text();

  navItems.forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  document.body.classList.remove('drawer-open');
  initPage[page]?.();
}

navItems.forEach((item) => item.addEventListener('click', () => loadPage(item.dataset.page)));
loadPage('upload'); // seção inicial

// ---------- Navigation drawer ----------
document.getElementById('drawer-btn').addEventListener('click', () => document.body.classList.add('drawer-open'));
document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('drawer-open'));

// ---------- Switch de tema (dark é o padrão; salvo no localStorage) ----------
const themeIcon = document.getElementById('theme-icon');

function setTheme(light) {
  document.body.classList.toggle('light', light);
  themeIcon.textContent = light ? 'dark_mode' : 'light_mode';
  localStorage.setItem('theme', light ? 'light' : 'dark');
}

document.getElementById('theme-btn').addEventListener('click', () =>
  setTheme(!document.body.classList.contains('light')));

setTheme(localStorage.getItem('theme') === 'light');

// ---------- Menu do perfil ----------
const profileMenu = document.getElementById('profile-menu');
document.getElementById('profile-btn').addEventListener('click', () => profileMenu.open = !profileMenu.open);
