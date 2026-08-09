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
});
