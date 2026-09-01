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
const SQUARECOIL_HANDOFF_CACHE_SECONDS = 300;
const SQUARECOIL_HANDOFF_STALE_CACHE_SECONDS = 21600;
const SQUARECOIL_MILESTONE_INDEX_CACHE_SECONDS = 21600;

// Which Squarecoil project statuses feed the Other Production queue out of the
// box. Admins re-order or change this list in Settings > Production Statuses
// (see getProductionStatuses); a missing property means a new installation and
// receives these, while an explicitly saved [] stays empty.
const DEFAULT_PRODUCTION_STATUSES = [
  'Project Handoff',
  'Pre-Production Approval',
  'Graphics',
  'Manufacturing',
  'Assembly',
];

// Squarecoil serves one report per milestone (jq.milestone_report.php?id=N), so
// every configured status has to be resolved to its milestone id. The ids are
// discovered by scraping Squarecoil's own queue navigation
// (squarecoilMilestoneIndex_) rather than relying on this list, because they
// differ per tenant and change when milestones are added. The defaults are
// seeded here as verified fallbacks so the queue still works if that scrape
// ever comes back empty.
const SQUARECOIL_SEED_MILESTONE_IDS = {
  'project handoff': '30',
  'pre-production approval': '26',
  'graphics': '28',
  'manufacturing': '2',
  'assembly': '27',
};

// Pages that carry Squarecoil's milestone navigation, tried in order until one
// yields a usable index. queues.php is the real one — it holds the full list of
// "milestone_report.php?id=N" links. The milestone report pages themselves
// carry no milestone navigation at all, which is why discovery found nothing
// when they were tried first.
const SQUARECOIL_MILESTONE_INDEX_PATHS = [
  'queues.php',
  'milestone_report.php?id=' + SQUARECOIL_SEED_MILESTONE_IDS['project handoff'],
  'dashboard.php',
];
