import { describe, it, expect } from "vitest";
import Module, { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
function loadStore(directory) {
  const id = require.resolve("./jsonStore.js"),
    previous = require.cache[id],
    original = Module._load;
  delete require.cache[id];
  Module._load = function (name, ...args) {
    if (name === "electron") return { app: { getPath: () => directory } };
    return original.call(this, name, ...args);
  };
  try {
    return require("./jsonStore.js");
  } finally {
    Module._load = original;
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  }
}

describe("workspace settings persistence", () => {
  it("preserves endpoint, scoped credentials and window preferences through saves and restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-work-store-"));
    try {
      const store = loadStore(dir);
      const workSync = {
        baseURL: "https://real.example.test",
        workspaces: [
          {
            id: "alpha",
            name: "Company Alpha",
            token: "test-only-private-capability",
          },
        ],
        lastWorkspace: "alpha",
        windows: {
          "alpha:notes": {
            pinned: true,
            bounds: { x: 20, y: 40, width: 400, height: 600 },
          },
        },
      };
      store.saveSettings({ ...store.getSettings(), workSync });
      expect(store.getSettings().workSync).toEqual(workSync);
      store.saveSettings({ general: { windowOpacity: 0.85 } });
      expect(store.getSettings().workSync).toEqual(workSync);
      expect(
        fs.readFileSync(path.join(dir, "settings.json"), "utf8"),
      ).not.toContain("test-only-private-capability");
      const reopened = loadStore(dir);
      expect(reopened.getSettings().workSync).toEqual(workSync);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("starts with the configured production endpoint but no hardcoded companies", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-work-empty-"));
    try {
      const store = loadStore(dir);
      expect(store.getSettings().workSync).toEqual({
        baseURL: "https://work.home.fbsis.com",
        workspaces: [],
        windows: {},
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
