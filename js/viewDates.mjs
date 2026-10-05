export function createViewDates(initialDate = new Date()) {
  const dates = new Map();
  const copy = date => new Date(date.getTime());

  return {
    get(view) {
      return copy(dates.get(view) || initialDate);
    },
    set(view, date) {
      dates.set(view, copy(date));
    },
  };
}
