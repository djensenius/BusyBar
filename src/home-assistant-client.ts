import type { HomeAssistantConfig } from "./config.js";

export interface HomeAssistantSceneClient {
  activateScene(entityId: string): Promise<void>;
}

export const createHomeAssistantSceneClient = (
  config: HomeAssistantConfig,
): HomeAssistantSceneClient => ({
  async activateScene(entityId: string): Promise<void> {
    const response = await fetch(new URL("/api/services/scene/turn_on", config.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ entity_id: entityId }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Home Assistant returned ${response.status} while activating ${entityId}`);
    }
  },
});
