import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  createStudyFullscreenController,
  type StudyFullscreenController,
  type StudyFullscreenSnapshot,
} from "./studyFullscreen";
import "./fullscreen.css";

export type StudyFullscreenControls = {
  ref: RefObject<HTMLDivElement | null>;
  request: () => void;
  leave: () => void;
  toggle: () => void;
  status: StudyFullscreenSnapshot["status"];
  isFullscreen: boolean;
  message: string;
};

/**
 * Keeps fullscreen requests tied to direct user gestures. `activeFocus` only
 * manages cleanup; it never starts a request on mount or route restoration.
 */
export function useStudyFullscreen(activeFocus: boolean): StudyFullscreenControls {
  const ref = useRef<HTMLDivElement | null>(null);
  const controller = useRef<StudyFullscreenController | null>(null);
  const [snapshot, setSnapshot] = useState<StudyFullscreenSnapshot>({
    status: "idle",
    isFullscreen: false,
    message: "",
  });

  useEffect(() => {
    const instance = createStudyFullscreenController(
      document,
      () => ref.current,
      setSnapshot,
    );
    controller.current = instance;
    return () => {
      instance.dispose();
      if (controller.current === instance) controller.current = null;
    };
  }, []);

  useEffect(() => {
    controller.current?.setActiveFocus(activeFocus);
  }, [activeFocus]);

  const request = useCallback(() => controller.current?.request(), []);
  const leave = useCallback(() => controller.current?.leave(), []);
  const toggle = useCallback(() => controller.current?.toggle(), []);

  return {
    ref,
    request,
    leave,
    toggle,
    status: snapshot.status,
    isFullscreen: snapshot.isFullscreen,
    message: snapshot.message,
  };
}
