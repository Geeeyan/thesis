const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const { HttpError, today } = require('./util');

if (config.arrivalStartHour < 0 || config.arrivalEndHour > 23 || config.arrivalStartHour > config.arrivalEndHour) {
  throw new Error('ARRIVAL_START_HOUR and ARRIVAL_END_HOUR must define a valid range from 0 to 23.');
}
if (config.sameDayStartCutoffHour < 1 || config.sameDayStartCutoffHour > 24) {
  throw new Error('SAME_DAY_START_CUTOFF_HOUR must be a whole-hour cutoff from 1 to 24.');
}

const arrivalTimeSchema = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string()
    .regex(/^(?:[01]\d|2[0-3]):00$/, 'Arrival time must be on the hour (HH:00)')
    .refine((value) => {
      const hour = Number(value.slice(0, 2));
      return hour >= config.arrivalStartHour && hour <= config.arrivalEndHour;
    }, `Choose an arrival time between ${String(config.arrivalStartHour).padStart(2, '0')}:00 and ${String(config.arrivalEndHour).padStart(2, '0')}:00`)
    .optional(),
);

function latestSameDayStartHour(service) {
  return Math.floor((1440 - service.duration_minutes - 1) / 60);
}

function isPastArrivalTime(date, time, now = new Date()) {
  if (!time || date !== today()) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(time.slice(0, 2));
  const currentHour = Number(parts.hour);
  return hour < currentHour || (hour === currentHour && (Number(parts.minute) > 0 || Number(parts.second) > 0));
}

function getArrivalTimeOptions(date, roomCode, now = new Date(), { excludeReservationId, userId } = {}) {
  const service = roomCode ? db.prepare('SELECT * FROM services WHERE code = ?').get(roomCode) : null;
  const sameDay = Boolean(service?.same_day_checkout);
  const currentDate = today();
  const currentParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const endHour = sameDay
    ? Math.min(config.arrivalEndHour, config.sameDayStartCutoffHour - 1, latestSameDayStartHour(service))
    : config.arrivalEndHour;
  const options = Array.from(
    { length: Math.max(0, endHour - config.arrivalStartHour + 1) },
    (_, index) => config.arrivalStartHour + index,
  ).map((hour) => {
    const value = `${String(hour).padStart(2, '0')}:00`;
    const displayHour = hour % 12 || 12;
    const label = `${displayHour}:00 ${hour < 12 ? 'AM' : 'PM'}`;
    const past = date === currentDate && (
      hour < Number(currentParts.hour)
      || (hour === Number(currentParts.hour) && (Number(currentParts.minute) > 0 || Number(currentParts.second) > 0))
    );
    let available = !past;
    if (available && sameDay) {
      const R = require('./reservations');
      available = R.sameDayUnitsLeft(roomCode, date, value, excludeReservationId) > 0;
      if (available && userId) {
        available = !R.userHasOverlappingReservation(userId, roomCode, date, value, service.duration_minutes, excludeReservationId);
      }
    }
    return { value, label, available };
  });
  return options;
}

function validateArrivalTimeForDate(date, time, service) {
  if (service?.same_day_checkout) {
    if (!time) throw new HttpError(400, 'Choose a whole-hour check-in time.');
    const hour = Number(time.slice(0, 2));
    const latestStartHour = Math.min(config.sameDayStartCutoffHour - 1, latestSameDayStartHour(service));
    if (hour < config.arrivalStartHour || hour > Math.min(config.arrivalEndHour, latestStartHour)) {
      throw new HttpError(400, `Choose a start time before ${String(latestStartHour + 1).padStart(2, '0')}:00 so checkout remains on the same day.`);
    }
  }
  if (time && isPastArrivalTime(date, time)) {
    throw new HttpError(400, 'Choose an arrival time that has not passed.');
  }
}

module.exports = { arrivalTimeSchema, getArrivalTimeOptions, validateArrivalTimeForDate };
