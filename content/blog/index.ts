export type ArticleMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  category: string;
  state: string | null; // null = general, "va" = Virginia-specific, etc.
  author: string;
  tags: string[];
  cluster?: string; // optional cluster ID for hub/spoke linking
  clusterRole?: "hub" | "spoke";
};

export const CATEGORIES: Record<string, string> = {
  "transfer-confusion": "Transfer Credits",
  "registration-timing": "Registration & Timing",
  "cross-college-scheduling": "Cross-College Scheduling",
  "senior-waivers": "Senior Waivers & Auditing",
  "state-system-explainers": "State System Explainers",
  "mistake-avoidance": "Mistake Avoidance",
};

export const articles: ArticleMeta[] = [
  // --- Cluster A: Transfer credit confusion (hub + spokes) ---
  {
    slug: "what-direct-match-vs-elective-credit-means",
    title:
      'Community College Transfer Credit: What "Direct Match" vs "Elective Credit" Actually Means',
    description:
      "Your course transferred — but did it actually count? Learn the difference between a direct match and elective credit, and why it matters for graduation.",
    date: "2026-04-04",
    category: "transfer-confusion",
    state: null,
    author: "Community College Path",
    tags: ["transfer", "credits", "direct-match", "elective-credit"],
    cluster: "transfer-credit-guide",
    clusterRole: "hub",
  },
  {
    slug: "virginia-community-college-transfer-guaranteed-admission",
    title:
      "Virginia Community College Transfer: How Guaranteed Admission Actually Works",
    description:
      "Virginia's GAA promises guaranteed admission to public universities — but it doesn't guarantee your major or your credits. Here's what it actually covers.",
    date: "2026-04-04",
    category: "state-system-explainers",
    state: "va",
    author: "Community College Path",
    tags: ["transfer", "virginia", "vccs", "guaranteed-admission", "gaa"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },
  {
    slug: "north-carolina-community-college-unc-transfer-caa",
    title:
      "North Carolina Community College to UNC Transfer: What the CAA Covers and What It Does Not",
    description:
      "The Comprehensive Articulation Agreement defines NC transfer rules — but it doesn't guarantee admission to every school or program. Here's what to know.",
    date: "2026-04-04",
    category: "state-system-explainers",
    state: "nc",
    author: "Community College Path",
    tags: ["transfer", "north-carolina", "ncccs", "unc", "caa"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster B: Senior waivers and auditing (hub + spokes) ---
  {
    slug: "free-community-college-classes-for-seniors",
    title:
      "Free or Reduced-Cost Community College Classes for Seniors: Which States Actually Offer Them?",
    description:
      "Several states waive tuition for seniors at community colleges. Here's what exists, how it works, and what the fine print says.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: null,
    author: "Community College Path",
    tags: ["seniors", "tuition-waiver", "auditing", "free-classes"],
    cluster: "senior-waivers-guide",
    clusterRole: "hub",
  },
  {
    slug: "virginia-senior-citizens-community-college-free-tuition",
    title:
      "Virginia Senior Citizens and Community College: Free Tuition vs Audit-Only Explained",
    description:
      "Virginia residents 60+ can take community college classes for free — but there's an income cap for credit enrollment. Here's how the waiver actually works.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: "va",
    author: "Community College Path",
    tags: ["seniors", "virginia", "vccs", "tuition-waiver", "auditing"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },
  {
    slug: "north-carolina-senior-citizens-community-colleges",
    title:
      "North Carolina Senior Citizens at Community Colleges: What 65+ Students Can Still Do",
    description:
      "North Carolina waives tuition for residents 65+ at all 58 community colleges — but it's audit only. Here's what that means and how to get started.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: "nc",
    author: "Community College Path",
    tags: ["seniors", "north-carolina", "ncccs", "tuition-waiver", "auditing"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },

  // --- Standalone: Auditing explainer ---
  {
    slug: "what-does-audit-a-class-mean",
    title:
      'What Does "Audit a Class" Actually Mean at a Community College?',
    description:
      "Auditing means attending a course without earning credits or a grade. Here's who does it, how it works, and what it costs.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: null,
    author: "Community College Path",
    tags: ["auditing", "audit-vs-credit", "community-college"],
  },

  // --- Standalone: Registration timing ---
  {
    slug: "how-to-find-late-start-community-college-classes",
    title:
      "How to Find Late-Start Community College Classes Before the Semester Is Lost",
    description:
      "Missed the start of the semester? Late-start classes begin weeks later and carry the same credits. Here's how to find them.",
    date: "2026-04-04",
    category: "registration-timing",
    state: null,
    author: "Community College Path",
    tags: ["late-start", "mini-session", "registration", "accelerated"],
  },

  // --- Standalone: Transfer verification ---
  {
    slug: "how-to-check-if-community-college-course-transfers",
    title:
      "How to Tell if a Community College Course Will Count for Your Target University Before You Enroll",
    description:
      "Checking transfer equivalencies before registration takes 15 minutes. Not checking can cost you a semester. Here's the step-by-step process.",
    date: "2026-04-04",
    category: "transfer-confusion",
    state: null,
    author: "Community College Path",
    tags: ["transfer", "equivalency", "course-planning"],
  },

  // --- Standalone: Multi-college enrollment ---
  {
    slug: "taking-classes-at-multiple-community-colleges",
    title:
      "Can You Take Classes at More Than One Community College at the Same Time?",
    description:
      "Yes — and sometimes it's the smartest option. Here's how multi-campus enrollment works, including financial aid, schedules, and transfer.",
    date: "2026-04-04",
    category: "cross-college-scheduling",
    state: null,
    author: "Community College Path",
    tags: ["multi-campus", "scheduling", "enrollment", "financial-aid"],
  },

  // --- Standalone: Schedule building ---
  {
    slug: "how-to-build-community-college-schedule",
    title:
      "How to Build a Community College Schedule Across Multiple Campuses or Colleges",
    description:
      "Multi-campus scheduling takes more planning, but it's entirely doable. Here's a step-by-step system for building a workable schedule across locations.",
    date: "2026-04-04",
    category: "cross-college-scheduling",
    state: null,
    author: "Community College Path",
    tags: ["scheduling", "multi-campus", "schedule-builder", "commute"],
  },

  // --- Standalone: Schedule timing ---
  {
    slug: "when-do-community-college-schedules-go-live",
    title:
      "When Do Community College Class Schedules Usually Go Live?",
    description:
      "Course schedules typically post 2–4 months before the semester. Here's the general timeline and how to plan before the schedule drops.",
    date: "2026-04-04",
    category: "registration-timing",
    state: null,
    author: "Community College Path",
    tags: ["registration", "schedule", "timing", "course-catalog"],
  },

  // --- Cluster A spoke: NC transfer guides ---
  {
    slug: "north-carolina-transfer-guides-how-to-use",
    title:
      "North Carolina Community College Transfer Guides: How to Use Them Without Getting Lost",
    description:
      "NC has transfer guides, equivalency tables, and pre-major pathways — but most students don't know how to find or read them. Here's a practical walkthrough.",
    date: "2026-04-04",
    category: "state-system-explainers",
    state: "nc",
    author: "Community College Path",
    tags: ["transfer", "north-carolina", "ncccs", "transfer-guides"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: GA transfer ---
  {
    slug: "georgia-tcsg-transfer-credit-guide",
    title:
      "How Georgia Transfer Credit Actually Works: A TCSG Student's Guide",
    description:
      "The same TCSG course can be a direct match at one Georgia university and worth nothing at another. Here's how transfer credit works across Georgia Tech, UGA, GSU, KSU, and UWG.",
    date: "2026-04-06",
    category: "state-system-explainers",
    state: "ga",
    author: "Community College Path",
    tags: ["transfer", "georgia", "tcsg", "georgia-tech", "uga", "gsu", "ksu", "uwg"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: comparing transfer credit ---
  {
    slug: "comparing-transfer-credit-across-universities",
    title:
      'Comparing Transfer Credit Across Universities: What "Transfers" Really Means',
    description:
      "Two universities can evaluate the same transcript and reach completely different conclusions. Here's how to compare transfer credit across schools — and why direct matches matter more than total credits.",
    date: "2026-04-06",
    category: "transfer-confusion",
    state: null,
    author: "Community College Path",
    tags: ["transfer", "comparison", "direct-match", "elective-credit", "university-selection"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: SC transfer ---
  {
    slug: "south-carolina-technical-college-transfer",
    title:
      "South Carolina Technical College Transfer: What Transfers to USC, Clemson, and Other Universities",
    description:
      "SC technical college courses can transfer to public universities — but equivalencies vary by school. Here's how the system works and how to check before you register.",
    date: "2026-04-04",
    category: "state-system-explainers",
    state: "sc",
    author: "Community College Path",
    tags: ["transfer", "south-carolina", "sctcs", "usc", "clemson"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster B spoke: SC seniors ---
  {
    slug: "south-carolina-senior-citizens-technical-colleges",
    title:
      "South Carolina Senior Citizens at Technical Colleges: How the 60+ Tuition Waiver Works",
    description:
      "SC residents aged 60+ can take technical college classes with tuition waived — and unlike NC, it's for credit, not just auditing. Here's how it works.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: "sc",
    author: "Community College Path",
    tags: ["seniors", "south-carolina", "sctcs", "tuition-waiver"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },

  // --- Cluster B spoke: DC seniors ---
  {
    slug: "dc-senior-citizens-udc-community-college",
    title:
      "DC Senior Citizens and UDC Community College: What the 65+ Tuition Waiver Covers",
    description:
      "DC residents 65+ may have tuition and fees waived at UDC Community College. Here's what the waiver covers, what it doesn't, and how to enroll.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: "dc",
    author: "Community College Path",
    tags: ["seniors", "dc", "udc-cc", "tuition-waiver"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },

  // --- Standalone: Class full alternatives ---
  {
    slug: "what-to-do-when-community-college-class-is-full",
    title:
      "What to Do When the Community College Class You Need Is Full",
    description:
      "The course you need is full. Don't wait until next semester — here are six concrete steps to find an alternative fast.",
    date: "2026-04-04",
    category: "registration-timing",
    state: null,
    author: "Community College Path",
    tags: ["registration", "waitlist", "alternatives", "course-planning"],
  },

  // --- Cluster A spoke: MD transfer ---
  {
    slug: "maryland-community-college-transfer-credit-guide",
    title:
      "How Maryland Community College Transfer Credit Actually Works: An ARTSYS Student's Guide",
    description:
      "Maryland has 122,000+ published transfer equivalencies across 8 universities — but the same course can be a direct match at Towson and elective credit at UMGC. Here's how to navigate it.",
    date: "2026-04-11",
    category: "state-system-explainers",
    state: "md",
    author: "Community College Path",
    tags: ["transfer", "maryland", "artsys", "umd", "towson", "umbc", "umgc"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: NY CUNY transfer ---
  {
    slug: "new-york-cuny-community-college-transfer-guide",
    title:
      "How CUNY Community College Transfer Credit Actually Works: A Student's Guide",
    description:
      "CUNY's 7 community colleges feed into 14 senior colleges — but transfer outcomes vary wildly. Brooklyn College accepts 68% as direct matches; Medgar Evers rejects 57%. Here's what to know.",
    date: "2026-04-11",
    category: "state-system-explainers",
    state: "ny",
    author: "Community College Path",
    tags: ["transfer", "new-york", "cuny", "brooklyn-college", "hunter", "baruch", "t-rex"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Standalone: Online vs in-person ---
  {
    slug: "online-vs-in-person-community-college-classes",
    title:
      "Online vs In-Person vs Hybrid Community College Classes: How to Choose the Right Format",
    description:
      "Online isn't automatically easier. Hybrid has mandatory attendance. Here's how to pick the right course format for your situation.",
    date: "2026-04-04",
    category: "mistake-avoidance",
    state: null,
    author: "Community College Path",
    tags: ["online", "hybrid", "in-person", "course-format", "scheduling"],
  },

  // --- Cluster A spoke: NJ transfer ---
  {
    slug: "new-jersey-community-college-transfer-credit-guide",
    title:
      "How New Jersey Community College Transfer Credit Actually Works: An NJTransfer Student's Guide",
    description:
      "NJ has 40 receiving institutions — but the same course can be a direct match at Rowan (96%) and worth nothing at Rutgers Engineering (13%). Here's how to navigate it.",
    date: "2026-04-12",
    category: "state-system-explainers",
    state: "nj",
    author: "Community College Path",
    tags: ["transfer", "new-jersey", "njtransfer", "rutgers", "rowan", "njit"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: cross-state comparison ---
  {
    slug: "comparing-transfer-credit-across-states",
    title:
      "How Transfer Credit Compares Across States: What 300,000+ Equivalencies Reveal",
    description:
      "We analyzed 300,000+ transfer equivalencies across 12 states. Direct match rates range from 12% to 56%. Here's what the data shows — and what it means for your transfer plan.",
    date: "2026-04-12",
    category: "transfer-confusion",
    state: null,
    author: "Community College Path",
    tags: ["transfer", "comparison", "direct-match", "elective-credit", "cross-state"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: PA transfer ---
  {
    slug: "pennsylvania-community-college-transfer-credit-guide",
    title:
      "How Pennsylvania Community College Transfer Credit Actually Works",
    description:
      "PA has 14 community colleges but no statewide articulation agreement. Penn State, Pitt, Temple, West Chester, and Drexel each evaluate CC credits independently. Here's what that actually looks like.",
    date: "2026-04-20",
    category: "state-system-explainers",
    state: "pa",
    author: "Community College Path",
    tags: ["transfer", "pennsylvania", "penn-state", "pitt", "temple", "pa-trac", "ccp"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: TN TBR transfer ---
  {
    slug: "tennessee-tbr-community-college-transfer-guide",
    title:
      "Tennessee TBR Transfer Credit: Why It's Easier Than Most States",
    description:
      "TN is the only state that enforces common course numbering across all 13 community colleges. ENGL 1010 is ENGL 1010 everywhere. Here's why that matters and how the Tennessee Transfer Pathways work.",
    date: "2026-04-20",
    category: "state-system-explainers",
    state: "tn",
    author: "Community College Path",
    tags: ["transfer", "tennessee", "tbr", "ttp", "tsu", "mtsu", "apsu", "common-course-numbering"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: DE transfer ---
  {
    slug: "delaware-community-college-transfer-credit-guide",
    title:
      "Delaware Community College Transfer: A DTCC Student's Guide",
    description:
      "Delaware has one community college (DTCC, four campuses) and three primary transfer destinations (UDel, Delaware State, Wilmington). Here's how the Connected Degree program works and when to use it.",
    date: "2026-04-20",
    category: "state-system-explainers",
    state: "de",
    author: "Community College Path",
    tags: ["transfer", "delaware", "dtcc", "udel", "connected-degree", "wilmington-university"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: CT unified system ---
  {
    slug: "connecticut-ct-state-unified-system-guide",
    title:
      "Connecticut's CT State Community College: What the 2023 Merger Means for Students",
    description:
      "Connecticut merged 12 community colleges into one accredited institution in 2023. One transcript, one catalog, one articulation agreement. Here's what changed and what didn't.",
    date: "2026-04-20",
    category: "state-system-explainers",
    state: "ct",
    author: "Community College Path",
    tags: ["transfer", "connecticut", "ct-state", "caga", "ccsu", "ecsu", "scsu", "merger"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Standalone: Prerequisite chains ---
  {
    slug: "prerequisite-chains-why-four-semester-plans-take-six",
    title:
      "Why Your Four-Semester Community College Plan Is Actually Six",
    description:
      "Across 12 states, 40-60% of courses have at least one prerequisite. Some chains go four levels deep. Here's how to spot them before you register — using real data from community college catalogs.",
    date: "2026-04-20",
    category: "mistake-avoidance",
    state: null,
    author: "Community College Path",
    tags: ["prerequisites", "planning", "two-year-degree", "course-sequence", "developmental"],
  },

  // --- Cluster A spoke: transfer equivalency reading ---
  {
    slug: "how-to-read-transfer-equivalency-table",
    title:
      "How to Read a Community College Transfer Equivalency Table",
    description:
      "Transfer tables use notation nobody teaches: direct match vs elective, wildcards, grade minimums, credit caps. Here's how to decode them before you lose a semester assuming a course will count.",
    date: "2026-04-20",
    category: "transfer-confusion",
    state: null,
    author: "Community College Path",
    tags: ["transfer", "equivalency", "direct-match", "elective-credit", "notation"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster B spoke: 15-state senior tuition comparison ---
  {
    slug: "senior-citizen-community-college-tuition-all-15-states",
    title:
      "Senior Citizen Community College Tuition: All 15 States Compared",
    description:
      "Age thresholds, income caps, audit-only vs credit-eligible. Senior tuition waiver rules vary dramatically across states. Here's the complete comparison matrix for all 15 states we track.",
    date: "2026-04-20",
    category: "senior-waivers",
    state: null,
    author: "Community College Path",
    tags: ["seniors", "tuition-waiver", "auditing", "comparison", "all-states"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },

  // --- Standalone: hybrid classes ---
  {
    slug: "hybrid-community-college-classes-explained",
    title:
      "Hybrid Community College Classes: The Hidden Third Option",
    description:
      "Hybrid courses are now 10-20% of community college offerings in most states. Here's what they actually are (including HyFlex), when hybrid wins over online or in-person, and how to spot them in registration.",
    date: "2026-04-20",
    category: "registration-timing",
    state: null,
    author: "Community College Path",
    tags: ["hybrid", "hyflex", "online", "in-person", "course-format", "scheduling"],
  },
];
