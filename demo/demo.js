const DISPLAY_WIDTH = 72;
const DISPLAY_HEIGHT = 16;
const BACKING_SCALE = 8;

const COLORS = {
  blueDark: "#003b7a",
  amber: "#faab00",
  amberDark: "#865b00",
  cyan: "#00c8ff",
  cyanDark: "#006a85",
  red: "#fb2c36",
  redDark: "#7a1118",
  violet: "#a855f7",
  violetDark: "#4c1d95",
  slate: "#34445c",
  slateDark: "#101827",
  yellow: "#ffd057",
  ice: "#d9efff",
  black: "#041616",
  white: "#ffffff",
};

const weatherStyle = (condition) => {
  if (condition === "sunny" || condition === "partlycloudy") {
    return {
      start: COLORS.blueDark,
      end: COLORS.cyanDark,
      accent: "#dfaf38",
      accentText: "#2a1b00",
    };
  }
  if (condition === "clear-night") {
    return {
      start: COLORS.slateDark,
      end: COLORS.blueDark,
      accent: "#5aa3c2",
      accentText: "#06131d",
    };
  }
  if (
    condition === "rainy" ||
    condition === "pouring" ||
    condition === "lightning-rainy"
  ) {
    return {
      start: COLORS.blueDark,
      end: COLORS.cyanDark,
      accent: "#278eb7",
      accentText: "#03151e",
    };
  }
  if (
    condition === "snowy" ||
    condition === "snowy-rainy" ||
    condition === "hail"
  ) {
    return {
      start: COLORS.slateDark,
      end: COLORS.slate,
      accent: "#8ab6cc",
      accentText: COLORS.slateDark,
    };
  }
  if (condition === "lightning") {
    return {
      start: COLORS.violetDark,
      end: COLORS.slateDark,
      accent: COLORS.yellow,
      accentText: "#2a1b00",
    };
  }
  if (condition === "exceptional") {
    return {
      start: COLORS.redDark,
      end: COLORS.red,
      accent: COLORS.red,
      accentText: COLORS.white,
    };
  }
  return {
    start: COLORS.slateDark,
    end: COLORS.slate,
    accent: "#6f8fa3",
    accentText: COLORS.white,
  };
};

const standardDetail = (top, bottom, degree = false) => ({
  kind: "standard",
  top,
  bottom,
  degree,
});

const highLowDetail = (high, low) => ({
  kind: "highLow",
  high: String(high),
  low: String(low),
});

const weatherSamples = [
  {
    name: "Clear night",
    condition: "clear-night",
    temperature: 21,
    detail: highLowDetail(25, 15),
  },
  {
    name: "Cloudy",
    condition: "cloudy",
    temperature: 18,
    detail: highLowDetail(20, 13),
  },
  {
    name: "Exceptional",
    condition: "exceptional",
    temperature: 32,
    detail: standardDetail("HUMID", "88%"),
  },
  {
    name: "Fog",
    condition: "fog",
    temperature: 15,
    detail: highLowDetail(17, 12),
  },
  {
    name: "Hail",
    condition: "hail",
    temperature: 2,
    detail: standardDetail("MIX", "70%"),
  },
  {
    name: "Lightning",
    condition: "lightning",
    temperature: 24,
    detail: standardDetail("RAIN", "60%"),
  },
  {
    name: "Lightning and rain",
    condition: "lightning-rainy",
    temperature: 23,
    detail: standardDetail("RAIN", "90%"),
  },
  {
    name: "Partly cloudy",
    condition: "partlycloudy",
    temperature: 22,
    detail: highLowDetail(24, 16),
  },
  {
    name: "Pouring",
    condition: "pouring",
    temperature: 17,
    detail: standardDetail("RAIN", "100%"),
  },
  {
    name: "Rainy",
    condition: "rainy",
    temperature: 6,
    detail: standardDetail("RAIN", "70%"),
  },
  {
    name: "Snowy",
    condition: "snowy",
    temperature: -8,
    detail: standardDetail("FEELS", "-14", true),
  },
  {
    name: "Snow and rain",
    condition: "snowy-rainy",
    temperature: 1,
    detail: standardDetail("MIX", "80%"),
  },
  {
    name: "Sunny",
    condition: "sunny",
    temperature: 21,
    detail: highLowDetail(24, 15),
  },
  {
    name: "Windy",
    condition: "windy",
    temperature: 16,
    detail: standardDetail("FEELS", "11", true),
  },
  {
    name: "Windy and cloudy",
    condition: "windy-variant",
    temperature: 14,
    detail: highLowDetail(16, 9),
  },
].map((sample) => ({
  kind: "weather",
  name: `Weather - ${sample.name}`,
  ...sample,
  ...weatherStyle(sample.condition),
}));

