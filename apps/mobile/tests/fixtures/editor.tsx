import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EDITOR_HTML } from "../../src/generated/editor-html";
export const RichEditor = forwardRef(function RichEditor(props: any, ref: any) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const send = (msg: any) =>
    (frame.current?.contentWindow as any)?.unoEditorReceive?.(msg);
  useImperativeHandle(ref, () => ({
    command: (command: string, href?: string) =>
      send({ type: "command", command, href }),
    snapshot: () => send({ type: "snapshot" }),
  }));
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const value = event.data;
      if (value.type === "ready") {
        ready.current = true;
        send({
          type: "load",
          id: props.id,
          content: props.content,
          editable: props.editable,
        });
      }
      if (value.type === "change") props.onChange(value);
      if (value.type === "error") props.onError(value.message);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [props]);
  useEffect(() => {
    if (ready.current) send({ type: "editable", value: props.editable });
  }, [props.editable]);
  const html = EDITOR_HTML.replace(
    "<script>",
    '<script>window.ReactNativeWebView={postMessage:v=>parent.postMessage(JSON.parse(v),"*")};',
  );
  return (
    <iframe
      title="Offline editing canvas"
      ref={frame}
      srcDoc={html}
      style={{
        border: 0,
        width: "100%",
        height: "100%",
        minHeight: 200,
        flex: 1,
      }}
    />
  );
});
