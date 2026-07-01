const API_BASE = "/api/v1/cars/";

const carsBody = document.getElementById("cars-body");
const form = document.getElementById("car-form");
const formMsg = document.getElementById("form-msg");
const reloadBtn = document.getElementById("reload-btn");

const priceFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function setMsg(text, type) {
  formMsg.textContent = text;
  formMsg.className = "msg" + (type ? " " + type : "");
}

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadCars() {
  carsBody.innerHTML =
    '<tr><td colspan="6" class="empty">Carregando…</td></tr>';
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    renderRows(data.cars ?? []);
  } catch (err) {
    carsBody.innerHTML = `<tr><td colspan="6" class="empty">Erro ao carregar: ${escapeHtml(
      err.message
    )}</td></tr>`;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("Enviando…");

  const fd = new FormData(form);
  const color = fd.get("color").trim();
  const payload = {
    brand: fd.get("brand").trim(),
    model: fd.get("model").trim(),
    color: color === "" ? null : color,
    year: Number(fd.get("year")),
    price: Number(fd.get("price")),
  };

  try {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error("HTTP " + res.status + " — " + detail);
    }
    setMsg("Carro adicionado!", "ok");
    form.reset();
    loadCars();
  } catch (err) {
    setMsg("Erro: " + err.message, "err");
  }
});

reloadBtn.addEventListener("click", loadCars);

loadCars();