const designs = [
  {
    kind: "booth",
    name: "Idle - pickups today",
    label: "PICK",
    period: "DAY",
    value: "12",
    start: COLORS.blueDark,
    end: COLORS.cyanDark,
    accent: COLORS.cyan,
    accentText: COLORS.black,
    mode: "idle",
  },
  {
    kind: "booth",
    name: "Idle - messages today",
    label: "MSGS",
    period: "DAY",
    value: "18",
    start: COLORS.violetDark,
    end: COLORS.violet,
    accent: COLORS.violet,
    accentText: COLORS.black,
    mode: "idle",
  },
  {
    kind: "booth",
    name: "Idle - pickups overall",
    label: "PICK",
    period: "ALL",
    value: "342",
    start: COLORS.blueDark,
    end: COLORS.cyanDark,
    accent: COLORS.cyan,
    accentText: COLORS.black,
    mode: "idle",
  },
  {
    kind: "booth",
    name: "Idle - messages overall",
    label: "MSGS",
    period: "ALL",
    value: "187",
    start: COLORS.violetDark,
    end: COLORS.violet,
    accent: COLORS.violet,
    accentText: COLORS.black,
    mode: "idle",
  },
  {
    kind: "booth",
    name: "Idle - no selection today",
    label: "NO SEL",
    period: "DAY",
    value: "3",
    start: COLORS.amberDark,
    end: COLORS.amber,
    accent: COLORS.amber,
    accentText: COLORS.black,
    mode: "idle",
  },
  {
    kind: "booth",
    name: "Idle - wrong numbers today",
    label: "WRONG",
    period: "DAY",
    value: "5",
    start: COLORS.redDark,
    end: COLORS.red,
    accent: COLORS.red,
    accentText: COLORS.white,
    mode: "idle",
  },
  {
    kind: "booth",
    name: "Idle - messages left today",
    label: "LEFT",
    period: "DAY",
    value: "4",
    start: COLORS.violetDark,
    end: COLORS.violet,
    accent: COLORS.violet,
    accentText: COLORS.black,
    mode: "idle",
  },
  {
    kind: "booth",
    name: "Idle - messages listened today",
    label: "LISTEN",
    period: "DAY",
    value: "7",
    start: COLORS.blueDark,
    end: COLORS.cyanDark,
    accent: COLORS.cyan,
    accentText: COLORS.black,
    mode: "idle",
  },
  {
    kind: "booth",
    name: "Idle - instructions heard today",
    label: "INSTR",
    period: "DAY",
    value: "6",
    start: COLORS.slateDark,
    end: COLORS.slate,
    accent: COLORS.yellow,
    accentText: COLORS.black,
    mode: "idle",
  },
  {
    kind: "clock",
    name: "Clock - 24 hour",
    start: COLORS.blueDark,
    end: COLORS.cyanDark,
    accent: COLORS.cyan,
    accentText: COLORS.black,
  },
  ...weatherSamples,
  {
    kind: "booth",
    name: "Active - calling",
    label: "CALLING",
    start: COLORS.amberDark,
    end: COLORS.amber,
    accent: COLORS.amber,
    mode: "calling",
  },
  {
    kind: "booth",
    name: "Active - recording",
    label: "RECORDING",
    start: COLORS.redDark,
    end: COLORS.red,
    accent: COLORS.red,
    mode: "recording",
  },
  {
    kind: "scene",
    name: "Scene - comfy",
    label: "COMFY",
  },
  {
    kind: "problem",
    name: "Problem - offline",
    label: "OFFLINE",
    start: COLORS.redDark,
    end: COLORS.red,
    accent: COLORS.red,
  },
];

const frames = document.querySelector("#frames");

const gradient = (context, start, end) => {
  const fill = context.createLinearGradient(0, 0, 72, 0);
  fill.addColorStop(0, start);
  fill.addColorStop(1, end);
  return fill;
};

