import { memo, useEffect, useMemo, useRef } from "react";
import type { Project } from "../../../../shared/projects";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

/** Keep Base UI's popup/registry out of the editor's per-keystroke render path. */
const ProjectPicker = memo(function ProjectPicker({ projects, active, busy, ready, theme, es, onSwitch }: {
  projects?: Project[];
  active: string | null;
  busy: boolean;
  ready: boolean;
  theme: string;
  es: boolean;
  onSwitch: (id: string | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  useEffect(() => {
    if (!busy && restore.current) {
      restore.current = false;
      if (document.activeElement === document.body) trigger.current?.focus({ preventScroll: true });
    }
  }, [busy]);
  const choices = useMemo(() => [
    { value: "", label: es ? "Escritura general" : "General Writing" },
    ...(projects?.filter(project => project.status !== "archived").map(project => ({ value: project.id, label: project.name })) || []),
  ], [projects, es]);
  const label = projects?.find(project => project.id === active)?.name || choices[0].label;
  return (
    <Select items={choices} value={active || ""} disabled={busy || !ready}
      onValueChange={value => { restore.current = true; onSwitch(value || null); }}>
      <SelectTrigger ref={trigger} className="uw-project-picker"
        aria-label={es ? "Proyecto activo" : "Active project"}
        aria-busy={busy || undefined} data-project-value={active || ""}>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start"
        className="uw-design-system uw-project-picker-popup"
        data-studio-theme={theme === "dark" ? "dark" : "light"}>
        {choices.map(choice => <SelectItem key={choice.value} value={choice.value}
          data-project-id={choice.value}>{choice.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
});
export default ProjectPicker;
