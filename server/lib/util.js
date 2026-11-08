const { z } = require('zod');
const config = require('../config');

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightsBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const eachNight = (a, b) => { const out = []; for (let d = a; d < b; d = addDays(d, 1)) out.push(d); return out; };
const round2 = (n) => Math.round(n * 100) / 100;
const HOURS_72 = 72 * 60 * 60 * 1000;

function dateStartInTimezone(date, timeZone = config.timezone) {
  const approximate = Date.parse(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let timestamp = approximate;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    timestamp = approximate - (represented - timestamp);
  }
  return timestamp;
}

function dateTimeInTimezone(date, time, timeZone = config.timezone) {
  const approximate = Date.parse(`${date}T${time}:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let timestamp = approximate;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    timestamp += Date.UTC(...date.split('-').map(Number).map((value, index) => index === 1 ? value - 1 : value), ...time.split(':').map(Number)) - represented;
  }
  return new Date(timestamp).toISOString();
}

function dateInTimezone(timestamp, timeZone = config.timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timeInTimezone(timestamp, timeZone = config.timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

const checkInWithin72Hours = (date, now = Date.now()) => dateStartInTimezone(date) - now < HOURS_72;

const dateSchema = z.string().refine(isDate, 'Use a real date as YYYY-MM-DD');
const emailSchema = z.string().trim().toLowerCase().max(200).pipe(z.email());
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').refine((p) => Buffer.byteLength(p) <= 72, 'Password is too long (72 bytes max)');
const idSchema = z.coerce.number().int().positive();
const parseId = (v) => { const r = idSchema.safeParse(v); if (!r.success) throw new HttpError(400, 'Invalid id'); return r.data; };

module.exports = { HttpError, isDate, today, addDays, nightsBetween, eachNight, round2, dateStartInTimezone, dateTimeInTimezone, dateInTimezone, timeInTimezone, checkInWithin72Hours, dateSchema, emailSchema, passwordSchema, parseId };
