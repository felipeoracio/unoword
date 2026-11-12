import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Platform, type ModalProps } from "react-native";
import { observeReducedMotion } from "./reduced-motion";
import { motion } from "./motion-tokens";
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => observeReducedMotion(AccessibilityInfo, setReduced), []);
  return reduced;
}
function useOpacity(identity: string, enabled = true) {
  const reduced = useReducedMotion(), opacity = useRef(new Animated.Value(1)).current;
  const previous = useRef(identity);
  useEffect(() => {
    const changed = previous.current !== identity;
    previous.current = identity;
    opacity.stopAnimation(); opacity.setValue(1);
    if (reduced || !changed || !enabled) return;
    opacity.setValue(0.98);
    const animation = Animated.timing(opacity, { toValue: 1, duration: motion.duration.panel,
      easing: Easing.bezier(...motion.easing.enterEase), useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [identity, enabled, opacity, reduced]);
  return opacity;
}
/** Immediate platform close avoids an exit animation trapping an invisible overlay
 * when Reduce Motion changes. The retained content has a native-driver entrance. */
export function StudioModal(props: ModalProps) {
  const visible = props.visible !== false;
  const opacity = useOpacity(visible ? "open" : "closed", visible && Platform.OS !== "web");
  // Keep RN Web's existing immediate modal path. Its animated dismissal can
  // retain an invisible portal when the motion preference changes mid-exit.
  if (Platform.OS === "web") return <Modal {...props} animationType="none" />;
  return <Modal {...props} animationType="none"><Animated.View style={{ flex: 1, opacity }}>{props.children}</Animated.View></Modal>;
}
/** Retain children; cue actual view changes, never authored input or counters. */
export function MotionSurface({ identity, children }: { identity: string; children: React.ReactNode }) {
  const opacity = useOpacity(identity);
  return <Animated.View style={{ opacity, gap: 10 }}>{children}</Animated.View>;
}
