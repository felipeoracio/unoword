import { useState } from "react";
import { StudioButton, StudioCard, StudioContainer, StudioLink } from "@/components/studio/StudioPrimitives";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverDescription } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import "@/styles/motion-preview.css";

/** Preview-only: actual shared components, local state, no product/API operations. */
export default function MotionPreview() {
  const [clicks, setClicks] = useState(0);
  const [choice, setChoice] = useState("Morning");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  return (
    <main className="uw-design-system uw-motion-preview" data-studio-theme={theme}>
      <StudioContainer>
        <p className="uw-studio-eyebrow">PHASE 1 · REVIEW PREVIEW</p>
        <h1>A quieter kind of motion.</h1>
        <p>Shared controls respond gently and immediately. Focus Mode and project switching are reserved for separate, functional editor testing in Phases 2 and 3.</p>
        <p>These are component samples with local state. Nothing here changes documents, sessions, AI context, or subscriptions.</p>
        <div className="uw-motion-preview-actions">
          <StudioLink to="/">View landing page</StudioLink>
          <StudioButton variant="outline" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Toggle sample theme</StudioButton>
        </div>
        <div className="uw-motion-preview-grid">
          <StudioCard>
            <h2>Immediate feedback</h2>
            <p>Click, press Space, or press Enter. The action runs immediately; color and press feedback settle in 120ms.</p>
            <StudioButton onClick={() => setClicks(v => v + 1)}>Try feedback</StudioButton>
            <StudioButton disabled>Unavailable action</StudioButton>
            <p role="status">Actions: {clicks}</p>
          </StudioCard>
          <StudioCard>
            <h2>Menu and submenu</h2>
            <p>A small fade and 4px entrance. Use arrows, Home/End, Escape, or click outside. Focus returns to the trigger.</p>
            <DropdownMenu>
              <DropdownMenuTrigger render={<StudioButton variant="outline" />}>Open sample menu</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setClicks(v => v + 1)}>Count an action</DropdownMenuItem>
                <DropdownMenuItem disabled>Unavailable menu action</DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setClicks(v => v + 1)}>Count another action</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          </StudioCard>
          <StudioCard>
            <h2>Choice without drift</h2>
            <p>An aligned select stays anchored to the chosen item. The existing native project selectors remain unchanged.</p>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger aria-label="Sample writing time"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Morning", "Afternoon", "Evening"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <p>Selected: {choice}</p>
          </StudioCard>
          <StudioCard>
            <h2>Small supporting panel</h2>
            <p>180ms entrance, 140ms exit. No artificial wait before controls can be used.</p>
            <Popover>
              <PopoverTrigger render={<StudioButton variant="outline" />}>Open sample popover</PopoverTrigger>
              <PopoverContent>
                <PopoverTitle>Writing reminder</PopoverTitle>
                <PopoverDescription>A local sample, with no changes to your writing.</PopoverDescription>
                <StudioButton onClick={() => setClicks(v => v + 1)}>Count a panel action</StudioButton>
              </PopoverContent>
            </Popover>
          </StudioCard>
          <StudioCard>
            <h2>A considered dialog</h2>
            <p>The dialog settles in 260ms. Keyboard focus and Escape remain controlled by Base UI, with no timer added to the action.</p>
            <Dialog>
              <DialogTrigger render={<StudioButton variant="outline" />}>Open sample dialog</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>A moment to begin</DialogTitle>
                  <DialogDescription>Try typing, Tab, Shift+Tab and Escape. This field is temporary and is never saved.</DialogDescription>
                </DialogHeader>
                <label className="uw-motion-preview-field">A sample thought<input placeholder="One small beginning…" /></label>
                <DialogClose render={<StudioButton />}>Done</DialogClose>
              </DialogContent>
            </Dialog>
          </StudioCard>
          <StudioCard>
            <h2>Your motion preference</h2>
            <p>Enable Reduce Motion in your operating system or browser accessibility tools. Movement and transitions stop, including menus and dialogs rendered outside this page’s container.</p>
            <p>Keyboard focus indicators stay immediate. No page reveal, typing animation, loading delay, or continuous decorative loop has been added.</p>
          </StudioCard>
        </div>
      </StudioContainer>
    </main>
  );
}
