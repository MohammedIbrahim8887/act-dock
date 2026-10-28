import type { RPCSchema } from "electrobun/main";
import type { Method, ServiceReply } from "./contracts";
import type { UpdatePreferences, UpdateState } from "./updates";
export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      service: {
        params: { method: Method; params?: unknown };
        response: ServiceReply;
      };
      chooseFolder: { params: {}; response: string | null };
      chooseFile: { params: {}; response: string | null };
      exportLogs: { params: { runId: string }; response: string | null };
      restartRunner: { params: {}; response: boolean };
      openExternal: { params: { url: string }; response: boolean };
      revealPath: { params: { path: string }; response: boolean };
      getUpdateState: { params: {}; response: UpdateState };
      checkForUpdates: { params: {}; response: UpdateState };
      downloadUpdate: { params: {}; response: UpdateState };
      installUpdate: { params: {}; response: UpdateState };
      postponeUpdate: { params: {}; response: UpdateState };
      setUpdatePreferences: {
        params: Partial<UpdatePreferences>;
        response: UpdateState;
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{ requests: {}; messages: {} }>;
};