const drawBooth = (context, mode, blink) => {
  const sign = mode === "recording" && blink ? COLORS.white : "#dcecff";

  context.fillStyle = "#05070bcc";
  context.fillRect(0, 0, 16, 16);

  context.fillStyle = "#d92532";
  context.fillRect(2, 0, 12, 2);
  context.fillRect(1, 2, 14, 1);
  context.fillRect(2, 3, 2, 12);
  context.fillRect(12, 3, 2, 12);
  context.fillRect(1, 15, 14, 1);

  context.fillStyle = "#7a1118";
  context.fillRect(3, 1, 10, 2);
  context.fillStyle = sign;
  context.fillRect(5, 1, 6, 1);

  context.fillStyle = "#8fd3eb";
  context.fillRect(4, 3, 8, 12);
  context.fillStyle = "#7a1118";
  context.fillRect(7, 3, 1, 12);
  context.fillRect(3, 7, 10, 1);
  context.fillRect(3, 11, 10, 1);

  context.fillStyle = "#10161b";
  context.fillRect(9, 5, 2, 4);
  context.fillRect(8, 5, 1, 1);
  context.fillRect(8, 8, 1, 1);
  context.fillStyle = "#dcecff";
  context.fillRect(10, 6, 1, 1);

  if (mode === "calling" && blink) {
    context.fillStyle = COLORS.yellow;
    context.fillRect(14, 4, 1, 2);
    context.fillRect(15, 7, 1, 2);
    context.fillRect(14, 10, 1, 2);
  }
};

const drawBoothText = (context, design) => {
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = COLORS.white;

  if (design.value) {
    const labelFontSize =
      design.label.length > 7 ? 5 : design.label.length > 5 ? 6 : 7;
    context.font = `bold ${labelFontSize}px monospace`;
    context.textBaseline = "top";
    context.fillText(design.label, 18, 1);
    context.font = "bold 4px monospace";
    context.fillText(design.period, 18, 10);

    context.fillStyle = design.accent;
    context.fillRect(53, 0, 19, 16);
    context.fillStyle = design.accentText;
    context.textBaseline = "middle";
    context.font =
      design.value.length > 2 ? "bold 7px monospace" : "bold 10px monospace";
    context.textAlign = "center";
    context.fillText(design.value, 62.5, 8);
    return;
  }

  context.font = design.label.length > 7 ? "bold 7px monospace" : "bold 8px monospace";
  context.textAlign = "center";
  context.fillText(design.label, 44, 8);
};

const drawDegree = (context, x, y, color) => {
  context.fillStyle = color;
  context.fillRect(x + 1, y, 2, 1);
  context.fillRect(x, y + 1, 1, 2);
  context.fillRect(x + 3, y + 1, 1, 2);
  context.fillRect(x + 1, y + 3, 2, 1);
};

const drawClock = (context, design) => {
  const now = new Date();
  const timeZone = "America/Toronto";
  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
  })
    .format(now)
    .toUpperCase();
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    month: "short",
  })
    .format(now)
    .toUpperCase();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    day: "2-digit",
  }).format(now);

  context.fillStyle = gradient(context, design.start, design.end);
  context.fillRect(0, 0, 72, 16);
  context.fillStyle = design.accent;
  context.fillRect(44, 0, 28, 16);
  context.fillStyle = COLORS.blueDark;
  context.fillRect(44, 0, 1, 16);

  context.fillStyle = COLORS.white;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 11px monospace";
  context.fillText(time, 22, 8);

  context.fillStyle = design.accentText;
  context.textBaseline = "top";
  context.font = "bold 4px monospace";
  context.fillText(weekday, 58, 1);
  context.font = "bold 5px monospace";
  context.fillText(`${month} ${day}`, 58, 9);
};

