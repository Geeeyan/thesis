import React, { useEffect, useState } from "react";

function dateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromString(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

export default function ReservationDatePicker({
  label, value, minDate, disabledDates, isDateDisabled, getDateDisabledReason, loading, onChange, onMonthChange, error, helpText,
}) {
  const minimum = dateFromString(minDate);
  const [month, setMonth] = useState(() => firstOfMonth(value ? dateFromString(value) : minimum));

  useEffect(() => {
    setMonth(firstOfMonth(dateFromString(value || minDate)));
  }, [value, minDate]);

  useEffect(() => {
    onMonthChange?.(dateString(month).slice(0, 7));
  }, [month, onMonthChange]);

  const monthStart = firstOfMonth(month);
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const startOffset = monthStart.getDay();
  const minimumMonth = firstOfMonth(minimum);
  const monthLabel = month.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const cells = Array.from({ length: startOffset + dayCount }, (_, index) => {
    if (index < startOffset) return null;
    const date = new Date(month.getFullYear(), month.getMonth(), index - startOffset + 1, 12);
    const dateValue = dateString(date);
    const isPast = dateValue < minDate;
    const disabled = isPast
      || disabledDates?.has(dateValue)
      || isDateDisabled?.(dateValue);
    const disabledReason = isPast
      ? "Past date"
      : getDateDisabledReason?.(dateValue) || (disabled ? "Not available" : "");
    return { dateValue, day: date.getDate(), disabled, disabledReason };
  });

  return (
    <div className="contact-field reservation-date-picker">
      <label>{label} <span>*</span></label>
      <div className="reservation-calendar">
        <div className="reservation-calendar-header">
          <button
            type="button"
            aria-label="Previous month"
            disabled={monthStart <= minimumMonth}
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}
          >
            ‹
          </button>
          <strong aria-live="polite">{monthLabel}</strong>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}
          >
            ›
          </button>
        </div>
        {loading && <small className="res-availability-note" role="status">Checking availability…</small>}
        <div className="reservation-calendar-grid" role="grid" aria-label={monthLabel}>
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
            <span className="reservation-calendar-weekday" key={day} role="columnheader">{day}</span>
          ))}
          {cells.map((cell, index) => cell ? (
            <button
              type="button"
              key={cell.dateValue}
              role="gridcell"
              aria-label={`${dateFromString(cell.dateValue).toLocaleDateString("en-PH", { dateStyle: "full" })}${cell.disabledReason ? `, ${cell.disabledReason}` : ""}`}
              aria-pressed={value === cell.dateValue}
              title={cell.disabledReason || undefined}
              disabled={cell.disabled}
              className={`reservation-calendar-day${value === cell.dateValue ? " is-selected" : ""}`}
              onClick={() => onChange(cell.dateValue)}
            >
              {cell.day}
            </button>
          ) : (
            <span key={`empty-${index}`} aria-hidden="true" />
          ))}
        </div>
      </div>
      <p className="reservation-date-value" aria-live="polite">
        {value ? dateFromString(value).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) : "Select a date"}
      </p>
      {helpText && <small className="res-availability-note">{helpText}</small>}
      {error && <small className="res-error">{error}</small>}
    </div>
  );
}
