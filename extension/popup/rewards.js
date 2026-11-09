/* Private rewards: the worker/backend owns identity, progress and entitlements. */
(() => {
  const settingsBox = document.createElement("section");
  settingsBox.className = "wc-rewards-settings";
  settingsBox.hidden = true;
  document.getElementById("settings-panel").append(settingsBox);
  const widget = document.createElement("section");
  widget.className = "wc-reward-next";
  widget.hidden = true;
  document.getElementById("session-panel").append(widget);
  const notice = document.createElement("aside");
  notice.setAttribute("role", "status");
  notice.className = "wc-reward-notice";
  notice.hidden = true;
  document.getElementById("session-panel").append(notice);
  let data = null,
    busy = false,
    request = 0,
    noticeOwner = null;
  const text = (en, es) => (getLang() === "es" ? es : en);
  function node(tag, value) {
    const el = document.createElement(tag);
    el.textContent = value;
    return el;
  }
  function open() {
    const url = "https://unoword.app/rewards";
    try {
      chrome.tabs.create({ url });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
  function clear() {
    data = null;
    settingsBox.hidden = true;
    widget.hidden = true;
    notice.hidden = true;
    notice.replaceChildren();
    noticeOwner = null;
  }
  async function refresh() {
    if (!account.authenticated || !account.userId) {
      clear();
      return;
    }
    if (busy) return;
    const owner = account.userId,
      version = ++request;
    busy = true;
    try {
      const response = await sendMessage({
        type: "WRITING_REWARDS",
        action: "read",
        expectedUserId: owner,
        language: getLang(),
      });
      if (
        version !== request ||
        account.userId !== owner ||
        !account.authenticated
      ) {
        clear();
        return;
      }
      if (!response.ok || response.data?.user_id !== owner) {
        clear();
        return;
      }
      data = response.data;
      render();
      if (!data.enabled || !data.preferences.celebrations) {
        notice.hidden = true;
        return;
      }
      if (!state.active && currentPanel === "session") {
        const claimed = await sendMessage({
          type: "WRITING_REWARDS",
          action: "claim",
          expectedUserId: owner,
        });
        if (account.userId !== owner || !account.authenticated || state.active)
          return;
        const award = data.achievements.find(
          (a) => a.id === claimed.data?.achievement_id,
        );
        if (award) {
          noticeOwner = owner;
          notice.replaceChildren(
            node(
              "strong",
              text("Achievement Unlocked!", "¡Logro desbloqueado!"),
            ),
            node("p", award.name),
          );
          const close = node("button", "×");
          close.type = "button";
          close.setAttribute("aria-label", text("Close", "Cerrar"));
          close.onclick = () => {
            notice.hidden = true;
          };
          notice.append(close);
          notice.hidden = false;
        }
      }
    } finally {
      busy = false;
    }
  }
  function render() {
    if (!data || data.user_id !== account.userId) {
      clear();
      return;
    }
    if (noticeOwner !== account.userId) notice.hidden = true;
    settingsBox.hidden = false;
    settingsBox.replaceChildren(
      node("h3", text("Rewards & Achievements", "Recompensas y logros")),
      node(
        "p",
        text(
          "Celebrate your writing milestones at your own pace.",
          "Celebra tus hitos de escritura a tu ritmo.",
        ),
      ),
    );
    for (const [key, en, es] of [
      ["enabled", "Enable Writing Rewards", "Activar recompensas de escritura"],
      ["celebrations", "Achievement Celebrations", "Celebraciones de logros"],
      [
        "widget",
        "Show Rewards on Dashboard",
        "Mostrar recompensas en el panel",
      ],
    ]) {
      const label = node("label", ""),
        input = document.createElement("input");
      input.type = "checkbox";
      input.checked = data.preferences[key];
      input.disabled = key !== "enabled" && !data.enabled;
      input.onchange = async () => {
        input.disabled = true;
        const owner = account.userId;
        const result = await sendMessage({
          type: "WRITING_REWARDS",
          action: "preferences",
          expectedUserId: owner,
          revision: data.preferences.revision,
          patch: { [key]: input.checked },
        });
        if (owner !== account.userId) return;
        input.disabled = false;
        if (!result.ok)
          settingsBox.append(
            node(
              "p",
              text(
                "Refresh and try again. Your settings changed or could not save.",
                "Actualiza e inténtalo de nuevo. No se pudo guardar.",
              ),
            ),
          );
        else {
          if (key === "enabled" && !input.checked) {
            widget.hidden = true;
            notice.hidden = true;
          }
          void refresh();
        }
      };
      label.append(input, node("span", text(en, es)));
      settingsBox.append(label);
    }
    widget.hidden = true;
    if (!data.enabled) {
      notice.hidden = true;
      settingsBox.append(
        node(
          "p",
          text(
            "Your achievements stay saved while rewards are off.",
            "Tus logros se conservan al desactivar las recompensas.",
          ),
        ),
      );
      return;
    }
    const view = node("button", text("View Rewards →", "Ver recompensas →"));
    view.type = "button";
    view.className = "wc__link-btn";
    view.onclick = open;
    settingsBox.append(view);
    const next = data.achievements
      .filter(
        (a) =>
          !a.unlocked &&
          a.active &&
          ["words", "sessions", "seconds", "goals", "streak"].includes(
            a.metric,
          ),
      )
      .sort(
        (a, b) =>
          b.progress / b.requirement - a.progress / a.requirement ||
          a.requirement - b.requirement,
      )[0];
    if (data.preferences.widget && next) {
      widget.replaceChildren(
        node("small", text("Your Next Milestone", "Tu próximo hito")),
        node("h3", next.name),
        node(
          "p",
          (
            Math.min(next.progress, next.requirement) /
            (next.metric === "seconds" ? 3600 : 1)
          ).toLocaleString(getLang(), { maximumFractionDigits: 2 }) +
            " / " +
            (
              next.requirement / (next.metric === "seconds" ? 3600 : 1)
            ).toLocaleString(getLang(), { maximumFractionDigits: 2 }) +
            (next.metric === "seconds"
              ? text(" active hours", " horas activas")
              : ""),
        ),
      );
      const progress = document.createElement("progress");
      progress.max = next.requirement;
      progress.value = Math.min(next.progress, next.requirement);
      progress.setAttribute("aria-label", next.name);
      widget.append(progress);
      const link = view.cloneNode(true);
      link.onclick = open;
      widget.append(link);
      widget.hidden = false;
    }
  }
  window.addEventListener("uno-rewards-refresh", () => {
    if (data?.user_id !== account.userId) clear();
    void refresh();
  });
  window.addEventListener("focus", () => void refresh());
  window.addEventListener("online", () => void refresh());
  document.addEventListener("change", () =>
    setTimeout(() => void refresh(), 0),
  );
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 15000);
  void refresh();
})();
