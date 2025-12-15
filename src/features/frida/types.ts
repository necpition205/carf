export type DeviceInfo = {
  id: string;
  name: string;
  device_type: string;
};

export type ProcessInfo = {
  pid: number;
  name: string;
};

export type SessionInfo = {
  session_id: number;
  script_id: number;
};

export type ScriptInfo = {
  script_id: number;
};

export type SessionDetachReason = "user" | "disposed";

export type SessionAttachedEvent = {
  session_id: number;
  script_id: number;
  device_id: string;
  pid: number;
};

export type SessionDetachedEvent = {
  session_id: number;
  reason: SessionDetachReason;
};

export type ScriptMessageEvent = {
  session_id: number;
  script_id: number;
  message: unknown;
  data?: number[];
};
