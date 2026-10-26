import type { RPCSchema } from "electrobun/main";
import type { Method, ServiceReply } from "./contracts";
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
    };
    messages: {};
  }>;
  webview: RPCSchema<{ requests: {}; messages: {} }>;
};
