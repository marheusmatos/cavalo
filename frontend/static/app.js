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

// Navigation drawer
document.getElementById('drawer-btn').addEventListener('click', () => document.body.classList.add('drawer-open'));
document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('drawer-open'));

// Switch de tema (dark é o padrão; preferência salva no localStorage)
const themeIcon = document.getElementById('theme-icon');

function setTheme(light) {
  document.body.classList.toggle('light', light);
  themeIcon.textContent = light ? 'dark_mode' : 'light_mode';
  localStorage.setItem('theme', light ? 'light' : 'dark');
}

document.getElementById('theme-btn').addEventListener('click', () =>
  setTheme(!document.body.classList.contains('light')));

setTheme(localStorage.getItem('theme') === 'light');

const profileMenu = document.getElementById('profile-menu');
document.getElementById('profile-btn').addEventListener('click', () => profileMenu.open = !profileMenu.open);
