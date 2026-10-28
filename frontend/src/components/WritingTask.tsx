import { useEffect, useRef } from "react";
import type { WritingTask as Task } from "@/lib/writing";
import "../../../extension/shared/writing-task.js";
import "../../../extension/shared/writing-task.css";

export default function WritingTask({
  task,
  owner,
  id,
  language,
}: {
  task?: Task;
  owner: string;
  id: string;
  language: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current)
      (
        globalThis as unknown as {
          WCWritingTask: {
            render(
              container: HTMLElement,
              task: Task | undefined,
              options: object,
            ): void;
          };
        }
      ).WCWritingTask.render(ref.current, task, { owner, id, language });
  }, [task, owner, id, language]);
  return <div ref={ref} hidden={!task} />;
}
