const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function calendarEvent(title) {
  return {
    getTitle: () => title,
    getLocation: () => '',
    getStartTime: () => new Date('2026-08-19T12:00:00Z'),
  };
}

function fetchTitles(titles) {
  const context = vm.createContext({ console, Date, JSON, Map, Set });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8'), context);
  context.formatDate = () => '2026-08-19';
  context.CalendarApp = {
    getCalendarById: () => ({ getEvents: () => titles.map(calendarEvent) }),
  };

  return context.fetchCalendarEvents('calendar-id', new Date(), new Date());
}

test('calendar events require a five- or six-digit job number', () => {
  const events = fetchTitles([
    'Shop cleanup',
    'Four digit 1234',
    'Install 251234 - Main Street monument',
  ]);

  assert.deepEqual(Array.from(events, event => event.jobNums[0]), ['251234']);
});

test('removal, survey, and delivery titles are excluded case-insensitively', () => {
  const events = fetchTitles([
    '251231 - REMOVAL at Main Street',
    '251232 - Site Survey',
    '251233 - delivery only',
    '251234 - Standard installation',
  ]);

  assert.deepEqual(Array.from(events, event => event.jobNums[0]), ['251234']);
});
