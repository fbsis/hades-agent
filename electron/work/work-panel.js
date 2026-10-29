const $ = (id) => document.getElementById(id);
const cmd = (name, args) => window.metisWork.command(name, args);
let current;
let busy = false;
function status(text, error = false) {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
}
function setBusy(value) {
  busy = value;
  for (const b of document.querySelectorAll("button"))
    b.disabled = b.dataset.alwaysAvailable === "1" ? false : value || b.dataset.blocked === "1";
}
function friendly(error) {
  return String(error?.message || error).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
}
async function act(fn) {
  if (busy) return;
  setBusy(true);
  status("");
  try {
    await fn();
  } catch (error) {
    status(friendly(error), true);
  } finally {
    setBusy(false);
  }
}
function button(text, fn, disabled = false) {
  const b = document.createElement("button");
  b.textContent = text;
  b.dataset.blocked = disabled ? "1" : "0";
  b.disabled = busy || disabled;
  b.onclick = () => act(fn);
  return b;
}
async function render() {
  const c = await cmd("config");
  current = c;
  if (document.activeElement !== $("endpoint")) $("endpoint").value = c.baseURL;
  const server = c.connection?.server || {};
  $("serverStatus").textContent =
    server.state === "online"
      ? "Servidor conectado"
      : server.state === "offline"
        ? "Servidor indisponível agora"
        : "Preparando integração…";
  $("serverStatus").className =
    "badge " +
    (server.state === "online"
      ? "connected"
      : server.state === "offline"
        ? "error"
        : "pending");
  $("source").textContent = "Empresas consultadas em: " + c.baseURL;
  $("connections").replaceChildren();
  for (const w of c.workspaces) {
    const check = c.connection?.workspaces?.[w.id] || {
      state: "loading",
      message: "Preparando acesso…",
    };
    const ready = ["connected", "archived"].includes(check.state);
    const section = document.createElement("div");
    section.className = "workspace";
    const title = document.createElement("h2");
    title.textContent = w.name;
    const badge = document.createElement("span");
    badge.className =
      "badge " +
      (ready ? "connected" : check.state === "error" ? "error" : "pending");
    badge.textContent = ready
      ? check.state === "archived"
        ? "Conectado · somente leitura"
        : "Conectado"
      : check.state === "error"
        ? "Acesso não confirmado"
        : check.state === "offline"
          ? "Sem conexão agora"
          : "Preparando…";
    const detail = document.createElement("p");
    detail.textContent =
      check.message +
      (check.checkedAt
        ? " · verificado às " +
          new Date(check.checkedAt).toLocaleTimeString("pt-BR")
        : "");
    section.append(title, badge, detail);
    const row = document.createElement("div");
    row.className = "row";
    row.append(
      button(
        "Notas flutuantes",
        () => cmd("open", { workspace: w.id, mode: "notes" }),
        !ready,
      ),
      button(
        "Aplicação web",
        () => cmd("open", { workspace: w.id, mode: "full" }),
        !ready,
      ),
    );
    if (check.state === "error")
      row.append(
        button("Reautorizar acesso", async () => {
          if (
            !confirm(
              "Gerar uma nova autorização para esta empresa? Use somente se deseja restabelecer o acesso deste computador.",
            )
          )
            return;
          await cmd("reconnect", { workspace: w.id });
          await render();
        }),
      );
    section.append(row);
    const prefs = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Preferências das janelas";
    prefs.append(summary);
    for (const mode of ["notes", "full"]) {
      const key = w.id + ":" + mode,
        p = c.windows[key] || {};
      const group = document.createElement("div");
      group.className = "pref";
      const h = document.createElement("strong");
      h.textContent = mode === "notes" ? "Notas" : "Aplicação completa";
      group.append(h);
      for (const [name, label] of [
        ["pinned", "Sempre por cima"],
        ["allSpaces", "Mostrar em todas as Mesas"],
        ["autoHide", "Ocultar ao perder foco"],
      ]) {
        const l = document.createElement("label");
        l.className = "checkbox";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!p[name];
        input.onchange = () =>
          act(() =>
            cmd("preferences", { key, change: { [name]: input.checked } }),
          );
        l.append(input, document.createTextNode(label));
        group.append(l);
      }
      for (const [name, label] of [
        ["spaceLabel", "Referência da Mesa"],
        ["hotkey", "Atalho (ex.: Alt+Shift+1; vazio para desligar)"],
      ]) {
        const l = document.createElement("label");
        l.textContent = label;
        const input = document.createElement("input");
        input.value = p[name] || "";
        l.append(
          input,
          button("Salvar preferência", () =>
            cmd("preferences", { key, change: { [name]: input.value } }),
          ),
        );
        group.append(l);
      }
      prefs.append(group);
    }
    section.append(prefs);
    $("connections").append(section);
  }
  if (!c.workspaces.length)
    $("connections").textContent =
      server.state === "online"
        ? "Nenhuma empresa cadastrada no servidor."
        : "As empresas aparecerão automaticamente quando o servidor estiver disponível.";
}
async function refresh() {
  status("Carregando todas as empresas e preparando os acessos…");
  try {
    await cmd("refresh");
  } finally {
    await render();
  }
  status(current?.connection?.server?.message || "Empresas atualizadas.");
}
// Native desktop entry points never wait for provisioning or server responses.
for (const [id, panel] of [["openDesktop", "command"], ["openChat", "chat"], ["openDesktopSettings", "settings"]]) {
  $(id).onclick = () => cmd("desktop", { panel }).catch(error => status(friendly(error), true));
}
$("saveEndpoint").onclick = () =>
  act(async () => {
    const different =
      current && $("endpoint").value.replace(/\/$/, "") !== current.baseURL;
    const confirmSwitch = !!different && !!current.workspaces.length;
    if (
      confirmSwitch &&
      !confirm(
        "Trocar de servidor fechará as centrais atuais e carregará as empresas do novo endereço. Nenhum dado no servidor será apagado. Continuar?",
      )
    )
      return;
    status("Integrando com o servidor…");
    try {
      await cmd("endpoint", { url: $("endpoint").value, confirmSwitch });
    } finally {
      await render();
    }
    status(
      "Integração concluída. As empresas foram carregadas automaticamente.",
    );
  });
$("loadWorkspaces").onclick = () => act(refresh);
$("hideAll").onclick = () => act(() => cmd("hide"));
async function renderSessions() {
  const list = await cmd("sessions");
  $("meetingSync").replaceChildren();
  for (const s of list) {
    const row = document.createElement("p");
    row.textContent = `${s.title} · ${s.workspace} · ${s.status}${s.error ? " — " + s.error : ""}`;
    $("meetingSync").append(row);
  }
}
$("syncMeetings").onclick = () =>
  act(async () => {
    status("Sincronizando resumos…");
    await cmd("sync");
    await renderSessions();
    status("Tentativas concluídas. Confira os estados abaixo.");
  });
void act(async () => {
  await render();
  try {
    await refresh();
  } finally {
    await renderSessions();
  }
});
