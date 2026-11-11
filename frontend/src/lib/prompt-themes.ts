/** Labels match the extension's existing static prompt theme slugs. */
const labels: Record<string, [string, string]> = {
  "personal-experiences": ["Personal experiences", "Experiencias personales"],
  memories: ["Memories", "Recuerdos"], family: ["Family", "Familia"],
  travel: ["Travel", "Viajes"], nature: ["Nature", "Naturaleza"],
  creativity: ["Creativity", "Creatividad"], fiction: ["Fiction", "Ficción"],
  poetry: ["Poetry", "Poesía"], relationships: ["Relationships", "Relaciones"],
  "personal-growth": ["Personal growth", "Crecimiento personal"],
  gratitude: ["Gratitude", "Gratitud"], dreams: ["Dreams", "Sueños"],
  goals: ["Goals", "Metas"], work: ["Work", "Trabajo"], ideas: ["Ideas", "Ideas"],
  philosophy: ["Philosophy", "Filosofía"], "everyday-life": ["Everyday life", "Vida cotidiana"],
  journaling: ["Journaling", "Diario"], storytelling: ["Storytelling", "Narrativa"],
  humor: ["Humor", "Humor"], mystery: ["Mystery", "Misterio"],
  adventure: ["Adventure", "Aventura"], science: ["Science", "Ciencia"],
  history: ["History", "Historia"], culture: ["Culture", "Cultura"],
  food: ["Food", "Comida"], places: ["Places", "Lugares"], people: ["People", "Personas"],
  "surprise-me": ["All themes", "Todos los temas"],
};
export function promptThemeLabel(theme: string, language: string) {
  return labels[theme]?.[language === "es" ? 1 : 0] || theme;
}
