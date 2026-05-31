import type { IpcMessage } from "../../shared/types";
import {
  checkForUpdate,
  downloadUpdate,
  applyUpdate,
  type ReleaseInfo,
} from "../updater";
import { saveSettings } from "../settings";
import { CURRENT_VERSION } from "../constants";
import type { HandlerContext } from "./context";

export async function handleUpdater(
  message: IpcMessage,
  ctx: HandlerContext,
): Promise<boolean> {
  const { state, broadcast, recordError } = ctx;

  switch (message.type) {
    case "update:channel:set": {
      state.releaseChannel = message.channel;
      await saveSettings({ releaseChannel: state.releaseChannel });
      broadcast({ type: "update:state", channel: state.releaseChannel });
      return true;
    }

    case "update:check": {
      checkForUpdate(CURRENT_VERSION, state.releaseChannel, (result) => {
        if (result.type === "available") {
          state.pendingUpdate = result.info;
          broadcast({
            type: "update:available",
            version: result.info.version,
            releaseNotes: result.info.releaseNotes,
            downloadUrl: result.info.downloadUrl,
            channel: result.info.channel,
          });
        } else if (result.type === "not-available") {
          broadcast({ type: "update:not-available" });
        } else if (result.type === "error") {
          const msg = "Update check failed: " + result.message;
          recordError("updater:check", msg);
          broadcast({ type: "error", message: msg });
        }
      });
      return true;
    }

    case "update:download": {
      const info: ReleaseInfo = {
        version: message.version,
        releaseNotes: "",
        downloadUrl: message.downloadUrl,
        channel: message.channel,
      };
      downloadUpdate(info, (result) => {
        if (result.type === "progress") {
          broadcast({ type: "update:download:progress", percent: result.percent });
        } else if (result.type === "ready") {
          broadcast({ type: "update:download:done", localPath: result.localPath });
        } else if (result.type === "error") {
          const msg = "Download failed: " + result.message;
          recordError("updater:download", msg);
          broadcast({ type: "error", message: msg });
        }
      });
      return true;
    }

    case "update:apply": {
      await applyUpdate(message.localPath);
      return true;
    }

    default:
      return false;
  }
}
