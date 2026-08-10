import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createHomeAssistantSceneClient } from "../src/home-assistant-client.js";

describe("Home Assistant scene client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("activates a scene through the Home Assistant service API", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("[]", { status: 200 })));
    vi.stubGlobal("fetch", fetch);
    const client = createHomeAssistantSceneClient({
      url: "https://homeassistant.example.com",
      token: "ha-token",
    });

    await client.activateScene("scene.comfy");

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://homeassistant.example.com/api/services/scene/turn_on"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ entity_id: "scene.comfy" }),
        headers: {
          authorization: "Bearer ha-token",
          "content-type": "application/json",
        },
      }),
    );
  });

  it("surfaces Home Assistant service failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 503 }))),
    );
    const client = createHomeAssistantSceneClient({
      url: "https://homeassistant.example.com",
      token: "ha-token",
    });

    await expect(client.activateScene("scene.good_night")).rejects.toThrow(
      "Home Assistant returned 503",
    );
  });

  it("turns off configured lights when they match the scene brightness", async () => {
    const lights = ["light.kitchen_island_lights", "light.kitchen_main_lights"] as const;
    const brightnessByLight = new Map([
      [lights[0], 45],
      [lights[1], 91],
    ]);
    const fetch = vi.fn((input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("/api/config/scene/config/comfy")) {
        return Promise.resolve(
          Response.json({
            entities: Object.fromEntries(
              lights.map((entityId) => [
                entityId,
                { state: "on", brightness: brightnessByLight.get(entityId) },
              ]),
            ),
          }),
        );
      }
      if (url.includes("/api/states/")) {
        const entityId = lights.find((light) => url.endsWith(light));
        return Promise.resolve(
          Response.json({
            state: "on",
            attributes: { brightness: entityId ? brightnessByLight.get(entityId) : null },
          }),
        );
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetch);
    const client = createHomeAssistantSceneClient({
      url: "https://homeassistant.example.com",
      token: "ha-token",
    });

    const outcome = await client.activateSceneOrTurnOffLights("scene.comfy", lights);

    expect(outcome.result).toBe("lightsOff");
    expect(outcome.status).toMatchObject({
      matches: false,
      lights: [
        { entityId: lights[0], currentState: "off", currentBrightness: null },
        { entityId: lights[1], currentState: "off", currentBrightness: null },
      ],
    });
    expect(fetch).toHaveBeenLastCalledWith(
      new URL("https://homeassistant.example.com/api/services/light/turn_off"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ entity_id: lights }),
      }),
    );
  });

  it("activates the scene when a light is on at a different brightness", async () => {
    const lights = ["light.kitchen_island_lights", "light.kitchen_main_lights"] as const;
    const fetch = vi.fn((input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("/api/config/scene/config/comfy")) {
        return Promise.resolve(
          Response.json({
            entities: {
              [lights[0]]: { state: "on", brightness: 45 },
              [lights[1]]: { state: "on", brightness: 91 },
            },
          }),
        );
      }
      if (url.includes("/api/states/")) {
        return Promise.resolve(
          Response.json({
            state: "on",
            attributes: {
              brightness: url.endsWith(lights[0]) ? 200 : 91,
            },
          }),
        );
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetch);
    const client = createHomeAssistantSceneClient({
      url: "https://homeassistant.example.com",
      token: "ha-token",
    });

    const outcome = await client.activateSceneOrTurnOffLights("scene.comfy", lights);

    expect(outcome.result).toBe("activated");
    expect(outcome.status).toMatchObject({
      matches: true,
      lights: [
        { entityId: lights[0], currentState: "on", currentBrightness: 45 },
        { entityId: lights[1], currentState: "on", currentBrightness: 91 },
      ],
    });
    expect(fetch).toHaveBeenLastCalledWith(
      new URL("https://homeassistant.example.com/api/services/scene/turn_on"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ entity_id: "scene.comfy" }),
      }),
    );
  });
});
