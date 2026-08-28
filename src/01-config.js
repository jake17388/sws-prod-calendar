// ── Config ───────────────────────────────────────────────────────────────────
const INSTALL_CAL_ID = 'summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com';
const SUB_INSTALL_CAL_ID = 'c_56442105e894ca5ed344bd94026279f754921d3ff42e0542c5d162f00c68ff07@group.calendar.google.com';

const SKIP_KEYWORDS = ['removal', 'survey', 'delivery'];

const CREW_NAMES = ['Johnny', 'Jonathan', 'Randy', 'Eli', 'Jerry', 'Jake', 'Brian', 'Noe', 'Jason', 'Fernando', 'Canez'];
function normalizeCrew(names) {
  return names.map(n => {
    const match = CREW_NAMES.find(k => k.toLowerCase() === n.toLowerCase());
    return match || n;
  });
}

const DUE_DATE_BUSINESS_DAYS = 2;
const SQUARECOIL_FILES_REFRESH_HOURS = 6;
const SQUARECOIL_BATCH_CHUNK_SIZE = 15;
