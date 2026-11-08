import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiRequest } from "../api";

const SERIES_TOKENS = [
  "--weekly-series-one",
  "--weekly-series-two",
  "--weekly-series-three",
  "--weekly-series-four",
  "--weekly-series-five",
  "--weekly-series-six",
];
function seriesToken(category) {
  let hash = 0;
  for (const character of category) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return SERIES_TOKENS[hash % SERIES_TOKENS.length];
}

function localToday(timeZone) {
  if (timeZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function defaultRange() {
  const to = localToday();
  return { from: addDays(mondayOf(to), -77), to };
}

function shortDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function weekRange(date) {
  return `${shortDate(date)} – ${shortDate(addDays(date, 6))}`;
}

function formatValue(value, metric) {
  return metric === "revenue"
    ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value || 0)
    : Number(value || 0).toLocaleString("en-PH");
}

function csvCell(value) {
  const text = String(value ?? "");
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function CustomValueLabel({ x, y, value, index, dataKey, anchorIndex, metric }) {
  if (value == null || (dataKey === "forecastTotal" && index === anchorIndex)) return null;
  return (
    <text x={x} y={y - 10} textAnchor="middle" className="weekly-chart-value-label">
      {formatValue(value, metric)}
    </text>
  );
}

function WeeklyTooltip({ active, payload, label, categories, metric, showForecast, showTotal }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="weekly-chart-tooltip">
      <strong>Week of {weekRange(label)}</strong>
      {point.total != null && categories.map((category) => (
        <div key={category}>{category}: {formatValue(point[category] || 0, metric)}</div>
      ))}
      {showTotal && point.total != null && (
        <div className="weekly-chart-tooltip-total">Weekly total: {formatValue(point.total, metric)}</div>
      )}
      {showForecast && point.forecastTotal != null && point.forecastEstimate && (
        <div>Forecast estimate: {formatValue(point.forecastTotal, metric)}</div>
      )}
    </div>
  );
}

export default function WeeklyComboChart() {
  const initialRange = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [metric, setMetric] = useState("bookings");
  const [report, setReport] = useState(null);
  const [selectedCategories, setSelectedCategories] = useState(null);
  const [hiddenSeries, setHiddenSeries] = useState([]);
  const [showForecast, setShowForecast] = useState(true);
  const [viewTable, setViewTable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hideLabels, setHideLabels] = useState(false);
  const requestId = useRef(0);
  const chartRef = useRef(null);

  const loadReport = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to, metric, groupBy: "category" });
      const result = await apiRequest(`/reports/weekly?${params.toString()}`);
      if (currentRequest === requestId.current) {
        setReport(result);
        setSelectedCategories((current) => current
          ? current.filter((category) => result.categories.includes(category))
          : result.categories);
      }
    } catch (requestError) {
      if (currentRequest === requestId.current) setError(requestError.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [from, to, metric]);

  useEffect(() => {
    loadReport();
    return () => { requestId.current += 1; };
  }, [loadReport]);

  useEffect(() => {
    const updateLabelVisibility = () => setHideLabels(
      (report?.weeks.length || 0) + (showForecast ? report?.forecast.length || 0 : 0) > 20
      || window.matchMedia("(max-width: 600px)").matches,
    );
    updateLabelVisibility();
    window.addEventListener("resize", updateLabelVisibility);
    return () => window.removeEventListener("resize", updateLabelVisibility);
  }, [report, showForecast]);

  const categories = report?.categories || [];
  const visibleCategories = categories.filter((category) => selectedCategories?.includes(category));
  const actualWeeks = report?.weeks || [];
  const forecast = showForecast && report?.forecastAvailable ? report.forecast : [];
  const chartData = useMemo(() => {
    if (!report) return [];
    const actual = report.weeks.map((week) => ({
      week_start: week.week_start,
      ...week.categories,
      total: week.total,
      forecastTotal: null,
      forecastEstimate: false,
    }));
    if (!forecast.length || !actual.length) return actual;
    actual[actual.length - 1].forecastTotal = actual[actual.length - 1].total;
    forecast.forEach((week) => actual.push({
      week_start: week.week_start,
      total: null,
      forecastTotal: week.total,
      forecastEstimate: true,
    }));
    return actual;
  }, [report, forecast]);

  const currentWeek = mondayOf(localToday(report?.timezone));
  const thisWeek = actualWeeks.find((week) => week.week_start === currentWeek);
  const previousWeek = actualWeeks.find((week) => week.week_start === addDays(currentWeek, -7));
  const bestWeek = actualWeeks.reduce((best, week) => (!best || week.total > best.total ? week : best), null);
  const nextWeekForecast = report?.forecastAvailable ? report.forecast?.[0]?.total : null;
  const lastWeekTotal = previousWeek?.total || 0;
  const weekChange = thisWeek && previousWeek
    ? lastWeekTotal === 0
      ? thisWeek.total > 0 ? 100 : 0
      : ((thisWeek.total - lastWeekTotal) / lastWeekTotal) * 100
    : null;
  const seriesVisible = (name) => !hiddenSeries.includes(name);

  function toggleSeries(name) {
    setHiddenSeries((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]);
  }

  function toggleCategory(category) {
    setSelectedCategories((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category]);
  }

  function downloadCsv() {
    if (!report) return;
    const rows = [
      ["Week starting", ...visibleCategories, "Weekly total", "Forecast estimate"],
      ...chartData.map((week) => [
        week.week_start,
        ...visibleCategories.map((category) => week[category] ?? ""),
        week.total ?? "",
        week.forecastEstimate ? week.forecastTotal : "",
      ]),
    ];
    const url = URL.createObjectURL(new Blob(
      [`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`],
      { type: "text/csv;charset=utf-8" },
    ));
    const link = document.createElement("a");
    link.href = url;
    link.download = `weekly-bookings-${metric}-${from}-to-${to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadPng() {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg) return;
    const clonedSvg = svg.cloneNode(true);
    clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clonedSvg.setAttribute("width", svg.clientWidth);
    clonedSvg.setAttribute("height", svg.clientHeight);
    const sourceNodes = [svg, ...svg.querySelectorAll("*")];
    const clonedNodes = [clonedSvg, ...clonedSvg.querySelectorAll("*")];
    sourceNodes.forEach((source, index) => {
      const style = window.getComputedStyle(source);
      if (style.fill && style.fill !== "none") clonedNodes[index].setAttribute("fill", style.fill);
      if (style.stroke && style.stroke !== "none") clonedNodes[index].setAttribute("stroke", style.stroke);
      if (style.fontFamily) clonedNodes[index].setAttribute("font-family", style.fontFamily);
    });
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("width", String(svg.clientWidth));
    background.setAttribute("height", String(svg.clientHeight));
    background.setAttribute("fill", window.getComputedStyle(
      chartRef.current.closest(".weekly-report"),
    ).backgroundColor);
    clonedSvg.insertBefore(background, clonedSvg.firstChild);
    const svgBlob = new Blob([new XMLSerializer().serializeToString(clonedSvg)], {
      type: "image/svg+xml;charset=utf-8",
    });
    const imageUrl = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      image.src = imageUrl;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      const canvas = document.createElement("canvas");
      canvas.width = svg.clientWidth * 2;
      canvas.height = svg.clientHeight * 2;
      const context = canvas.getContext("2d");
      context.scale(2, 2);
      context.drawImage(image, 0, 0);
      const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("The chart image could not be created.");
      const downloadUrl = URL.createObjectURL(png);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `weekly-bookings-${metric}-${from}-to-${to}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch {
      setError("The chart image could not be downloaded. Try printing the report instead.");
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  const actualAnchorIndex = actualWeeks.length ? actualWeeks.length - 1 : -1;
  const tooltipCategories = visibleCategories.filter((category) => seriesVisible(category));
  const valueLabel = (dataKey) => (
    <LabelList
      dataKey={dataKey}
      content={(props) => hideLabels ? null : (
        <CustomValueLabel {...props} dataKey={dataKey} anchorIndex={actualAnchorIndex} metric={metric} />
      )}
    />
  );

  return (
    <section className="weekly-report" aria-labelledby="weekly-report-title" aria-busy={loading}>
      <div className="weekly-report-heading">
        <div>
          <h2 id="weekly-report-title">Weekly Bookings Report</h2>
          <p>Confirmed and completed bookings grouped by the Monday of each week.</p>
        </div>
        <div className="weekly-report-downloads">
          <button type="button" className="admin-report-button secondary" onClick={downloadCsv} disabled={!report || loading}>
            <i className="bi bi-download" aria-hidden="true" />Download CSV
          </button>
          <button type="button" className="admin-report-button secondary" onClick={downloadPng} disabled={!report || loading || !actualWeeks.length}>
            <i className="bi bi-image" aria-hidden="true" />Download PNG
          </button>
        </div>
      </div>

      <div className="weekly-report-controls">
        <label>
          <span>From</span>
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </label>
        <fieldset className="weekly-metric-toggle">
          <legend>Metric</legend>
          {[
            ["bookings", "Number of bookings"],
            ["revenue", "Revenue"],
          ].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)}>
              {label}
            </button>
          ))}
        </fieldset>
        <details className="weekly-category-filter">
          <summary>Categories ({visibleCategories.length}/{categories.length})</summary>
          <div className="weekly-category-options">
            {categories.map((category) => (
              <label key={category}>
                <input type="checkbox" checked={selectedCategories?.includes(category) || false} onChange={() => toggleCategory(category)} />
                {category}
              </label>
            ))}
            {!categories.length && <span>No categories available</span>}
          </div>
        </details>
        <label className="weekly-forecast-toggle">
          <input type="checkbox" checked={showForecast} onChange={(event) => setShowForecast(event.target.checked)} />
          Show forecast
        </label>
      </div>

      {error && (
        <div className="weekly-report-error" role="alert">
          <span>{error}</span>
          <button type="button" className="admin-report-button secondary" onClick={loadReport}>Retry</button>
        </div>
      )}

      <div className="weekly-summary-grid">
        {[
          ["Total this week", thisWeek ? formatValue(thisWeek.total, metric) : "—"],
          ["Change vs last week", weekChange == null ? "—" : `${weekChange >= 0 ? "+" : ""}${weekChange.toFixed(1)}%`],
          ["Best week", bestWeek ? `${formatValue(bestWeek.total, metric)} · ${shortDate(bestWeek.week_start)}` : "—"],
          ["Forecast next week", nextWeekForecast == null ? "Not available" : formatValue(nextWeekForecast, metric)],
        ].map(([label, value]) => (
          <div className="weekly-summary-card" key={label}>
            <span>{label}</span>
            {loading && !report ? <div className="weekly-skeleton" aria-hidden="true" /> : <strong>{value}</strong>}
          </div>
        ))}
      </div>

      {!loading && report && !actualWeeks.some((week) => week.total > 0) ? (
        <p className="weekly-report-empty">No bookings in this period.</p>
      ) : (
        <>
          {report && !report.forecastAvailable && (
            <p className="weekly-forecast-note">Forecast is hidden until at least four weeks of booking history are available.</p>
          )}
          {hideLabels && actualWeeks.length > 20 && (
            <p className="weekly-forecast-note">Value labels are hidden for longer ranges; point values remain available in the tooltip and table.</p>
          )}
          <div className="weekly-chart-tools">
            <button type="button" className="weekly-view-toggle" aria-pressed={viewTable} onClick={() => setViewTable((value) => !value)}>
              {viewTable ? "View chart" : "View as table"}
            </button>
          </div>
          {viewTable ? (
            <div className="weekly-table-scroll">
              <table className="weekly-report-table">
                <caption>Weekly bookings report data from {from} through {to}</caption>
                <thead><tr><th scope="col">Week starting</th>
                  {visibleCategories.map((category) => <th scope="col" key={category}>{category}</th>)}
                  <th scope="col">Weekly total</th>
                  {forecast.length > 0 && <th scope="col">Forecast estimate</th>}
                </tr></thead>
                <tbody>
                  {chartData.map((week) => (
                    <tr key={week.week_start}>
                      <th scope="row">{weekRange(week.week_start)}</th>
                      {visibleCategories.map((category) => <td key={category}>{formatValue(week[category], metric)}</td>)}
                      <td>{week.total == null ? "—" : formatValue(week.total, metric)}</td>
                      {forecast.length > 0 && <td>{week.forecastEstimate ? formatValue(week.forecastTotal, metric) : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="weekly-chart-scroll">
              <div
                className="weekly-chart-canvas"
                ref={chartRef}
                style={{ minWidth: `${Math.max(840, chartData.length * 52)}px` }}
                role="img"
                aria-label={`Weekly ${metric === "revenue" ? "revenue" : "booking counts"} stacked by category with weekly totals${forecast.length ? " and an eight-week forecast" : ""}.`}
              >
                {loading && !report ? (
                  <div className="weekly-chart-skeleton" aria-label="Loading weekly bookings chart" />
                ) : (
                  <ResponsiveContainer width="100%" height={390}>
                    <ComposedChart data={chartData} margin={{ top: 28, right: 24, bottom: 56, left: 18 }}>
                      <CartesianGrid vertical={false} stroke="var(--weekly-grid)" strokeDasharray="3 4" />
                      <XAxis
                        dataKey="week_start"
                        angle={-45}
                        textAnchor="end"
                        interval="preserveStartEnd"
                        height={72}
                        tickFormatter={shortDate}
                        tick={{ className: "weekly-chart-tick" }}
                        label={{ value: "Week starting", position: "insideBottom", offset: -42, className: "weekly-chart-axis-title" }}
                      />
                      <YAxis
                        allowDecimals={metric === "revenue"}
                        tickFormatter={(value) => metric === "revenue" ? new Intl.NumberFormat("en-PH", { notation: "compact" }).format(value) : value}
                        tick={{ className: "weekly-chart-tick" }}
                        axisLine={false}
                        tickLine={false}
                        label={{ value: metric === "revenue" ? "Amount (₱)" : "Bookings", angle: -90, position: "insideLeft", className: "weekly-chart-axis-title" }}
                      />
                      <Tooltip content={<WeeklyTooltip
                        categories={tooltipCategories}
                        metric={metric}
                        showForecast={showForecast && seriesVisible("Forecast")}
                        showTotal={seriesVisible("Weekly Total")}
                      />} />
                      {visibleCategories.map((category) => (
                        seriesVisible(category) && (
                          <Bar
                            key={category}
                            dataKey={category}
                            stackId="weekly"
                            fill={`var(${seriesToken(category)})`}
                            name={category}
                            isAnimationActive={false}
                          />
                        )
                      ))}
                      {seriesVisible("Weekly Total") && (
                        <Line
                          type="monotone"
                          dataKey="total"
                          name="Weekly Total"
                          stroke="var(--weekly-total)"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "var(--weekly-total)" }}
                          activeDot={{ r: 5 }}
                          connectNulls
                          isAnimationActive={false}
                        >
                          {valueLabel("total")}
                        </Line>
                      )}
                      {forecast.length > 0 && seriesVisible("Forecast") && (
                        <>
                          <ReferenceLine
                            x={actualWeeks[actualAnchorIndex]?.week_start}
                            stroke="var(--weekly-forecast)"
                            strokeDasharray="3 4"
                            label={{ value: "Forecast begins", position: "insideTopRight", className: "weekly-chart-axis-title" }}
                          />
                          <Line
                            type="monotone"
                            dataKey="forecastTotal"
                            name="Forecast"
                            stroke="var(--weekly-forecast)"
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            dot={{ r: 3, fill: "var(--weekly-forecast)" }}
                            activeDot={{ r: 5 }}
                            connectNulls
                            isAnimationActive={false}
                          >
                            {valueLabel("forecastTotal")}
                          </Line>
                        </>
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}
          {!loading && (
            <div className="weekly-chart-legend" aria-label="Chart series">
              {visibleCategories.map((category) => (
                <button key={category} type="button" aria-pressed={seriesVisible(category)} onClick={() => toggleSeries(category)}>
                  <span className="weekly-legend-marker" style={{ "--weekly-marker-color": `var(${seriesToken(category)})` }} />
                  {category}
                </button>
              ))}
              <button type="button" aria-pressed={seriesVisible("Weekly Total")} onClick={() => toggleSeries("Weekly Total")}>
                <span className="weekly-legend-marker is-line" />
                Weekly Total
              </button>
              {forecast.length > 0 && (
                <button type="button" aria-pressed={seriesVisible("Forecast")} onClick={() => toggleSeries("Forecast")}>
                  <span className="weekly-legend-marker is-forecast" />
                  Forecast (estimate)
                </button>
              )}
            </div>
          )}
        </>
      )}
      {!report && loading && <div className="weekly-chart-skeleton" aria-label="Loading weekly bookings report" />}
      {report?.forecastAvailable && (
        <p className="weekly-forecast-note">Forecast estimates show the next {report.forecast.length} weeks and use a four-week moving average.</p>
      )}
    </section>
  );
}
