export type Achievement = {
  id: string;
  name: string;
  description: string;
  category: string;
  metric: string;
  tier: string;
  badge_image: string | null;
  requirement: number;
  progress: number;
  unlocked: boolean;
  earned_on: string | null;
  awarded_at: string | null;
  active: boolean;
};
export type RewardPreferences = {
  user_id: string;
  enabled: boolean;
  celebrations: boolean;
  widget: boolean;
  showcase: string[];
  revision: number;
};
export type Rewards = {
  user_id: string;
  enabled: boolean;
  language: "en" | "es";
  preferences: RewardPreferences;
  achievements: Achievement[];
  totals?: {
    words: number;
    sessions: number;
    seconds: number;
    goals: number;
    streak: number;
  };
  journey?: {
    first_writing_day: string | null;
    first_goal_day: string | null;
    first_document_day: string | null;
  };
  personal_milestones?: {
    kind: string;
    value: number;
    previous_best: number;
    occurred_on: string;
  }[];
};
export const nextAchievement = (data?: Rewards) =>
  data?.achievements
    .filter(
      (a) =>
        !a.unlocked &&
        a.active &&
        ["words", "sessions", "seconds", "goals", "streak"].includes(a.metric),
    )
    .sort(
      (a, b) =>
        b.progress / b.requirement - a.progress / a.requirement ||
        a.requirement - b.requirement,
    )[0];
export const rewardLabels: Record<string, string> = {
  "Rewards & Achievements": "Recompensas y logros",
  "Celebrate your writing milestones at your own pace.":
    "Celebra tus hitos de escritura a tu ritmo.",
  "Enable Writing Rewards": "Activar recompensas de escritura",
  "Achievement Celebrations": "Celebraciones de logros",
  "Show Rewards on Dashboard": "Mostrar recompensas en el panel",
  "Your Next Milestone": "Tu próximo hito",
  "View Rewards": "Ver recompensas",
  "My Writing Journey": "Mi camino de escritura",
  "Recently Unlocked": "Logros recientes",
  "Next Personal Milestones": "Próximos hitos personales",
  "Your Private Showcase": "Tus logros favoritos privados",
  Favorite: "Favorito",
  "Remove favorite": "Quitar favorito",
  Unlocked: "Desbloqueado",
  Locked: "Pendiente",
  "Verified on": "Verificado el",
  Words: "Palabras",
  "Writing Streaks": "Rachas de escritura",
  "Daily Goals": "Metas diarias",
  "Writing Sessions": "Sesiones de escritura",
  "Writing Time": "Tiempo de escritura",
  "Document Completion": "Documentos terminados",
  "Personal Growth": "Crecimiento personal",
  "First writing day": "Primer día de escritura",
  "First completed goal": "Primera meta alcanzada",
  "First completed document": "Primer documento terminado",
  "Total words": "Palabras totales",
  "Completed sessions": "Sesiones terminadas",
  "Active writing hours": "Horas de escritura activa",
  "Every new writing day is another opportunity to begin.":
    "Cada nuevo día de escritura es una oportunidad para comenzar.",
  "You’re building something meaningful, one word at a time.":
    "Estás construyendo algo valioso, palabra a palabra.",
  "Achievement Unlocked!": "¡Logro desbloqueado!",
  "Continue Writing": "Seguir escribiendo",
  Close: "Cerrar",
  "Rewards setup is not available yet.":
    "La configuración de recompensas aún no está disponible.",
  "Settings changed on another device. Refresh and try again.":
    "La configuración cambió en otro dispositivo. Actualiza e inténtalo de nuevo.",
  "Your achievements stay saved while rewards are off.":
    "Tus logros se conservan mientras las recompensas están desactivadas.",
  "Goal achievements use saved daily targets; older goals without evidence are not guessed.":
    "Los logros usan metas diarias registradas; no se inventan metas antiguas sin evidencia.",
  "Monthly growth compares two fully observed, completed months.":
    "El crecimiento mensual compara dos meses completos registrados.",
  "Personal highlights": "Hitos personales",
  "New personal best in your recorded history":
    "Nueva marca personal en tu historial registrado",
  "Choose up to three earned badges. Only you can see them.":
    "Elige hasta tres logros. Solo tú puedes verlos.",
  "Your personal journey has no comparisons or penalties.":
    "Tu camino personal no tiene comparaciones ni penalizaciones.",
};

export function rewardProgress(a: Achievement, language = "en") {
  const hours = a.metric === "seconds";
  const divisor = hours ? 3600 : 1;
  const number = (n: number) =>
    (n / divisor).toLocaleString(language, {
      maximumFractionDigits: hours ? 2 : 0,
    });
  const en: Record<string, string> = {
    words: "words",
    seconds: "active hours",
    sessions: "sessions",
    goals: "goal days",
    streak: "consecutive days",
    documents: "documents",
    return_days: "days",
    goal_weeks: "weeks",
  };
  const es: Record<string, string> = {
    words: "palabras",
    seconds: "horas activas",
    sessions: "sesiones",
    goals: "metas diarias",
    streak: "días consecutivos",
    documents: "documentos",
    return_days: "días",
    goal_weeks: "semanas",
  };
  return `${number(Math.min(a.progress, a.requirement))} / ${number(a.requirement)} ${(language === "es" ? es : en)[a.metric] || ""}`.trim();
}
