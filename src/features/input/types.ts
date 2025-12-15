export type Modifiers = {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
};

export type KeyAction = "press" | "release";

export type GlobalKeyEvent = {
  action: KeyAction;
  key: string;
  name: string | null;
  modifiers: Modifiers;
};

export type ListenErrorEvent = {
  error: string;
};