const drawWeatherIcon = (context, condition, blink) => {
  context.fillStyle = "#05070bcc";
  context.fillRect(0, 0, 18, 16);

  const drawSun = () => {
    context.fillStyle = COLORS.yellow;
    context.fillRect(6, 4, 6, 7);
    context.fillRect(5, 5, 8, 5);
    context.fillRect(8, 1, 2, 2);
    context.fillRect(8, 12, 2, 2);
    context.fillRect(2, 7, 2, 2);
    context.fillRect(14, 7, 2, 2);
    context.fillRect(4, 3, 1, 1);
    context.fillRect(13, 3, 1, 1);
    context.fillRect(4, 12, 1, 1);
    context.fillRect(13, 12, 1, 1);
  };

  const drawMoon = () => {
    context.fillStyle = COLORS.ice;
    context.fillRect(7, 2, 3, 1);
    context.fillRect(5, 3, 5, 2);
    context.fillRect(4, 5, 5, 6);
    context.fillRect(5, 11, 5, 2);
    context.fillRect(7, 13, 3, 1);
    context.fillStyle = "#05070c";
    context.fillRect(8, 3, 4, 2);
    context.fillRect(7, 5, 5, 6);
    context.fillRect(8, 11, 4, 1);
    context.fillStyle = COLORS.ice;
    context.fillRect(2, 3, 1, 1);
    context.fillRect(13, 5, 1, 1);
    context.fillRect(2, 11, 1, 1);
  };

  const drawCloud = (y = 0) => {
    context.fillStyle = "#73889a";
    context.fillRect(3, 6 + y, 12, 5);
    context.fillRect(5, 4 + y, 7, 3);
    context.fillStyle = "#d7e5ef";
    context.fillRect(4, 6 + y, 10, 3);
    context.fillRect(6, 5 + y, 5, 2);
  };

  const drawRain = (heavy = false) => {
    const offset = blink ? 0 : 1;
    context.fillStyle = "#55c9f4";
    context.fillRect(4, 11 + offset, heavy ? 2 : 1, 4);
    context.fillRect(8, 12 - offset, heavy ? 2 : 1, 3);
    context.fillRect(12, 11 + offset, heavy ? 2 : 1, 4);
  };

  const drawSnow = () => {
    const offset = blink ? 0 : 1;
    context.fillStyle = "#f4fbff";
    context.fillRect(4, 12 + offset, 2, 1);
    context.fillRect(5, 11 + offset, 1, 3);
    context.fillRect(10, 12 - offset, 2, 1);
    context.fillRect(11, 11 - offset, 1, 3);
  };

  const drawWind = (y = 0) => {
    context.fillStyle = "#bdefff";
    context.fillRect(2, 4 + y, 11, 1);
    context.fillRect(5, 7 + y, 11, 1);
    context.fillRect(1, 10 + y, 10, 1);
    context.fillRect(12, 3 + y, 3, 1);
    context.fillRect(14, 4 + y, 2, 1);
  };

  const drawLightning = () => {
    context.fillStyle = COLORS.yellow;
    context.fillRect(9, 9, 3, 2);
    context.fillRect(8, 11, 3, 2);
    context.fillRect(7, 13, 2, 2);
  };

  if (condition === "sunny") {
    drawSun();
    return;
  }
  if (condition === "clear-night") {
    drawMoon();
    return;
  }
  if (condition === "partlycloudy") {
    context.fillStyle = COLORS.yellow;
    context.fillRect(2, 2, 5, 5);
    context.fillRect(4, 0, 1, 2);
    context.fillRect(0, 4, 2, 1);
    drawCloud(1);
    return;
  }
  if (condition === "cloudy") {
    drawCloud();
    return;
  }
  if (condition === "fog") {
    drawCloud(-2);
    context.fillStyle = "#73889a";
    context.fillRect(2, 11, 13, 1);
    context.fillRect(5, 14, 11, 1);
    return;
  }
  if (condition === "rainy") {
    drawCloud();
    drawRain();
    return;
  }
  if (condition === "pouring") {
    drawCloud();
    drawRain(true);
    return;
  }
  if (condition === "snowy") {
    drawCloud();
    drawSnow();
    return;
  }
  if (condition === "snowy-rainy") {
    drawCloud();
    context.fillStyle = "#55c9f4";
    context.fillRect(4, 11, 1, 4);
    context.fillRect(12, 11, 1, 4);
    context.fillStyle = "#f4fbff";
    context.fillRect(8, 12, 2, 1);
    context.fillRect(9, 11, 1, 3);
    return;
  }
  if (condition === "hail") {
    drawCloud();
    context.fillStyle = COLORS.ice;
    context.fillRect(4, 12, 2, 2);
    context.fillRect(8, 13, 2, 2);
    context.fillRect(12, 12, 2, 2);
    return;
  }
  if (condition === "lightning") {
    drawCloud(-1);
    drawLightning();
    return;
  }
  if (condition === "lightning-rainy") {
    drawCloud(-1);
    drawRain();
    drawLightning();
    return;
  }
  if (condition === "windy") {
    drawWind();
    return;
  }
  if (condition === "windy-variant") {
    drawCloud(-3);
    drawWind(4);
    return;
  }

  context.fillStyle = blink ? COLORS.white : COLORS.red;
  context.fillRect(8, 3, 2, 7);
  context.fillRect(8, 12, 2, 2);
};

