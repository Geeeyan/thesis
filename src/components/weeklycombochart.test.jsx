import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { apiRequest } from "../api";
import WeeklyComboChart from "./weeklycombochart";

jest.mock("../api", () => ({ apiRequest: jest.fn() }));
jest.mock("recharts", () => {
  const ReactRuntime = require("react");
  const Wrapper = ({ children }) => ReactRuntime.createElement("div", null, children);
  return {
    Bar: () => null,
    CartesianGrid: () => null,
    ComposedChart: ({ data }) => ReactRuntime.createElement("div", {
      "data-testid": "weekly-chart-data",
      "data-count": data.length,
    }),
    LabelList: () => null,
    Line: () => null,
    ReferenceLine: () => null,
    ResponsiveContainer: Wrapper,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

function makeWeek(week_start, total = 0) {
  return { week_start, categories: { Rooms: total }, total };
}

async function renderReport(report) {
  apiRequest.mockResolvedValueOnce(report);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<WeeklyComboChart />);
    await Promise.resolve();
  });
  return { container, root };
}

beforeEach(() => {
  window.matchMedia = () => ({ matches: false, addListener: jest.fn(), removeListener: jest.fn() });
});

afterEach(() => {
  apiRequest.mockReset();
});

test("shows the empty state when there are no weekly observations", async () => {
  const { container, root } = await renderReport({
    categories: [],
    weeks: [],
    forecast: [],
    forecastAvailable: false,
  });
  expect(container.textContent).toContain("No bookings in this period.");
  expect(container.querySelector('[data-testid="weekly-chart-data"]')).toBeNull();
  await act(async () => root.unmount());
});

test("renders a single week", async () => {
  const { container, root } = await renderReport({
    categories: ["Rooms"],
    weeks: [makeWeek("2026-11-02", 1)],
    forecast: [],
    forecastAvailable: false,
  });
  expect(container.querySelector('[data-testid="weekly-chart-data"]').dataset.count).toBe("1");
  expect(container.querySelector('[role="img"]').getAttribute("aria-label")).toContain("Weekly booking counts");
  await act(async () => root.unmount());
});

test("renders long ranges with the forecast series", async () => {
  const weeks = Array.from({ length: 52 }, (_unused, index) => {
    const date = new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10);
    return makeWeek(date, index % 4);
  });
  const forecast = Array.from({ length: 8 }, (_unused, index) => ({
    week_start: new Date(Date.UTC(2025, 0, 6 + (52 + index) * 7)).toISOString().slice(0, 10),
    total: 2,
    estimate: true,
  }));
  const { container, root } = await renderReport({
    categories: ["Rooms"],
    weeks,
    forecast,
    forecastAvailable: true,
  });
  expect(container.querySelector('[data-testid="weekly-chart-data"]').dataset.count).toBe("60");
  expect(container.textContent).toContain("Value labels are hidden for longer ranges");
  await act(async () => root.unmount());
});
