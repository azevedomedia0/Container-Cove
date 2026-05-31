import type { DockerApp, IpcMessage } from "../../shared/types";
import { saveRegistry } from "../registry";
import type { HandlerContext } from "./context";

export async function handleRegistry(
  message: IpcMessage,
  ctx: HandlerContext,
): Promise<boolean> {
  const { state, broadcast, recordError, broadcastOgImages } = ctx;

  switch (message.type) {
    case "registry:export": {
      const serializable = state.apps.map(
        ({ status: _s, containerId: _c, ...rest }) => rest,
      );
      broadcast({ type: "registry:exported", json: JSON.stringify(serializable, null, 2) });
      return true;
    }

    case "registry:import": {
      try {
        const parsed = JSON.parse(message.json) as Omit<
          DockerApp,
          "status" | "containerId"
        >[];
        state.apps = parsed.map((a) => ({ ...a, status: "stopped" as const }));
        await saveRegistry(state.apps);
        broadcast({ type: "apps:list", apps: state.apps });
        broadcastOgImages();
      } catch (err) {
        const msg = "Import failed: " + String(err);
        recordError("registry:import", msg);
        broadcast({ type: "error", message: msg });
      }
      return true;
    }

    case "app:reorder": {
      const idOrder = new Map(message.ids.map((id, i) => [id, i]));
      state.apps = state.apps
        .map((a) => ({ ...a, sortOrder: idOrder.get(a.id) ?? a.sortOrder ?? 999 }))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      await saveRegistry(state.apps);
      broadcast({ type: "apps:list", apps: state.apps });
      return true;
    }

    default:
      return false;
  }
}