const drawWeather = (context, design, blink) => {
  context.fillStyle = gradient(context, design.start, design.end);
  context.fillRect(0, 0, 72, 16);
  drawWeatherIcon(context, design.condition, blink);

  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = COLORS.white;
  context.font = "bold 11px monospace";
  const temperature = String(design.temperature);
  const temperatureWidth = context.measureText(temperature).width;
  const temperatureX = 30 - (temperatureWidth + 5) / 2;
  context.fillText(temperature, temperatureX, 8);
  drawDegree(context, Math.round(temperatureX + temperatureWidth + 1), 3, COLORS.white);

  context.fillStyle = design.accent;
  context.fillRect(50, 0, 22, 16);
  context.fillStyle = design.accentText;

  if (design.detail.kind === "highLow") {
    context.textBaseline = "top";
    context.textAlign = "left";
    context.font = "bold 5px monospace";
    context.fillText("H", 53, 1);
    context.fillText("L", 53, 10);

    context.textAlign = "right";
    context.font = "bold 7px monospace";
    context.fillText(design.detail.high, 70, 0);
    context.fillText(design.detail.low, 70, 9);
    return;
  }

  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = "bold 5px monospace";
  context.fillText(design.detail.top, 61, 1);

  context.font = "bold 7px monospace";
  if (design.detail.degree) {
    const width = context.measureText(design.detail.bottom).width;
    const start = 61 - (width + 4) / 2;
    context.textAlign = "left";
    context.fillText(design.detail.bottom, start, 9);
    drawDegree(context, Math.round(start + width + 1), 8, design.accentText);
  } else {
    context.fillText(design.detail.bottom, 61, 9);
  }
};

const drawScene = (context, design) => {
  context.fillStyle = gradient(context, COLORS.slateDark, COLORS.amberDark);
  context.fillRect(0, 0, 72, 16);
  context.fillStyle = COLORS.amberDark;
  context.fillRect(0, 0, 72, 16);
  context.fillStyle = COLORS.amber;
  for (const [x, y] of [
    [5, 8],
    [7, 10],
    [9, 8],
    [11, 6],
    [13, 4],
  ]) {
    context.fillRect(x, y, 3, 2);
  }
  context.fillStyle = COLORS.ice;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = "bold 5px monospace";
  context.fillText("SCENE", 45, 1);
  context.fillStyle = COLORS.white;
  context.textBaseline = "middle";
  context.font = "bold 10px monospace";
  context.fillText(design.label, 45, 10);
};

const drawProblem = (context, design, blink) => {
  context.fillStyle = gradient(context, design.start, design.end);
  context.fillRect(0, 0, 72, 16);
  context.fillStyle = "#160407cc";
  context.fillRect(0, 0, 16, 16);
  context.fillStyle = blink ? COLORS.white : design.accent;
  context.fillRect(7, 3, 2, 7);
  context.fillRect(7, 12, 2, 2);
  context.fillStyle = COLORS.white;
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.font = "bold 8px monospace";
  context.fillText(design.label, 44, 8);
};

const render = (canvas, design, blink) => {
  const context = canvas.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
  context.imageSmoothingEnabled = false;

  if (design.kind === "clock") {
    drawClock(context, design);
    return;
  }
  if (design.kind === "weather") {
    drawWeather(context, design, blink);
    return;
  }
  if (design.kind === "scene") {
    drawScene(context, design);
    return;
  }
  if (design.kind === "problem") {
    drawProblem(context, design, blink);
    return;
  }

  context.fillStyle = gradient(context, design.start, design.end);
  context.fillRect(0, 0, 72, 16);
  drawBooth(context, design.mode, blink);
  drawBoothText(context, design);
};

const canvases = designs.map((design) => {
  const frame = document.createElement("article");
  frame.className = "frame";

  const label = document.createElement("div");
  label.className = "frame-label";
  label.textContent = design.name;

  const shell = document.createElement("div");
  shell.className = "canvas-shell";

  const canvas = document.createElement("canvas");
  canvas.width = DISPLAY_WIDTH * BACKING_SCALE;
  canvas.height = DISPLAY_HEIGHT * BACKING_SCALE;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${design.name} BUSY Bar frame`);

  shell.append(canvas);
  frame.append(label, shell);
  frames.append(frame);
  return { canvas, design };
});

let blink = false;
const paint = () => {
  blink = !blink;
  for (const entry of canvases) render(entry.canvas, entry.design, blink);
};

paint();
setInterval(paint, 500);
