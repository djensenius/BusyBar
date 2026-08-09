import type { RectangleElement } from "@busy-app/busy-lib";
import type { WeatherCondition } from "./weather-client.js";

const TRANSPARENT = "#00000000";
const PANEL = "#05070BCC";
const BOOTH_RED = "#D92532FF";
const BOOTH_RED_DARK = "#7A1118FF";
const BOOTH_GLASS = "#8FD3EBFF";
const BOOTH_SIGN = "#DCECFFFF";
const PHONE = "#10161BFF";
const CLOUD = "#D7E5EFFF";
const CLOUD_SHADOW = "#73889AFF";
const SUN = "#FFD057FF";
const MOON = "#D9EFFFFF";
const RAIN = "#55C9F4FF";
const SNOW = "#F4FBFFFF";
const WIND = "#BDEFFFFF";

type RectSpec = readonly [x: number, y: number, width: number, height: number];

export const frontRectangle = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  radius = 0,
): RectangleElement => ({
  id,
  type: "rectangle",
  x,
  y,
  display: "front",
  align: "top_left",
  width,
  height,
  radius,
  fill: "solid",
  fill_colors: [color],
  border_width: 0,
  border_color: TRANSPARENT,
});

const rectangles = (
  prefix: string,
  color: string,
  specs: readonly RectSpec[],
): RectangleElement[] =>
  specs.map(([x, y, width, height], index) =>
    frontRectangle(`${prefix}-${index}`, x, y, width, height, color),
  );

export type BoothArtMode = "idle" | "active" | "calling" | "recording";

export const boothArtElements = (prefix: string, mode: BoothArtMode): RectangleElement[] => [
  frontRectangle(`${prefix}-panel`, 0, 0, 16, 16, PANEL),
  ...rectangles(`${prefix}-frame`, BOOTH_RED, [
    [2, 0, 12, 2],
    [1, 2, 14, 1],
    [2, 3, 2, 12],
    [12, 3, 2, 12],
    [1, 15, 14, 1],
  ]),
  frontRectangle(`${prefix}-sign-panel`, 3, 1, 10, 2, BOOTH_RED_DARK),
  frontRectangle(
    `${prefix}-sign`,
    5,
    1,
    6,
    1,
    mode === "recording" ? "#FFFFFFFF" : BOOTH_SIGN,
  ),
  frontRectangle(`${prefix}-glass`, 4, 3, 8, 12, BOOTH_GLASS),
  ...rectangles(`${prefix}-bars`, BOOTH_RED_DARK, [
    [7, 3, 1, 12],
    [3, 7, 10, 1],
    [3, 11, 10, 1],
  ]),
  ...rectangles(`${prefix}-phone`, PHONE, [
    [9, 5, 2, 4],
    [8, 5, 1, 1],
    [8, 8, 1, 1],
  ]),
  frontRectangle(`${prefix}-phone-highlight`, 10, 6, 1, 1, BOOTH_SIGN),
  ...(mode === "calling"
    ? rectangles(`${prefix}-ring`, SUN, [
        [14, 4, 1, 2],
        [15, 7, 1, 2],
        [14, 10, 1, 2],
      ])
    : []),
];

export const warningArtElements = (
  prefix: string,
  color = "#FB2C36FF",
): RectangleElement[] => [
  frontRectangle(`${prefix}-panel`, 0, 0, 16, 16, PANEL),
  frontRectangle(`${prefix}-mark`, 7, 3, 2, 7, color),
  frontRectangle(`${prefix}-dot`, 7, 12, 2, 2, color),
];

const iconPanel = (prefix: string): RectangleElement[] => [
  frontRectangle(`${prefix}-panel`, 0, 0, 18, 16, PANEL),
];

const sunElements = (prefix: string): RectangleElement[] => [
  ...rectangles(`${prefix}-body`, SUN, [
    [6, 4, 6, 7],
    [5, 5, 8, 5],
  ]),
  ...rectangles(`${prefix}-rays`, SUN, [
    [8, 1, 2, 2],
    [8, 12, 2, 2],
    [2, 7, 2, 2],
    [14, 7, 2, 2],
    [4, 3, 1, 1],
    [13, 3, 1, 1],
    [4, 12, 1, 1],
    [13, 12, 1, 1],
  ]),
];

const moonElements = (prefix: string): RectangleElement[] => [
  ...rectangles(`${prefix}-moon`, MOON, [
    [7, 2, 3, 1],
    [5, 3, 5, 2],
    [4, 5, 5, 6],
    [5, 11, 5, 2],
    [7, 13, 3, 1],
  ]),
  ...rectangles(`${prefix}-cutout`, PANEL, [
    [8, 3, 4, 2],
    [7, 5, 5, 6],
    [8, 11, 4, 1],
  ]),
  ...rectangles(`${prefix}-stars`, MOON, [
    [2, 3, 1, 1],
    [13, 5, 1, 1],
    [2, 11, 1, 1],
  ]),
];

