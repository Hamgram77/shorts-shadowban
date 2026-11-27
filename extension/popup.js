(() => {
  "use strict";

  const STORAGE_KEY = "shortsShadowbanHandles";
  const list = document.getElementById("handles");
  const empty = document.getElementById("empty");
  const count = document.getElementById("count");

  const storageArea = () => globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local;

  async function readHandles() {
    const result = await storageArea().get(STORAGE_KEY);
    return Array.isArray(result?.[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  }

  async function writeHandles(handles) {
    await storageArea().set({ [STORAGE_KEY]: handles });
  }

  function render(handles) {
    list.replaceChildren();
    empty.hidden = handles.length !== 0;
    count.textContent = handles.length ? `${handles.length} shadowbanned channel${handles.length === 1 ? "" : "s"}` : "";

    handles.forEach((handle) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const button = document.createElement("button");
      label.className = "handle";
      label.textContent = handle;
      button.type = "button";
      button.textContent = "Unblock";
      button.setAttribute("aria-label", `Unblock ${handle}`);
      button.addEventListener("click", async () => {
        button.disabled = true;
        const current = await readHandles();
        const updated = current.filter((entry) => entry !== handle);
        await writeHandles(updated);
        render(updated);
      });
      item.append(label, button);
      list.appendChild(item);
    });
  }

  readHandles().then(render).catch(() => {
    empty.hidden = false;
    empty.textContent = "Could not read the blocklist. Reopen this popup to try again.";
  });
})();
