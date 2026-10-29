const { key } = require("./workspaceWindowState");

/** Prepare every active workspace, without sharing credentials between companies. */
function createProvisioner({ getConfig, persist, request }) {
  let pending;
  let server = { state: "unchecked", message: "Aguardando servidor" };
  let states = {};
  const snapshot = () => ({
    server: { ...server },
    workspaces: Object.fromEntries(
      Object.entries(states).map(([id, s]) => [id, { ...s }]),
    ),
  });
  function guard(base) {
    if (getConfig().baseURL !== base)
      throw new Error(
        "Servidor alterado durante a atualização. Tente novamente.",
      );
  }
  function save(base, workspace, token) {
    guard(base);
    const cfg = getConfig();
    const entry = {
      id: workspace.id,
      name: workspace.name,
      color: workspace.color,
      token,
    };
    const list = [...cfg.workspaces],
      index = list.findIndex((w) => w.id === workspace.id);
    if (index < 0) list.push(entry);
    else list[index] = entry;
    persist({ workspaces: list });
  }
  async function authorize(base, w) {
    guard(base);
    const access = await request(
      `/api/v1/workspaces/${encodeURIComponent(w.id)}/access`,
      { method: "POST", body: JSON.stringify({ label: "Metis desktop" }) },
    );
    guard(base);
    if (
      access?.workspace !== w.id ||
      typeof access.token !== "string" ||
      access.token.length < 16
    )
      throw new Error("Autorização de empresa inválida no servidor.");
    save(base, w, access.token);
    return access.token;
  }
  async function verify(base, w) {
    guard(base);
    const context = await request("/api/v1/context", {}, w.id);
    guard(base);
    if (context?.locked !== true || context.workspace !== w.id)
      throw new Error("O servidor não confirmou o isolamento desta empresa.");
    states[w.id] = {
      state: context.archived ? "archived" : "connected",
      message: context.archived
        ? "Empresa arquivada · somente leitura"
        : "Conectado ao servidor",
      checkedAt: new Date().toISOString(),
    };
  }
  async function run() {
    const base = getConfig().baseURL;
    server = {
      state: "loading",
      message: "Carregando empresas automaticamente…",
    };
    try {
      const list = await request("/api/v1/workspaces");
      guard(base);
      if (!Array.isArray(list)) throw new Error("Lista de empresas inválida.");
      const active = list.filter((w) => !w.archived),
        ids = new Set();
      for (const w of active) {
        key(w.id, "notes");
        if (typeof w.name !== "string" || ids.has(w.id))
          throw new Error("Cadastro de empresa inválido.");
        ids.add(w.id);
      }
      const cfg = getConfig();
      persist({
        workspaces: active.map((w) => ({
          id: w.id,
          name: w.name,
          color: w.color,
          token: cfg.workspaces.find((old) => old.id === w.id)?.token || "",
        })),
        lastWorkspace: ids.has(cfg.lastWorkspace)
          ? cfg.lastWorkspace
          : undefined,
      });
      states = Object.fromEntries(
        active.map((w) => [
          w.id,
          { state: "loading", message: "Preparando acesso…" },
        ]),
      );
      for (const w of active) {
        guard(base);
        try {
          if (!getConfig().workspaces.find((old) => old.id === w.id)?.token)
            await authorize(base, w);
          await verify(base, w);
        } catch (error) {
          guard(base);
          states[w.id] = {
            state: "error",
            message: error.message || "Não foi possível validar a conexão.",
          };
        }
      }
      server = {
        state: "online",
        message: active.length
          ? "Empresas carregadas automaticamente. Abra a janela que quiser usar."
          : "Servidor conectado · nenhuma empresa cadastrada.",
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (getConfig().baseURL === base) {
        server = {
          state: "offline",
          message: error.message || "Servidor indisponível.",
        };
        states = Object.fromEntries(
          getConfig().workspaces.map((w) => [
            w.id,
            {
              state: "offline",
              message:
                "Conexão não confirmada agora; configuração local preservada.",
            },
          ]),
        );
      }
      throw error;
    }
    return snapshot();
  }
  function refresh() {
    if (!pending) {
      const task = run().finally(() => {
        if (pending === task) pending = null;
      });
      pending = task;
    }
    return pending;
  }
  async function reconnect(id) {
    if (pending) await pending.catch(() => {});
    const cfg = getConfig(),
      w = cfg.workspaces.find((w) => w.id === id);
    if (!w) throw new Error("Empresa não encontrada no servidor configurado.");
    key(id, "notes");
    await authorize(cfg.baseURL, w);
    await verify(cfg.baseURL, w);
    return snapshot();
  }
  function reset() {
    pending = null;
    server = { state: "unchecked", message: "Aguardando servidor" };
    states = {};
  }
  return { refresh, reconnect, snapshot, reset };
}
module.exports = { createProvisioner };
