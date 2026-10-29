import { describe, it, expect, vi } from "vitest";
import { createProvisioner } from "./workspaceProvisioning";

function fixture() {
  let cfg = {
    baseURL: "https://work.example.test",
    workspaces: [],
    windows: { "alpha:notes": { pinned: true } },
  };
  const list = [
    { id: "alpha", name: "Empresa do servidor A" },
    { id: "beta", name: "Empresa do servidor B" },
  ];
  const request = vi.fn(async (path, options = {}, workspace) => {
    if (path === "/api/v1/workspaces") return list;
    if (path === "/api/v1/context")
      return { locked: true, workspace, archived: false };
    const id = path.split("/")[4];
    return { workspace: id, token: "machine-capability-" + id };
  });
  const persist = (change) => {
    cfg = { ...cfg, ...change };
  };
  const manager = createProvisioner({ getConfig: () => cfg, persist, request });
  return {
    manager,
    request,
    list,
    persist,
    config: () => cfg,
    posts: () => request.mock.calls.filter((c) => c[1]?.method === "POST"),
  };
}

describe("automatic workspace integration", () => {
  it("loads all companies from the server and verifies a separate scoped credential for each", async () => {
    const f = fixture();
    await f.manager.refresh();
    expect(f.config().workspaces.map((w) => w.id)).toEqual(["alpha", "beta"]);
    expect(f.posts()).toHaveLength(2);
    expect(
      f.request.mock.calls
        .filter((c) => c[0] === "/api/v1/context")
        .map((c) => c[2]),
    ).toEqual(["alpha", "beta"]);
    expect(f.manager.snapshot().workspaces.alpha.state).toBe("connected");
    expect(f.config().lastWorkspace).toBeUndefined(); // Never infer the active company from list order.
    expect(JSON.stringify(f.manager.snapshot())).not.toContain(
      "machine-capability",
    );
  });
  it("reuses credentials and coalesces concurrent refreshes", async () => {
    const f = fixture();
    const first = f.manager.refresh();
    expect(f.manager.refresh()).toBe(first);
    await first;
    await f.manager.refresh();
    expect(f.posts()).toHaveLength(2);
  });
  it("preserves offline configuration without reporting a false connection", async () => {
    const f = fixture();
    await f.manager.refresh();
    const saved = structuredClone(f.config());
    f.request.mockRejectedValue(new Error("Offline"));
    await expect(f.manager.refresh()).rejects.toThrow("Offline");
    expect(f.config()).toEqual(saved);
    expect(f.manager.snapshot().workspaces.alpha.state).toBe("offline");
  });
  it("does not silently replace revoked credentials", async () => {
    const f = fixture();
    await f.manager.refresh();
    f.request.mockImplementation(async (path, options = {}, workspace) => {
      if (path === "/api/v1/workspaces") return f.list;
      if (path === "/api/v1/context") throw new Error("Credencial revogada");
      return { workspace: "alpha", token: "new-machine-capability-alpha" };
    });
    await f.manager.refresh();
    expect(f.posts()).toHaveLength(2);
    expect(f.manager.snapshot().workspaces.alpha.state).toBe("error");
    f.request.mockImplementation(async (path, options = {}, workspace) =>
      path === "/api/v1/context"
        ? { locked: true, workspace }
        : { workspace: "alpha", token: "new-machine-capability-alpha" },
    );
    await f.manager.reconnect("alpha");
    expect(f.posts()).toHaveLength(3);
    expect(f.manager.snapshot().workspaces.alpha.state).toBe("connected");
  });
  it("rejects an unscoped or wrong-company context", async () => {
    const f = fixture();
    const original = f.request.getMockImplementation();
    f.request.mockImplementation((path, ...args) =>
      path === "/api/v1/context"
        ? Promise.resolve({ locked: false, workspace: "beta" })
        : original(path, ...args),
    );
    await f.manager.refresh();
    expect(f.manager.snapshot().workspaces.alpha.state).toBe("error");
  });
  it("updates names/new companies and keeps window preferences", async () => {
    const f = fixture();
    await f.manager.refresh();
    f.list[0].name = "Renamed";
    f.list.splice(1, 1, { id: "gamma", name: "New server company" });
    await f.manager.refresh();
    expect(f.config().workspaces.map((w) => w.name)).toEqual([
      "Renamed",
      "New server company",
    ]);
    expect(f.config().windows["alpha:notes"].pinned).toBe(true);
    expect(f.posts()).toHaveLength(3);
  });
  it("does not persist old-server data when the endpoint changes during a request", async () => {
    const f = fixture();
    let resolve;
    f.request.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const old = f.manager.refresh();
    f.persist({ baseURL: "https://new.example.test", workspaces: [] });
    f.manager.reset();
    resolve(f.list);
    await expect(old).rejects.toThrow("Servidor alterado");
    expect(f.config().workspaces).toEqual([]);
    expect(f.posts()).toHaveLength(0);
    await f.manager.refresh();
    expect(f.manager.snapshot().server.state).toBe("online");
    expect(f.posts()).toHaveLength(2);
  });
  it("rejects malformed lists before modifying saved connections", async () => {
    const f = fixture();
    await f.manager.refresh();
    const before = structuredClone(f.config());
    f.request.mockResolvedValueOnce([{ id: "../bad", name: "Bad" }]);
    await expect(f.manager.refresh()).rejects.toThrow();
    expect(f.config()).toEqual(before);
  });
});
