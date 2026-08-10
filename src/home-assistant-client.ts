import type { HomeAssistantConfig } from "./config.js";

export type SceneActionResult = "activated" | "lightsOff";

export interface SceneLightStatus {
  entityId: string;
  currentState: string;
  currentBrightness: number | null;
  sceneBrightness: number | null;
  matches: boolean;
}

export interface SceneStatus {
  matches: boolean;
  lights: SceneLightStatus[];
}

export interface SceneActionOutcome {
  result: SceneActionResult;
  status: SceneStatus;
}

export interface HomeAssistantSceneClient {
  activateScene(entityId: string): Promise<void>;
  getSceneLightStatus(
    sceneEntityId: string,
    lightEntityIds: readonly string[],
  ): Promise<SceneStatus>;
  activateSceneOrTurnOffLights(
    sceneEntityId: string,
    lightEntityIds: readonly string[],
  ): Promise<SceneActionOutcome>;
}

interface LightState {
  state: string;
  brightness: number | null;
}

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

const brightnessFrom = (input: Record<string, unknown>): number | null => {
  const brightness = input.brightness;
  return typeof brightness === "number" && Number.isFinite(brightness) ? brightness : null;
};

export const createHomeAssistantSceneClient = (
  config: HomeAssistantConfig,
): HomeAssistantSceneClient => {
  const activateScene = async (entityId: string): Promise<void> => {
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
  };

  const readEntityState = async (entityId: string): Promise<LightState> => {
    const response = await fetch(new URL(`/api/states/${entityId}`, config.url), {
      headers: {
        authorization: `Bearer ${config.token}`,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Home Assistant returned ${response.status} while reading ${entityId}`);
    }
    const state: unknown = await response.json();
    if (!isRecord(state) || typeof state.state !== "string" || !isRecord(state.attributes)) {
      throw new Error(`Home Assistant returned an invalid state for ${entityId}`);
    }
    return {
      state: state.state,
      brightness: brightnessFrom(state.attributes),
    };
  };

  const readSceneLightStates = async (
    sceneEntityId: string,
    lightEntityIds: readonly string[],
  ): Promise<LightState[]> => {
    const sceneId = sceneEntityId.replace(/^scene\./, "");
    const response = await fetch(
      new URL(`/api/config/scene/config/${encodeURIComponent(sceneId)}`, config.url),
      {
        headers: {
          authorization: `Bearer ${config.token}`,
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Home Assistant returned ${response.status} while reading ${sceneEntityId}`,
      );
    }
    const scene: unknown = await response.json();
    if (!isRecord(scene)) {
      throw new Error(`Home Assistant returned an invalid configuration for ${sceneEntityId}`);
    }
    const entities = scene.entities;
    if (!isRecord(entities)) {
      throw new Error(`Home Assistant returned an invalid configuration for ${sceneEntityId}`);
    }
    return lightEntityIds.map((entityId) => {
      const state = entities[entityId];
      if (!isRecord(state) || typeof state.state !== "string") {
        throw new Error(`${sceneEntityId} does not define a valid state for ${entityId}`);
      }
      if (state.state !== "on") {
        throw new Error(`${sceneEntityId} does not turn on ${entityId}`);
      }
      return {
        state: state.state,
        brightness: brightnessFrom(state),
      };
    });
  };

  const turnOffLights = async (entityIds: readonly string[]): Promise<void> => {
    const response = await fetch(new URL("/api/services/light/turn_off", config.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ entity_id: entityIds }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(
        `Home Assistant returned ${response.status} while turning off ${entityIds.join(", ")}`,
      );
    }
  };

  const getSceneLightStatus = async (
    sceneEntityId: string,
    lightEntityIds: readonly string[],
  ): Promise<SceneStatus> => {
    const [expectedStates, currentStates] = await Promise.all([
      readSceneLightStates(sceneEntityId, lightEntityIds),
      Promise.all(lightEntityIds.map(readEntityState)),
    ]);
    const lights = lightEntityIds.map((entityId, index): SceneLightStatus => {
      const expected = expectedStates[index];
      const current = currentStates[index];
      if (!expected || !current) {
        throw new Error(`Home Assistant did not return a state for ${entityId}`);
      }
      const matches =
        current.state === expected.state &&
        (expected.brightness === null ||
          (current.brightness !== null &&
            Math.abs(current.brightness - expected.brightness) <= 2));
      return {
        entityId,
        currentState: current.state,
        currentBrightness: current.brightness,
        sceneBrightness: expected.brightness,
        matches,
      };
    });
    return {
      matches: lights.length > 0 && lights.every((light) => light.matches),
      lights,
    };
  };

  const resultingStatus = (
    status: SceneStatus,
    result: SceneActionResult,
  ): SceneStatus => ({
    matches: result === "activated",
    lights: status.lights.map((light) => ({
      ...light,
      currentState: result === "activated" ? "on" : "off",
      currentBrightness: result === "activated" ? light.sceneBrightness : null,
      matches: result === "activated",
    })),
  });

  return {
    activateScene,
    getSceneLightStatus,
    async activateSceneOrTurnOffLights(
      sceneEntityId: string,
      lightEntityIds: readonly string[],
    ): Promise<SceneActionOutcome> {
      const status = await getSceneLightStatus(sceneEntityId, lightEntityIds);
      if (status.matches) {
        await turnOffLights(lightEntityIds);
        return {
          result: "lightsOff",
          status: resultingStatus(status, "lightsOff"),
        };
      }
      await activateScene(sceneEntityId);
      return {
        result: "activated",
        status: resultingStatus(status, "activated"),
      };
    },
  };
};