const cloudElements = (prefix: string, y = 0): RectangleElement[] => [
  ...rectangles(`${prefix}-shadow`, CLOUD_SHADOW, [
    [3, 6 + y, 12, 5],
    [5, 4 + y, 7, 3],
  ]),
  ...rectangles(`${prefix}-light`, CLOUD, [
    [4, 6 + y, 10, 3],
    [6, 5 + y, 5, 2],
  ]),
];

const rainElements = (prefix: string, heavy = false): RectangleElement[] =>
  rectangles(`${prefix}-rain`, RAIN, [
    [4, 11, heavy ? 2 : 1, 4],
    [8, 12, heavy ? 2 : 1, 3],
    [12, 11, heavy ? 2 : 1, 4],
  ]);

const snowElements = (prefix: string): RectangleElement[] =>
  rectangles(`${prefix}-snow`, SNOW, [
    [4, 12, 2, 1],
    [5, 11, 1, 3],
    [10, 12, 2, 1],
    [11, 11, 1, 3],
  ]);

const windElements = (prefix: string, y = 0): RectangleElement[] =>
  rectangles(`${prefix}-wind`, WIND, [
    [2, 4 + y, 11, 1],
    [5, 7 + y, 11, 1],
    [1, 10 + y, 10, 1],
    [12, 3 + y, 3, 1],
    [14, 4 + y, 2, 1],
  ]);

const lightningElements = (prefix: string): RectangleElement[] =>
  rectangles(`${prefix}-bolt`, SUN, [
    [9, 9, 3, 2],
    [8, 11, 3, 2],
    [7, 13, 2, 2],
  ]);

const weatherWarningElements = (prefix: string): RectangleElement[] => [
  frontRectangle(`${prefix}-mark`, 8, 3, 2, 7, "#FB2C36FF"),
  frontRectangle(`${prefix}-dot`, 8, 12, 2, 2, "#FB2C36FF"),
];

export const weatherIconElements = (
  prefix: string,
  condition: WeatherCondition,
): RectangleElement[] => {
  const panel = iconPanel(prefix);
  if (condition === "sunny") return [...panel, ...sunElements(prefix)];
  if (condition === "clear-night") return [...panel, ...moonElements(prefix)];
  if (condition === "partlycloudy") {
    return [
      ...panel,
      ...rectangles(`${prefix}-sun`, SUN, [
        [2, 2, 5, 5],
        [4, 0, 1, 2],
        [0, 4, 2, 1],
      ]),
      ...cloudElements(prefix, 1),
    ];
  }
  if (condition === "cloudy") return [...panel, ...cloudElements(prefix)];
  if (condition === "fog") {
    return [
      ...panel,
      ...cloudElements(prefix, -2),
      ...rectangles(`${prefix}-fog`, CLOUD_SHADOW, [
        [2, 11, 13, 1],
        [5, 14, 11, 1],
      ]),
    ];
  }
  if (condition === "rainy") {
    return [...panel, ...cloudElements(prefix), ...rainElements(prefix)];
  }
  if (condition === "pouring") {
    return [...panel, ...cloudElements(prefix), ...rainElements(prefix, true)];
  }
  if (condition === "snowy") {
    return [...panel, ...cloudElements(prefix), ...snowElements(prefix)];
  }
  if (condition === "snowy-rainy") {
    return [
      ...panel,
      ...cloudElements(prefix),
      ...rectangles(`${prefix}-mix`, RAIN, [
        [4, 11, 1, 4],
        [12, 11, 1, 4],
      ]),
      ...rectangles(`${prefix}-snow`, SNOW, [
        [8, 12, 2, 1],
        [9, 11, 1, 3],
      ]),
    ];
  }
  if (condition === "hail") {
    return [
      ...panel,
      ...cloudElements(prefix),
      ...rectangles(`${prefix}-hail`, MOON, [
        [4, 12, 2, 2],
        [8, 13, 2, 2],
        [12, 12, 2, 2],
      ]),
    ];
  }
  if (condition === "lightning") {
    return [...panel, ...cloudElements(prefix, -1), ...lightningElements(prefix)];
  }
  if (condition === "lightning-rainy") {
    return [
      ...panel,
      ...cloudElements(prefix, -1),
      ...rainElements(prefix),
      ...lightningElements(prefix),
    ];
  }
  if (condition === "windy") return [...panel, ...windElements(prefix)];
  if (condition === "windy-variant") {
    return [...panel, ...cloudElements(prefix, -3), ...windElements(prefix, 4)];
  }
  return [...panel, ...weatherWarningElements(prefix)];
};

export const degreeElement = (
  id: string,
  x: number,
  y: number,
  color: string,
): RectangleElement => ({
  id,
  type: "rectangle",
  x,
  y,
  display: "front",
  align: "top_left",
  width: 4,
  height: 4,
  radius: 1,
  fill: "none",
  fill_colors: [],
  border_width: 1,
  border_color: color,
});
