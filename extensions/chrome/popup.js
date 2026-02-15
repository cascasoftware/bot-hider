const DEFAULTS = {
  minimise: true,
  red: true,
  remove: false
};

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

async function load() {
  const opts = await chrome.storage.sync.get(DEFAULTS);

  document.getElementById("optMinimise").checked = !!opts.minimise;
  document.getElementById("optRed").checked = !!opts.red;
  document.getElementById("optRemove").checked = !!opts.remove;

  setStatus("Saved settings loaded");
}

async function save() {
  const minimise = document.getElementById("optMinimise").checked;
  const red = document.getElementById("optRed").checked;
  const remove = document.getElementById("optRemove").checked;

  await chrome.storage.sync.set({ minimise, red, remove });
  setStatus("Saved");
}

document.addEventListener("change", (e) => {
  const id = e.target?.id;
  if (id === "optMinimise" || id === "optRed" || id === "optRemove") {
    save();
  }
});

load();
