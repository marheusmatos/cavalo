const API_BASE = "/api/v1/cars/";
const TOKEN_URL = "/auth/token";

// --- Sessão: guarda o header Authorization e o rótulo do usuário -----------
// Formato salvo: { header: "Bearer <jwt>", label: "..." }
// Decodifica o "sub" do JWT (e-mail ou usuário) para exibir na topbar.
function labelFromJwt(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || "usuário";
  } catch {
    return "usuário";
  }
}
function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem("auth") || "null");
  } catch {
    return null;
  }
}
function saveSession(session) {
  sessionStorage.setItem("auth", JSON.stringify(session));
}
function clearSession() {
  sessionStorage.removeItem("auth");
}

let auth = loadSession();

// --- Elementos --------------------------------------------------------------
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const sessionBox = document.getElementById("session");
const sessionUser = document.getElementById("session-user");
const loginMsg = document.getElementById("login-msg");
const formMsg = document.getElementById("form-msg");
const carsBody = document.getElementById("cars-body");

const jwtForm = document.getElementById("jwt-form");
const carForm = document.getElementById("car-form");

const priceFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// --- Helpers ----------------------------------------------------------------
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setMsg(el, text, type) {
  el.textContent = text;
  el.className = "msg" + (type ? " " + type : "");
}

// fetch que injeta o header de auth e trata 401 (sessão expirada/inválida).
async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (auth) headers["Authorization"] = auth.header;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    logout();
    setMsg(loginMsg, "Sessão inválida ou expirada. Entre novamente.", "err");
    throw new Error("401");
  }
  return res;
}

// --- Alternância login / app -----------------------------------------------
function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  sessionBox.classList.remove("hidden");
  sessionUser.textContent = auth.label;
  loadCars();
}

function showLogin() {
  appView.classList.add("hidden");
  sessionBox.classList.add("hidden");
  loginView.classList.remove("hidden");
}

function logout() {
  auth = null;
  clearSession();
  showLogin();
}

// --- Login JWT (OAuth2 password: form username/password) --------------------
jwtForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg(loginMsg, "Entrando…");
  const fd = new FormData(jwtForm);
  const username = fd.get("username");
  // OAuth2PasswordRequestForm espera application/x-www-form-urlencoded.
  const body = new URLSearchParams({
    username,
    password: fd.get("password"),
  });
  try {
    const res = await fetch(TOKEN_URL, { method: "POST", body });
    if (!res.ok) {
      const detail =
        res.status === 401 ? "Usuário ou senha inválidos" : "HTTP " + res.status;
      throw new Error(detail);
    }
    const data = await res.json();
    auth = { header: "Bearer " + data.access_token, label: username };
    saveSession(auth);
    setMsg(loginMsg, "");
    showApp();
  } catch (err) {
    setMsg(loginMsg, "Erro: " + err.message, "err");
  }
});

document.getElementById("logout-btn").addEventListener("click", logout);

// --- Listagem e cadastro de carros -----------------------------------------
function renderRows(cars) {
  if (!cars.length) {
    carsBody.innerHTML =
      '<tr><td colspan="6" class="empty">Nenhum carro cadastrado.</td></tr>';
    return;
  }
  carsBody.innerHTML = cars
    .map(
      (c) => `
      <tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.brand)}</td>
        <td>${escapeHtml(c.model)}</td>
        <td>${escapeHtml(c.color ?? "")}</td>
        <td>${c.year}</td>
        <td>${priceFmt.format(c.price)}</td>
      </tr>`
    )
    .join("");
}

async function loadCars() {
  carsBody.innerHTML =
    '<tr><td colspan="6" class="empty">Carregando…</td></tr>';
  try {
    const res = await authFetch(API_BASE);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    renderRows(data.cars ?? []);
  } catch (err) {
    if (err.message === "401") return; // já tratado (voltou pro login)
    carsBody.innerHTML = `<tr><td colspan="6" class="empty">Erro ao carregar: ${escapeHtml(
      err.message
    )}</td></tr>`;
  }
}

carForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg(formMsg, "Enviando…");
  const fd = new FormData(carForm);
  const color = fd.get("color").trim();
  const payload = {
    brand: fd.get("brand").trim(),
    model: fd.get("model").trim(),
    color: color === "" ? null : color,
    year: Number(fd.get("year")),
    price: Number(fd.get("price")),
  };
  try {
    const res = await authFetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error("HTTP " + res.status + " — " + detail);
    }
    setMsg(formMsg, "Carro adicionado!", "ok");
    carForm.reset();
    loadCars();
  } catch (err) {
    if (err.message !== "401") setMsg(formMsg, "Erro: " + err.message, "err");
  }
});

document.getElementById("reload-btn").addEventListener("click", loadCars);

// --- Retorno do login Google (#token=... ou #error=...) --------------------
function consumeGoogleRedirect() {
  if (!location.hash) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token");
  const error = params.get("error");
  // Limpa o fragmento da URL (não deixa o token no histórico/barra).
  history.replaceState(null, "", location.pathname + location.search);

  if (token) {
    auth = { header: "Bearer " + token, label: labelFromJwt(token) };
    saveSession(auth);
  } else if (error) {
    setMsg(loginMsg, "Erro: " + error, "err");
  }
}

// --- Estado inicial ---------------------------------------------------------
consumeGoogleRedirect();
if (auth) {
  showApp();
} else {
  showLogin();
}
