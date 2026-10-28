/** The same saved-task display for popup suggestions and editor assistance. */
(function attach(scope) {
  function render(container, task, { language = 'en', owner, id } = {}) {
    container.replaceChildren(); container.hidden = !task;
    if (!task) return;
    const es = language === 'es', number = n => new Intl.NumberFormat(es ? 'es' : 'en').format(n);
    container.className = 'uw-writing-task';
    const heading = document.createElement('strong');
    heading.textContent = task.goal_reached ? (es ? 'Meta cumplida · inspiración opcional' : 'Goal complete · optional inspiration')
      : (es ? `Aproximadamente ${number(task.target_words)} palabras` : `About ${number(task.target_words)} words`);
    const note = document.createElement('p');
    note.textContent = task.goal_reached ? (es ? 'Tu meta estaba cumplida al generar esta sugerencia. Continuar es opcional.' : 'Your goal was complete when this suggestion was generated. Continuing is optional.')
      : task.remaining_words == null ? (es ? 'Extensión sugerida; no había una meta diaria al generar.' : 'Suggested length; no daily goal was set when generated.')
      : (es ? `Basado en ${number(task.remaining_words)} palabras pendientes al generar.` : `Based on ${number(task.remaining_words)} words remaining when generated.`);
    container.append(heading, note);
    if (!Array.isArray(task.outline) || !task.outline.length) return;
    const key = owner && id ? `unoword-task-checklist:${owner}:${id}` : null;
    let checked = [];
    try { checked = key ? JSON.parse(localStorage.getItem(key) || '[]') : []; } catch (_) { /* unavailable device storage */ }
    if (!Array.isArray(checked)) checked = [];
    const list = document.createElement('div'); list.className = 'uw-writing-task-sections';
    task.outline.forEach((section, index) => {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
      input.type = 'checkbox'; input.checked = checked.includes(index);
      text.textContent = `${section.title} — ${number(section.words)} ${es ? 'palabras' : 'words'}`;
      input.addEventListener('change', () => {
        checked = checked.filter(i => i !== index);
        if (input.checked) checked.push(index);
        try { if (key) localStorage.setItem(key, JSON.stringify(checked)); } catch (_) { /* usable in memory */ }
      });
      label.append(input, text); list.append(label);
    });
    const help = document.createElement('p');
    help.textContent = es ? 'Lista de planificación; solo las palabras escritas cuentan para tu meta.' : 'Planning checklist; only typed words count toward your goal.';
    container.append(list, help);
  }
  scope.WCWritingTask = { render };
})(typeof self !== 'undefined' ? self : globalThis);
