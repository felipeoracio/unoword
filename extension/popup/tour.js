/* Companion walkthrough only: never starts sessions or generates AI itself. */
(() => {
  const launch = document.createElement("button");
  launch.type = "button";
  launch.className = "wc__link-btn";
  launch.id = "take-unoword-tour";
  const es = () => getLang() === "es";
  launch.textContent = es() ? "Recorrido de UnoWord" : "Take the UnoWord Tour";
  document.getElementById("settings-panel").prepend(launch);
  const local = globalThis.chrome?.storage?.local || {
    get: async (key) => ({
      [key]: JSON.parse(localStorage.getItem(key) || "null"),
    }),
    set: async (values) =>
      Object.entries(values).forEach(([key, value]) =>
        localStorage.setItem(key, JSON.stringify(value)),
      ),
  };
  let panel = null,
    index = 0,
    marked = null,
    storageKey = "",
    saved = { step: 0, status: "paused", actions: {} };
  const steps = [
    [
      "nav-write",
      "Make time for your ideas",
      "Use Start Session when you are ready to write. If a session is already active, keep it going.",
      "Haz tiempo para tus ideas",
      "Usa Iniciar sesión cuando quieras escribir. Si ya hay una sesión activa, continúa.",
    ],
    [
      "count-number",
      "Every word counts",
      "Type in a supported website during your session. Typed words and pasted words are tracked separately.",
      "Cada palabra cuenta",
      "Escribe en un sitio compatible durante la sesión. Las palabras escritas y pegadas se cuentan por separado.",
    ],
    [
      "nav-progress",
      "Your words tell a story",
      "Open Progress to review your actual writing activity. Your plan determines available history.",
      "Tus palabras cuentan una historia",
      "Abre Progreso para revisar tu actividad real. Tu plan determina el historial disponible.",
    ],
    [
      "nav-ideas",
      "Your next sentence is waiting",
      "Open Ideas and select Original Writing Suggestion for the existing Free prompt library. AI modes require Pro.",
      "Tu siguiente frase te espera",
      "Abre Ideas y elige la sugerencia original para ver los temas gratis. Los modos IA requieren Pro.",
    ],
  ];
  function persist(status) {
    saved = { ...saved, step: index, status };
    void local.set({ [storageKey]: saved }).catch(() => {});
  }
  function close() {
    persist("paused");
    marked?.classList.remove("wc-tour-target");
    panel?.remove();
    panel = null;
    launch.focus();
  }
  function render() {
    marked?.classList.remove("wc-tour-target");
    const item = steps[index];
    marked = document.getElementById(item[0]);
    marked?.classList.add("wc-tour-target");
    panel.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = item[es() ? 3 : 1];
    const text = document.createElement("p");
    text.textContent = item[es() ? 4 : 2];
    const progress = document.createElement("p");
    progress.textContent = `${index + 1} / ${steps.length}`;
    const pause = document.createElement("button");
    pause.type = "button";
    pause.textContent = es() ? "Pausar" : "Pause";
    pause.onclick = close;
    const next = document.createElement("button");
    next.type = "button";
    next.textContent =
      index === 3
        ? es()
          ? "Terminar"
          : "Finish"
        : es()
          ? "Siguiente / Omitir"
          : "Next / Skip";
    next.onclick = () => {
      if (index === 3) {
        persist("completed");
        marked?.classList.remove("wc-tour-target");
        panel.remove();
        panel = null;
        launch.focus();
      } else {
        index++;
        persist("in_progress");
        render();
      }
    };
    panel.append(progress, title, text, pause, next);
    next.focus();
  }
  launch.addEventListener("click", async () => {
    if (panel) return;
    storageKey = "uno_extension_tour_v1:" + (account.userId || "device");
    const records = await local.get(storageKey).catch(() => ({}));
    saved = records[storageKey] || { step: 0, status: "paused", actions: {} };
    index = saved.status === "completed" ? 0 : Math.min(3, saved.step || 0);
    panel = document.createElement("aside");
    panel.className = "wc-extension-tour";
    panel.setAttribute(
      "aria-label",
      es() ? "Recorrido de UnoWord" : "UnoWord tour",
    );
    document.body.append(panel);
    persist("in_progress");
    render();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel) close();
  });
  // Record real clicks only. Never award actions for viewing a step.
  for (const id of ["primary-btn", "nav-progress", "nav-ideas"])
    document.getElementById(id)?.addEventListener("click", () => {
      if (panel) {
        saved.actions[id] = true;
        persist("in_progress");
      }
    });
})();
