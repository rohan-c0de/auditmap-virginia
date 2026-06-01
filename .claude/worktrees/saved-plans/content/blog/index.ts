export type FaqEntry = { q: string; a: string };
export type HowToStep = { name: string; text: string };
export type HowToSpec = {
  name: string;
  description?: string;
  steps: HowToStep[];
};

export type ArticleMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  category: string;
  state: string | null; // null = general, "va" = Virginia-specific, etc.
  // Optional college binding for college-specific spokes. The post still
  // routes under its `state` (renderer uses StateToolsCTA for state); the
  // college slug ties the article to a specific institution for cluster
  // gap detection and cross-linking.
  college?: string;
  author: string;
  tags: string[];
  cluster?: string; // optional cluster ID for hub/spoke linking
  clusterRole?: "hub" | "spoke";
  // Optional rich-result inputs. Emitted as schema.org FAQPage / HowTo JSON-LD
  // when present. Opt-in per article — keeps thin/inferred FAQs out of search.
  faqs?: FaqEntry[];
  howTo?: HowToSpec;
};

export const CATEGORIES: Record<string, string> = {
  "transfer-confusion": "Transfer Credits",
  "registration-timing": "Registration & Timing",
  "cross-college-scheduling": "Cross-College Scheduling",
  "senior-waivers": "Senior Waivers & Auditing",
  "state-system-explainers": "State System Explainers",
  "mistake-avoidance": "Mistake Avoidance",
  "session-timing": "Sessions & Calendar Timing",
  "course-format-density": "Course Format & Density",
};

export const articles: ArticleMeta[] = [
  // --- Cluster H: Course availability (hub + state spokes) ---
  {
    slug: "which-community-college-courses-are-hard-to-find",
    title:
      "Hard-to-Find Community College Courses: What to Do",
    description:
      "A few gen-ed courses run at every college; most concentrate at 1–3 anchor campuses. Here's how to tell which type your course is before you register.",
    date: "2026-05-10",
    category: "registration-timing",
    state: null,
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "course-search",
      "schedule-planning",
      "anchor-campus",
    ],
    cluster: "course-availability-guide",
    clusterRole: "hub",
  },
  {
    slug: "north-carolina-community-college-course-availability",
    title:
      "NC Course Availability: 78.9% Scarcity Across 55 Colleges",
    description:
      "78.9% scarcity ratio across NC's 55 community colleges: ENG-111 is at every campus; architecture, animal science, and ASL exist at just 1 or 2.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "nc",
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "north-carolina",
      "ncccs",
      "anchor-campus",
      "schedule-planning",
    ],
    cluster: "course-availability-guide",
    clusterRole: "spoke",
  },
  {
    slug: "georgia-community-college-course-availability",
    title:
      "GA Course Availability: Central GA Tech Holds 41% (2026)",
    description:
      "Central Georgia Tech holds 43 exclusive courses in TCSG's 20-college system. Nursing is 100% concentrated — 59 courses at a handful of campuses.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "ga",
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "georgia",
      "tcsg",
      "anchor-campus",
      "nursing",
      "schedule-planning",
    ],
    cluster: "course-availability-guide",
    clusterRole: "spoke",
  },
  {
    slug: "kentucky-community-college-course-availability",
    title:
      "KY Course Availability: KCTCS Anchor Colleges (2026)",
    description:
      "KCTCS gives nursing prereqs universal access at all 16 campuses, but Jefferson, Madisonville & Bluegrass each hold 20+ exclusive programs.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "ky",
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "kentucky",
      "kctcs",
      "anchor-campus",
      "nursing",
      "schedule-planning",
    ],
    cluster: "course-availability-guide",
    clusterRole: "spoke",
  },
  {
    slug: "virginia-community-college-course-availability",
    title:
      "VA Course Availability: 68.6% Scarcity Across VCCS (2026)",
    description:
      "68.6% of VCCS courses concentrate at fewer than 25% of its 23 campuses. NOVA and TCC each hold 5 exclusive programs; vet tech is scarce statewide.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "va",
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "virginia",
      "vccs",
      "anchor-campus",
      "schedule-planning",
    ],
    cluster: "course-availability-guide",
    clusterRole: "spoke",
  },
  {
    slug: "tennessee-community-college-course-availability",
    title:
      "TN Course Availability: 251 Point-Source Courses (2026)",
    description:
      "TN's TBR system has the Southeast's best scarcity ratio, but 19.5% of its catalog (251 courses) is at exactly one campus across 12 colleges.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "tn",
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "tennessee",
      "tbr",
      "anchor-campus",
      "schedule-planning",
    ],
    cluster: "course-availability-guide",
    clusterRole: "spoke",
  },
  {
    slug: "south-carolina-technical-college-course-availability",
    title:
      "SC Course Availability: Tri-County Holds 40% Exclusives",
    description:
      "Only 1.7% of SCTCS courses run at every campus. Tri-County Tech holds 40% of all exclusive programs; nursing concentrates at Horry-Georgetown.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "sc",
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "south-carolina",
      "sctcs",
      "anchor-campus",
      "schedule-planning",
    ],
    cluster: "course-availability-guide",
    clusterRole: "spoke",
  },
  {
    slug: "florida-community-college-course-availability",
    title:
      "FL Course Availability: 69.2% Scarcity Despite SCNS (2026)",
    description:
      "Florida's SCNS guarantees transfer, but 69.2% of course IDs are scarce across 10 colleges. Valencia alone holds 69 exclusive courses.",
    date: "2026-05-12",
    category: "registration-timing",
    state: "fl",
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "florida",
      "fcs",
      "anchor-campus",
      "transfer",
      "schedule-planning",
    ],
    cluster: "course-availability-guide",
    clusterRole: "spoke",
  },
  {
    slug: "alabama-community-college-course-availability",
    title:
      "AL Course Availability: Wallace-Dothan Anchors ACCS (2026)",
    description:
      "Alabama's ACCS has 6 colleges and 8,883 sections. Wallace–Dothan holds 17 exclusive courses — the most in the state and the campus that matters.",
    date: "2026-05-12",
    category: "registration-timing",
    state: "al",
    author: "Community College Path",
    tags: [
      "course-availability",
      "registration",
      "alabama",
      "anchor-campus",
      "schedule-planning",
    ],
    cluster: "course-availability-guide",
    clusterRole: "spoke",
  },

  // --- Cluster J: Transfer-receiver patterns (hub + data-driven spokes per issue #367) ---
  {
    slug: "which-universities-are-toughest-transfer-receivers",
    title:
      "Toughest Transfer Receivers: 16-State Data (2026)",
    description:
      "Across 441K transfer mappings in 16 states: Florida is 100% direct match; Georgia is 12% and UGA rejects 78%. Receiver patterns at scale.",
    date: "2026-05-11",
    category: "transfer-confusion",
    state: null,
    author: "Community College Path",
    tags: [
      "transfer",
      "transfer-credit",
      "direct-match",
      "elective-credit",
      "receiver-patterns",
      "transfer-equivalency",
    ],
    cluster: "transfer-receiver-patterns-guide",
    clusterRole: "hub",
  },
  {
    slug: "georgia-transfer-receivers-compared",
    title:
      "GA Transfer Receivers: UGA 12% vs Kennesaw 90% (2026)",
    description:
      "The same TCSG transcript is 90% direct match at Kennesaw but 78–81% rejected at UGA and GSU. How Georgia's 4 major receivers compare.",
    date: "2026-05-11",
    category: "transfer-confusion",
    state: "ga",
    author: "Community College Path",
    tags: [
      "transfer",
      "georgia",
      "tcsg",
      "usg",
      "uga",
      "gsu",
      "kennesaw-state",
      "uwg",
      "receiver-patterns",
    ],
    cluster: "transfer-receiver-patterns-guide",
    clusterRole: "spoke",
  },
  {
    slug: "new-jersey-transfer-receivers-compared",
    title:
      "NJ Transfer Receivers: Rowan 96% vs Rutgers Eng 13%",
    description:
      "NJ's 40 transfer receivers range from 13% to 96% direct match — and the widest spread is within Rutgers itself. Full comparison across 68K mappings.",
    date: "2026-05-12",
    category: "transfer-confusion",
    state: "nj",
    author: "Community College Path",
    tags: [
      "transfer",
      "new-jersey",
      "rutgers",
      "njit",
      "rowan",
      "nj-transfer",
      "receiver-patterns",
    ],
    cluster: "transfer-receiver-patterns-guide",
    clusterRole: "spoke",
  },
  {
    slug: "north-carolina-transfer-receivers-compared",
    title:
      "NC Transfer Receivers: 20% ECU vs 100% WSSU (2026)",
    description:
      "Every NC university takes NCCCS courses for at least elective credit, but direct-match rates run 20% (ECU) to 100% (WSSU, NC A&T) across 25,622 mappings.",
    date: "2026-05-12",
    category: "transfer-confusion",
    state: "nc",
    author: "Community College Path",
    tags: [
      "transfer",
      "north-carolina",
      "ncccs",
      "unc",
      "nc-state",
      "ecu",
      "receiver-patterns",
      "caa",
    ],
    cluster: "transfer-receiver-patterns-guide",
    clusterRole: "spoke",
  },
  {
    slug: "maryland-transfer-receivers-compared",
    title:
      "MD Transfer Receivers: UMGC 30% vs Bowie 99% (2026)",
    description:
      "Across 123K MD transfer mappings, no university rejects outright — but direct-match rates run from 30% at UMGC to 99% at Bowie State.",
    date: "2026-05-12",
    category: "transfer-confusion",
    state: "md",
    author: "Community College Path",
    tags: [
      "transfer",
      "maryland",
      "artsys",
      "umgc",
      "umd",
      "towson",
      "bowie-state",
      "umbc",
      "receiver-patterns",
    ],
    cluster: "transfer-receiver-patterns-guide",
    clusterRole: "spoke",
  },

  // --- Cluster I: Course-code explainer (hub + GSC-driven spokes per issue #368) ---
  {
    slug: "community-college-course-codes-explained",
    title:
      "Community College Course Codes Explained (2026)",
    description:
      "Course codes look the same across states but mean different things. Decode the prefix, level, and suffix — and why the catalog beats the code.",
    date: "2026-05-11",
    category: "mistake-avoidance",
    state: null,
    author: "Community College Path",
    tags: [
      "course-codes",
      "course-catalog",
      "registration",
      "transfer",
      "course-numbering",
    ],
    cluster: "course-explainer-guide",
    clusterRole: "hub",
  },
  {
    slug: "what-is-sdv-100-danville-community-college",
    title:
      "What Is SDV 100 at Danville Community College? (DCC)",
    description:
      "SDV 100 is a 1-credit required course at DCC covering study habits, time management, and academic planning. Who must take it and how it transfers.",
    date: "2026-05-11",
    category: "mistake-avoidance",
    state: "va",
    college: "dcc",
    author: "Community College Path",
    tags: [
      "course-codes",
      "sdv",
      "danville",
      "vccs",
      "college-success",
      "first-semester",
    ],
    cluster: "course-explainer-guide",
    clusterRole: "spoke",
  },
  {
    slug: "what-is-bio-101-danville-community-college",
    title:
      "What Is BIO 101 at Danville Community College? (4 cr)",
    description:
      "BIO 101 at DCC: 4 credits, lecture + lab, no prereqs, 13 sections per term. Direct-match transfer to every VA public university.",
    date: "2026-05-11",
    category: "mistake-avoidance",
    state: "va",
    college: "dcc",
    author: "Community College Path",
    tags: [
      "course-codes",
      "bio",
      "biology",
      "danville",
      "vccs",
      "transfer",
      "stem",
    ],
    cluster: "course-explainer-guide",
    clusterRole: "spoke",
  },
  {
    slug: "what-is-exsc-240-frederick-community-college",
    title:
      "What Is EXSC 240 at Frederick Community College? (3 cr)",
    description:
      "EXSC 240 at Frederick CC: 3-credit hybrid course bridging exercise science to applied work. Direct-match transfer to UMD KNES 214.",
    date: "2026-05-11",
    category: "mistake-avoidance",
    state: "md",
    college: "frederick",
    author: "Community College Path",
    tags: [
      "course-codes",
      "exsc",
      "exercise-science",
      "frederick",
      "maryland",
      "kinesiology",
      "umd-transfer",
    ],
    cluster: "course-explainer-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A: Transfer credit confusion (hub + spokes) ---
  {
    slug: "what-direct-match-vs-elective-credit-means",
    title:
      'Direct Match vs Elective Credit: What Transfer Means',
    description:
      "Your course transferred — but did it actually count? Direct match vs. elective credit, and why the difference decides whether you graduate on time.",
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
      "Virginia VCCS Transfer: What 'Guaranteed Admission' Actually Means (2026)",
    description:
      "Virginia's GAA guarantees a spot at the university — not your major or your credits. What transfers, what doesn't, and how to avoid the most common VCCS transfer mistakes.",
    date: "2026-04-04",
    category: "state-system-explainers",
    state: "va",
    author: "Community College Path",
    tags: ["transfer", "virginia", "vccs", "guaranteed-admission", "gaa"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
    faqs: [
      {
        q: "What does Virginia's Guaranteed Admissions Agreement (GAA) actually guarantee?",
        a: "The GAA guarantees admission to a Virginia public university — not to your preferred major and not that all your credits will transfer. You still need to meet GPA requirements (usually 2.0–3.0 depending on the school and major) and complete specific coursework. Credits transfer only to the extent they match university course equivalencies.",
      },
      {
        q: "Which Virginia universities participate in the GAA?",
        a: "Most Virginia public four-year institutions participate, including George Mason, James Madison, VCU, Virginia Tech, and Old Dominion. Each sets its own GPA floor and major-specific requirements on top of the base GAA terms. Check the VCCS transfer portal for the specific agreement with your target school.",
      },
      {
        q: "Do all VCCS credits transfer to Virginia universities?",
        a: "No. The GAA guarantees admission, not credit acceptance. Each university evaluates VCCS courses individually. A course that transfers as a direct match at GMU may land as a generic elective at VT. Use the VCCS transfer equivalency database before choosing courses if specific credit acceptance matters.",
      },
    ],
  },
  {
    slug: "north-carolina-community-college-unc-transfer-caa",
    title:
      "NC Community College to UNC Transfer: What the CAA Actually Guarantees (2026)",
    description:
      "The Comprehensive Articulation Agreement guarantees junior standing — not major admission. Which courses transfer as a block, the GPA minimums, and the gaps that catch NC students off guard.",
    date: "2026-04-04",
    category: "state-system-explainers",
    state: "nc",
    author: "Community College Path",
    tags: ["transfer", "north-carolina", "ncccs", "unc", "caa"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
    faqs: [
      {
        q: "What does the NC Comprehensive Articulation Agreement (CAA) guarantee?",
        a: "The CAA guarantees junior standing at any UNC System school for students who complete the Associate in Arts or Associate in Science with a cumulative GPA of 2.0 or higher. It does not guarantee admission to competitive or impacted majors — nursing, engineering, and business programs set additional requirements on top of the CAA.",
      },
      {
        q: "Which courses transfer under the NC CAA?",
        a: "The CAA defines a Universal General Education Transfer Component (UGETC) — a set of courses that transfer as direct general education credit at all UNC System schools. Non-UGETC courses may transfer as electives or not at all, depending on the receiving university. Completing the full AA or AS is the safest path to maximizing accepted credits.",
      },
      {
        q: "What GPA do I need to transfer from a NC community college to UNC?",
        a: "The CAA base requirement is a 2.0 cumulative GPA. However, most UNC System universities require 2.5–3.0 for admission to specific majors, and competitive programs (nursing, engineering, business) often set higher bars. Check your target school's transfer admissions page for major-specific GPA requirements.",
      },
    ],
  },

  // --- Cluster B: Senior waivers and auditing (hub + spokes) ---
  {
    slug: "free-community-college-classes-for-seniors",
    title:
      "Free Community College for Seniors (60+): All 17 States Listed (2026)",
    description:
      "17 states waive tuition for residents 60–65+ at public community colleges. Compare age thresholds, credit vs. audit rules, income limits, and hidden fees for every state.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: null,
    author: "Community College Path",
    tags: ["seniors", "tuition-waiver", "auditing", "free-classes"],
    cluster: "senior-waivers-guide",
    clusterRole: "hub",
    faqs: [
      {
        q: "Which states offer free community college classes for seniors?",
        a: "Several states waive community college tuition for senior residents, including Virginia (60+), North Carolina (65+), South Carolina (60+), and the District of Columbia (65+). Age thresholds, residency rules, and what's actually covered (auditing vs credit) vary by state.",
      },
      {
        q: "What does \"space permitting\" mean for senior tuition waivers?",
        a: "It means seniors register after credit-seeking students. If a class is already full when senior registration opens, you cannot enroll. Popular gen-ed and online sections fill fastest; niche electives, morning sections, and late-start courses tend to have more availability.",
      },
      {
        q: "Does a senior tuition waiver cover credits or just auditing?",
        a: "It depends on the state. North Carolina's waiver covers auditing only — no grade, no credit. Virginia waives tuition for auditing but charges a reduced rate for credit enrollment. Always confirm with the college before you register.",
      },
      {
        q: "Are there income limits for senior tuition waivers?",
        a: "Some states impose income caps. Virginia, for example, requires taxable income below roughly $29,000 for the credit-bearing waiver — auditing is free regardless. Most other states do not have an income test, but residency is always required.",
      },
    ],
  },
  {
    slug: "virginia-senior-citizens-community-college-free-tuition",
    title:
      "VA Free College for 60+: Tuition vs Audit (2026)",
    description:
      "VA residents 60+ can take community college classes free — but credit enrollment has an income cap. Here's how the waiver actually works.",
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
      "NC Free College for 65+: All 58 Campuses (Audit Only)",
    description:
      "North Carolina waives tuition at all 58 community colleges for residents 65+. Audit-only — no grade, no credit. How to register.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: "nc",
    author: "Community College Path",
    tags: ["seniors", "north-carolina", "ncccs", "tuition-waiver", "auditing"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },
  {
    slug: "maryland-senior-citizens-community-college-tuition-waiver",
    title:
      "MD Free College for 60+: All 16 Campuses (No Cap)",
    description:
      "Maryland waives tuition for residents 60+ at all 16 community colleges — no income cap, no retirement requirement. Here's how to use it.",
    date: "2026-05-02",
    category: "senior-waivers",
    state: "md",
    author: "Community College Path",
    tags: ["seniors", "maryland", "tuition-waiver", "auditing", "macc"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },
  {
    slug: "new-jersey-senior-citizens-county-college-tuition-waiver",
    title:
      "NJ Free County College for 65+ (Credit OK, 2026)",
    description:
      "NJ law waives tuition at all 18 county colleges for residents 65+ — credit enrollment, not just auditing. Here's exactly how to use it.",
    date: "2026-05-02",
    category: "senior-waivers",
    state: "nj",
    author: "Community College Path",
    tags: ["seniors", "new-jersey", "tuition-waiver", "njccc", "county-college"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },
  {
    slug: "massachusetts-senior-citizens-community-college-tuition-waiver",
    title:
      "MA Free College for 60+: All 15 Campuses (No Cap)",
    description:
      "Massachusetts waives tuition for residents 60+ at all 15 community colleges — no income cap, no retirement requirement. Here's how to use it.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "ma",
    author: "Community College Path",
    tags: ["seniors", "massachusetts", "tuition-waiver", "auditing", "masscc"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },
  {
    slug: "florida-community-college-transfer-credit-guide",
    title:
      "FL Transfer Credit: SCNS Guarantees 100% Direct Match",
    description:
      "Florida's SCNS makes 100% of CC courses direct matches at every public university — but prereqs, limited-access majors, and excess hours trip you up.",
    date: "2026-05-09",
    category: "state-system-explainers",
    state: "fl",
    author: "Community College Path",
    tags: ["transfer", "florida", "fcs", "scns", "2+2"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster E: Auditing-at-college (hub + future per-college spokes) ---
  {
    slug: "what-does-audit-a-class-mean",
    title:
      'What Does "Audit a Class" Mean? (Community College)',
    description:
      "Auditing means attending a course without earning credits or a grade. Here's who does it, how it works, and what it costs.",
    date: "2026-04-04",
    category: "senior-waivers",
    state: null,
    author: "Community College Path",
    tags: ["auditing", "audit-vs-credit", "community-college"],
    cluster: "audit-at-college-guide",
    clusterRole: "hub",
  },

  // --- Cluster G: Late-start by state (hub + future state spokes) ---
  {
    slug: "how-to-find-late-start-community-college-classes",
    title:
      "Late-Start Community College Classes: How to Find Them",
    description:
      "Late-start sections are 8.5% of CC fall offerings nationally — but range from 18% in NH to 1% in ME. Here's how to find them and what varies by state.",
    date: "2026-04-04",
    category: "registration-timing",
    state: null,
    author: "Community College Path",
    tags: ["late-start", "mini-session", "registration", "accelerated", "density"],
    cluster: "late-start-by-state-guide",
    clusterRole: "hub",
    howTo: {
      name: "How to find late-start community college classes",
      steps: [
        { name: "Filter by start date", text: "Use your college's course search tool to sort or filter by date. Look for courses starting 2-8 weeks after the semester's official start date." },
        { name: "Look for session indicators", text: "Many colleges label late-start sections with codes like '2nd 8-week,' 'Mini-Session 2,' '12W,' or 'Dynamic.' The labels vary by institution but all indicate a non-standard start date." },
        { name: "Check online sections first", text: "Online courses are more likely to have late-start options than in-person sections. Colleges can run more online sections with less scheduling friction." },
        { name: "Verify registration deadlines", text: "Late-start courses have their own registration deadlines, usually 1-3 days before the section starts. Drop and withdrawal deadlines are also compressed. Don't assume you have as much time as a full-term course." },
      ],
    },
    faqs: [
      {
        q: "What are late-start community college classes?",
        a: "Late-start classes (also called mini-sessions, second-start, or accelerated sections) are regular college courses that begin weeks or months after the main semester starts. They're compressed into 8, 10, or 12 weeks instead of the full 16, but cover the same material, carry the same credits, and transfer the same way.",
      },
      {
        q: "Do late-start classes count the same as full-term classes for transfer?",
        a: "Yes. A late-start section of a course has the same course number, same credits, and same transfer equivalency as a full-term section. Universities do not distinguish between a 16-week and an 8-week section of the same course.",
      },
      {
        q: "How do I find late-start classes at my community college?",
        a: "Filter your college's course search by start date (look for courses starting 2-8 weeks after the semester begins), look for session labels like '2nd 8-week' or 'Mini-Session 2,' and check online sections first — they're more likely to have late-start options.",
      },
      {
        q: "How common are late-start classes at community colleges?",
        a: "Nationally, late-start sections make up about 8.5% of fall offerings, but this varies dramatically by state — from 18% in New Hampshire to 1.3% in Maine. Individual colleges vary even more: some run 30%+ late-start sections while others offer almost none.",
      },
    ],
  },

  // --- Standalone: Transfer verification ---
  {
    slug: "how-to-check-if-community-college-course-transfers",
    title:
      "Will My CC Course Transfer? Check Before You Enroll",
    description:
      "Checking transfer equivalencies before registration takes 15 minutes. Not checking can cost you a semester. Here's the step-by-step process.",
    date: "2026-04-04",
    category: "transfer-confusion",
    state: null,
    author: "Community College Path",
    tags: ["transfer", "equivalency", "course-planning"],
    howTo: {
      name: "How to check if a community college course transfers",
      steps: [
        { name: "Know your target university", text: "Identify at least a shortlist of universities you plan to transfer to. Transfer equivalencies are university-specific — the same course can be a direct match at one school and elective credit at another." },
        { name: "Find the transfer equivalency table", text: "Look up the state community college system's published transfer information. Virginia uses the SCHEV Transfer Guide; North Carolina uses the Comprehensive Articulation Agreement. Each shows course-by-course mappings." },
        { name: "Read the equivalency type", text: "Check whether the course maps to a specific course number (direct match) or a generic designation like ELEC 1XX or FREE ELEC (elective credit). Direct matches fulfill requirements; elective credit just fills total hours." },
        { name: "Check your major's requirements", text: "Verify the course satisfies your major-specific requirements, not just general education. A psychology major may need a specific statistics course, not just 'any math.' Check the target major's curriculum sheet." },
        { name: "Verify with an advisor", text: "Do your research first, build a list of courses with their mappings, then bring it to an advisor and ask them to verify. This catches mistakes before registration, not after." },
      ],
    },
  },

  // --- Standalone: Multi-college enrollment ---
  {
    slug: "taking-classes-at-multiple-community-colleges",
    title:
      "Can You Enroll at Two Community Colleges at the Same Time? (Yes — Here's How)",
    description:
      "Most students don't know dual enrollment is allowed. How financial aid, consortium agreements, transcripts, and transfer credits work when you're registered at two colleges at once.",
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
      "How to Build a Multi-Campus CC Schedule (Step-by-Step)",
    description:
      "Multi-campus scheduling takes more planning, but it's entirely doable. A step-by-step system for building a workable schedule across locations.",
    date: "2026-04-04",
    category: "cross-college-scheduling",
    state: null,
    author: "Community College Path",
    tags: ["scheduling", "multi-campus", "schedule-builder", "commute"],
    howTo: {
      name: "How to build a community college schedule across multiple campuses",
      steps: [
        { name: "Lock in must-have courses first", text: "Start with prerequisites, major requirements, and courses only offered once a year. Register for these first at whichever campus offers them — they become your schedule anchors." },
        { name: "Map your weekly time blocks", text: "Sketch work hours, commute times between campuses, childcare obligations, and study time. Account for real-world travel: a 45-minute drive needs at least a 90-minute gap between classes." },
        { name: "Cluster days by location", text: "Assign each campus to specific days (e.g., Mon/Wed at Campus A, Tue/Thu at Campus B, Fri online). This minimizes driving and creates natural study blocks." },
        { name: "Use online courses to fill gaps", text: "Online sections don't require travel and can fill credit-hour requirements without adding commute days. Use them for subjects where lecture attendance isn't critical." },
        { name: "Check for hidden conflicts", text: "Verify final exam schedules, lab hours not shown in the main schedule, and academic calendar differences between colleges. A schedule that works weeks 1-8 but breaks in week 9 isn't workable." },
        { name: "Handle financial aid early", text: "If taking courses at more than one college, set up a consortium agreement between schools so combined credits count toward your enrollment status. Ask your home college's financial aid office before registering at the second school." },
        { name: "Keep a master schedule", text: "Maintain a single document with every course, section number, days/times/locations, start and end dates, instructor contact info, and key deadlines. Neither college sees your full picture — this is your source of truth." },
      ],
    },
  },

  // --- Standalone: Schedule timing ---
  {
    slug: "when-do-community-college-schedules-go-live",
    title:
      "When Do Community College Schedules Go Live? (2026)",
    description:
      "Community college classes run morning, afternoon, or evening blocks. When the schedule for next semester posts, and how to grab seats early.",
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
      "NC Transfer Guides: How to Use Them Without Getting Lost",
    description:
      "NC has transfer guides, equivalency tables, and pre-major pathways — but most students don't know how to find or read them. Practical walkthrough.",
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
      "Georgia Community College Transfer Credits: UGA, Georgia Tech & GSU (2026)",
    description:
      "The same TCSG course can be a direct match at Georgia Tech and worth nothing at UGA. See how credits transfer across all 5 Georgia public universities — and how to maximize what counts.",
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
      "Why the Same Community College Course Transfers Differently at Every University",
    description:
      "Two universities can evaluate the same transcript and reach opposite conclusions. How direct matches vs. elective credit work — and how to compare schools before you commit.",
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
      "SC Tech College Transfer: USC, Clemson & Others (2026)",
    description:
      "SC technical college credits transfer to public universities, but equivalencies vary by school. How the system works and how to check first.",
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
      "South Carolina Free College for Seniors 60+: Full Credit Courses Included",
    description:
      "SC waives tuition at all 16 technical colleges for residents 60+. Unlike most states, the waiver covers credit-bearing courses — not just auditing. Eligibility, enrollment steps, and what fees still apply.",
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
      "DC Free College for 65+ at UDC: What's Covered (2026)",
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
      "MD Transfer Credit: ARTSYS Guide for 8 Universities (2026)",
    description:
      "MD's ARTSYS has 122K+ transfer equivalencies across 8 universities — but the same course can be a direct match at Towson and elective at UMGC.",
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
      "CUNY Community College Transfer Credit Guide (2026)",
    description:
      "CUNY's 7 CCs feed 14 senior colleges. Brooklyn accepts 68% as direct matches; Medgar Evers rejects 57%. What to know before you transfer.",
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
      "Online vs. In-Person Community College: Which Is Actually Easier? (Data)",
    description:
      "Online completion rates run 10–15% lower than in-person. Hybrid still has mandatory attendance days. Compare real completion data, workload, and schedule flexibility before you choose a format.",
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
      "NJ Community College Transfer Credits: Which Universities Accept the Most (2026)",
    description:
      "We analyzed every NJTransfer.org equivalency across 40 NJ universities. Rutgers, Rowan, NJIT, and Montclair — see acceptance rates by school and what to do when a course maps to elective credit.",
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
      "Transfer Credit Across States: 300K+ Mappings (2026)",
    description:
      "We analyzed 300K+ transfer equivalencies across 12 states. Direct-match rates range 12% to 56%. What it means for your transfer plan.",
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
      "PA Transfer Credit: Penn State, Pitt, Temple (2026)",
    description:
      "PA has 14 community colleges but no statewide articulation. Penn State, Pitt, Temple & others each evaluate credits independently — see how it plays out.",
    date: "2026-04-20",
    category: "state-system-explainers",
    state: "pa",
    author: "Community College Path",
    tags: ["transfer", "pennsylvania", "penn-state", "pitt", "temple", "pa-trac", "ccp"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: MA MassTransfer ---
  {
    slug: "massachusetts-community-college-transfer-credit-guide",
    title:
      "MA Transfer Credit: MassTransfer Guide (2026)",
    description:
      "MA has 46K+ MassTransfer mappings, but more than half come back as elective credit at UMass Amherst. How to read MassTransfer before you register.",
    date: "2026-05-02",
    category: "state-system-explainers",
    state: "ma",
    author: "Community College Path",
    tags: ["transfer", "massachusetts", "masscc", "masstransfer", "umass"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: NH CCSNH transfer ---
  {
    slug: "new-hampshire-ccsnh-transfer-credit-guide",
    title:
      "NH Transfer Credit: CCSNH Guide for 7 Colleges (2026)",
    description:
      "NH has 7 CCSNH colleges and published equivalencies for only one university so far — Keene State, at 31.1% direct match. What that means for transfer.",
    date: "2026-05-04",
    category: "state-system-explainers",
    state: "nh",
    author: "Community College Path",
    tags: ["transfer", "new-hampshire", "ccsnh", "keene-state", "unh"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster A spoke: TN TBR transfer ---
  {
    slug: "tennessee-tbr-community-college-transfer-guide",
    title:
      "TN TBR Transfer Credit: Easier Than Most States (2026)",
    description:
      "TN is the only state with common course numbering across all 13 CCs — ENGL 1010 is ENGL 1010 everywhere. Why that matters and how TTP works.",
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
      "Delaware has one CC (DTCC, four campuses) and three primary transfer destinations: UDel, Delaware State, Wilmington. How Connected Degree works.",
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
      "CT State Community College: 2023 Merger Explained",
    description:
      "Connecticut merged 12 community colleges into one accredited institution in 2023. One transcript, one catalog — here's what changed and what didn't.",
    date: "2026-04-20",
    category: "state-system-explainers",
    state: "ct",
    author: "Community College Path",
    tags: ["transfer", "connecticut", "ct-state", "caga", "ccsu", "ecsu", "scsu", "merger"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
  },

  // --- Cluster D: Prereq chains (hub + state-specific spokes) ---
  {
    slug: "prerequisite-chains-why-four-semester-plans-take-six",
    title:
      "Why a 2-Year Community College Plan Takes 3 Years",
    description:
      "Across 12 states, 40–60% of CC courses have a prereq, and chains go 4+ levels deep. How to spot them before you register, with real catalog data.",
    date: "2026-04-20",
    category: "mistake-avoidance",
    state: null,
    author: "Community College Path",
    tags: ["prerequisites", "planning", "two-year-degree", "course-sequence", "developmental"],
    cluster: "prereq-chains-guide",
    clusterRole: "hub",
    faqs: [
      {
        q: "What percentage of community college courses have prerequisites?",
        a: "Across the 12 community college systems indexed, roughly 40-60% of courses have at least one prerequisite. A meaningful share have chains two, three, or four levels deep — especially in math, science, and nursing sequences.",
      },
      {
        q: "Why does a two-year degree take longer than two years?",
        a: "Prerequisite chains are a major contributor. Students who place into developmental math or English face 1-4 extra semesters of catch-up courses before they can start their major-track classes. Only about 15% of community college students finish an associate degree in two years.",
      },
      {
        q: "How do I plan around prerequisite chains?",
        a: "Start with your destination major's last required course and work backwards to the community college level. Take placement tests early — where you place in math and English determines your entire runway. Budget a failure buffer so one bad semester doesn't reset your timeline by 6-12 months.",
      },
      {
        q: "Do minimum grade requirements affect prerequisite chains?",
        a: "Yes. 'Prereq: ENG 101' is different from 'Prereq: ENG 101 with C or better.' Some programs — nursing is notorious — require B+ or better in prereqs. A grade below the minimum means retaking the course, which adds a semester to your plan.",
      },
    ],
  },
  // --- Pipeline batch 2026-05-09d: FL prereq spoke ---
  {
    slug: "florida-community-college-prereq-bottlenecks",
    title:
      "FL Prereq Chains: Dev English Gates 319 Courses (2026)",
    description:
      "ENC 0025 gates 319 downstream courses in Florida's FCS — the system's most consequential course. The nursing chain reaches 22 levels deep.",
    date: "2026-05-09",
    category: "mistake-avoidance",
    state: "fl",
    author: "Community College Path",
    tags: ["prerequisites", "florida", "fcs", "developmental", "bottlenecks", "course-sequence", "nursing"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "georgia-community-college-prereq-bottlenecks",
    title:
      "GA Prereq Chains: Dev English Gates 1,400+ (2026)",
    description:
      "Across TCSG's 22 colleges, developmental English and reading sit at the base of prereq chains for 1,400+ downstream courses. How to sequence them.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "ga",
    author: "Community College Path",
    tags: ["prerequisites", "georgia", "tcsg", "developmental", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "maryland-community-college-prereq-bottlenecks",
    title:
      "MD Prereq Chains: ESOL & Dev English Gate 400+ (2026)",
    description:
      "Across MD's 16 CCs, ESOL and developmental English gate 400+ courses. Surgical Tech and nursing chains run 14 levels deep — how to sequence them.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "md",
    author: "Community College Path",
    tags: ["prerequisites", "maryland", "esol", "developmental", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "north-carolina-community-college-prereq-bottlenecks",
    title:
      "NC Prereq Chains: ACA 085 Gates 900+ Courses (2026)",
    description:
      "Across NCCCS's 58 colleges, ACA 085 and developmental English gate 900+ downstream courses. Nursing and EMS chains run 15 levels deep.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "nc",
    author: "Community College Path",
    tags: ["prerequisites", "north-carolina", "ncccs", "developmental", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "south-carolina-technical-college-prereq-bottlenecks",
    title:
      "SC Prereq Chains: RDG 100 Gates 460+ Courses (2026)",
    description:
      "Across SCCTCS colleges, RDG 100 and developmental English gate 460+ downstream courses. The nursing chain runs 21 levels deep — sequence carefully.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "sc",
    author: "Community College Path",
    tags: ["prerequisites", "south-carolina", "scctcs", "developmental", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "delaware-technical-community-college-prereq-bottlenecks",
    title:
      "DE Prereq Chains: SSC 100 Gates 606 Courses (2026)",
    description:
      "At Del Tech, SSC 100 sits upstream of 606 courses — more than any English or math prereq. Engineering and MLT chains reach depth 9.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "de",
    author: "Community College Path",
    tags: ["prerequisites", "delaware", "dtcc", "developmental", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "massachusetts-community-college-prereq-bottlenecks",
    title:
      "MA Prereq Chains: Dev English Gates 400+ (2026)",
    description:
      "Across MA CCs, ENG 109 and related developmental courses gate 400+ downstream courses. Nursing chains reach depth 13. English is the planning variable.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "ma",
    author: "Community College Path",
    tags: ["prerequisites", "massachusetts", "mcccs", "developmental", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "last-day-to-add-drop-community-college-class",
    title:
      "Last Day to Add/Drop a Community College Class (2026)",
    description:
      "Add deadlines run 1–2 weeks into the semester for full-term courses but days for late-start sections. The three key deadlines and how to find yours.",
    date: "2026-05-10",
    category: "registration-timing",
    state: null,
    author: "Community College Path",
    tags: ["add-drop", "registration", "deadlines", "late-start", "financial-aid"],
  },

  // --- Cluster A spoke: transfer equivalency reading ---
  {
    slug: "how-to-read-transfer-equivalency-table",
    title:
      "How to Read a CC Transfer Equivalency Table (2026)",
    description:
      "Transfer tables use notation nobody teaches: direct match vs. elective, wildcards, grade minimums, credit caps. Decode them before you lose a semester.",
    date: "2026-04-20",
    category: "transfer-confusion",
    state: null,
    author: "Community College Path",
    tags: ["transfer", "equivalency", "direct-match", "elective-credit", "notation"],
    cluster: "transfer-credit-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to read a community college transfer equivalency table",
      steps: [
        { name: "Identify the three basic outcomes", text: "Every course maps to one of three buckets: direct match (a specific course number like ENG 101), elective credit (a generic designation like BIOL 1XX or Gen Elec), or no credit / does not transfer." },
        { name: "Check restriction notation", text: "Look for grade minimums (C or better, B or better), credit caps (max 3 cr, max 60 cr total), time limits (within 10 years), and 'combines with' requirements that pair courses together." },
        { name: "Decode wildcards and prefixes", text: "Understand compact notation: 1XX means any 100-level course, 2XX means 200-level, Gen Elec means any elective credit. These tell you the level of credit awarded without a specific course match." },
        { name: "Read the footnotes", text: "Never ignore asterisks. Footnotes contain critical restrictions: admission-year cutoffs, writing-intensive exclusions, credit caps across equivalents, and department-specific applicability." },
        { name: "Verify with the receiving institution", text: "Check the table's effective date, confirm with an advisor for courses close to requirements you need, request an official transfer evaluation, and get written confirmation attached to your transcript." },
      ],
    },
  },

  // --- Cluster B spoke: 15-state senior tuition comparison ---
  {
    slug: "senior-citizen-community-college-tuition-all-15-states",
    title:
      "Senior College Tuition: 15 States Compared (2026)",
    description:
      "Age thresholds, income caps, audit-only vs. credit. Senior tuition waiver rules vary dramatically — complete comparison matrix for all 15 states.",
    date: "2026-04-20",
    category: "senior-waivers",
    state: null,
    author: "Community College Path",
    tags: ["seniors", "tuition-waiver", "auditing", "comparison", "all-states"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },

  // --- Cluster B spoke: TN seniors ---
  {
    slug: "tennessee-senior-citizens-tbr-community-colleges",
    title:
      "TN Free College for 65+: TBR Tuition Waiver (2026)",
    description:
      "Tennessee residents 65+ take credit courses at TBR community colleges with tuition waived under § 49-7-113. A $70/term service fee still applies.",
    date: "2026-05-04",
    category: "senior-waivers",
    state: "tn",
    author: "Community College Path",
    tags: ["seniors", "tennessee", "tbr", "tuition-waiver", "65-plus"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },

  // --- Cluster F: Course format density (hub + future state spokes) ---
  {
    slug: "hybrid-community-college-classes-explained",
    title:
      "Hybrid Community College Classes: The Hidden Third Option",
    description:
      "Hybrid courses are 4.7% of CC offerings nationally — but vary 0% to 14.6% by state. What hybrid actually is, including HyFlex, and when it wins.",
    date: "2026-04-20",
    category: "course-format-density",
    state: null,
    author: "Community College Path",
    tags: ["hybrid", "hyflex", "online", "in-person", "course-format", "scheduling", "density"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "hub",
    faqs: [
      {
        q: "What is a hybrid community college class?",
        a: "A hybrid class blends in-person and online components. Some portion of class time happens synchronously in a physical classroom, and the rest happens asynchronously online. Common formats include 50/50 splits (one in-person meeting per week plus online work), front-loaded hybrids, and periodic in-person sessions for exams or labs.",
      },
      {
        q: "What is HyFlex and how is it different from hybrid?",
        a: "HyFlex is a subset of hybrid that gives students per-class flexibility. Each class session is offered simultaneously in-person, synchronously online via Zoom, and asynchronously via recording. You choose which modality to use each week. It started as a pandemic response but several colleges have kept it permanently.",
      },
      {
        q: "Do hybrid classes transfer the same as in-person classes?",
        a: "Yes. A hybrid section transfers as a regular credit-bearing course. The receiving university doesn't see or care about the delivery format — only the course number and credits matter. Format flexibility costs you nothing on transfer.",
      },
      {
        q: "How common are hybrid classes at community colleges?",
        a: "Nationally, hybrid sections are about 4.7% of all offerings, but this varies widely by state. Maryland leads at 14.6%, followed by Massachusetts at 14.2% and Virginia at 11.3%. Some states like Florida and Tennessee report near-zero hybrid sections, though this often reflects labeling differences rather than a true absence of blended courses.",
      },
    ],
  },

  // --- Cluster C: Sessions and academic calendar timing (hub + future spokes) ---
  {
    slug: "community-college-sessions-explained",
    title:
      "Community College Sessions Explained (2026)",
    description:
      "CC schedules look like one 16-week term but contain a stack of overlapping sessions. Each format, when to use which, and how to stack them faster.",
    date: "2026-05-09",
    category: "session-timing",
    state: null,
    author: "Community College Path",
    tags: ["sessions", "session-timing", "academic-calendar", "8-week", "mini-mester", "summer", "scheduling"],
    cluster: "session-timing-guide",
    clusterRole: "hub",
    faqs: [
      {
        q: "What's the difference between a full-term and 8-week community college class?",
        a: "Full-term classes run for the standard 15-16 weeks of the semester. 8-week classes cover the same content and award the same credits, but meet twice as often or twice as long to fit into half the calendar. Each 8-week session has its own registration, drop, and refund deadlines separate from the main term.",
      },
      {
        q: "What is a mini-mester?",
        a: "A mini-mester (also called intersession, winter session, or May-mester) is a compressed 2-5 week term, usually wedged between fall and spring or spring and summer. Course content from a full 3-credit class is delivered in a few weeks of intensive meetings — roughly 36 hours per week of total work for a single course.",
      },
      {
        q: "Are 8-week or summer credits worth less than full-term credits?",
        a: "No. A 3-credit course is a 3-credit course regardless of session length. Credits transfer the same, count toward financial aid the same, and post to your transcript the same. What changes is the weekly workload, not the value of the credit.",
      },
      {
        q: "Can I take 8-week classes back-to-back to fit two courses in one semester?",
        a: "Yes — this is one of the most common ways students compress an associate degree timeline. Take one course in the first 8-week session, finish it, then take another in the second 8-week session. You earn 6 credits over the same calendar period as a single full-term course.",
      },
    ],
  },

  // --- Cluster C spoke: MD session timing ---
  {
    slug: "maryland-community-college-session-timing-guide",
    title:
      "MD College Sessions: 93 Start Dates at AACC (2026)",
    description:
      "AACC alone has 93 distinct start dates per term. How MD's 16 CCs structure session length, when each format helps, and how to spot the right one.",
    date: "2026-05-09",
    category: "session-timing",
    state: "md",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "maryland", "8-week", "mini-mester", "macc"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },

  // --- Cluster E spoke: Germanna audit-at-college (per-college) ---
  {
    slug: "germanna-community-college-audit-class-guide",
    title:
      "Audit a Class at Germanna CC: Cost & How-To (2026)",
    description:
      "Germanna allows auditing at full credit cost — or free for VA residents 60+. Application, constraints, and when auditing makes sense.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "gcc",
    author: "Community College Path",
    tags: ["auditing", "virginia", "germanna", "vccs", "senior-waiver"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Germanna Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact the registrar", text: "Email admissions@germanna.edu or call 540-423-9030 with the course code and section number. They will confirm the section is open to auditors and walk you through any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal Germanna enrollment system. Most audit registrations are completed by the registrar based on your email request, though some terms require you to submit a separate audit-status form." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Otherwise you pay full credit-equivalent rates." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline — typically end of the second week." },
      ],
    },
  },

  // --- Pipeline batch 2026-05-09b: 7 state-spokes + 3 college-spokes ---

  // Cluster C spokes (session-timing): TN, MA, NY, NC, VA, CT
  {
    slug: "tennessee-community-college-session-timing-guide",
    title:
      "TN College Sessions: 62 Start Dates at Northeast (2026)",
    description:
      "Northeast State publishes 62 distinct start dates per term. How TBR's 12 CCs structure session length and how to find the right one before you register.",
    date: "2026-05-09",
    category: "session-timing",
    state: "tn",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "tennessee", "tbr", "8-week", "wintermester"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },
  {
    slug: "massachusetts-community-college-session-timing-guide",
    title:
      "MA College Sessions: 8-Week & Summer Formats (2026)",
    description:
      "MassCC runs leaner session menus than peer states. How the 15 colleges structure session length — and where Middlesex and Greenfield go deepest.",
    date: "2026-05-09",
    category: "session-timing",
    state: "ma",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "massachusetts", "masscc", "8-week", "intersession"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },
  {
    slug: "new-york-cuny-community-college-session-timing-guide",
    title:
      "CUNY College Sessions: 8-Week, Winter & Summer (2026)",
    description:
      "CUNY's 7 CCs run a centrally synchronized session menu — narrower than peer systems but with a unique cross-campus advantage in winter and summer.",
    date: "2026-05-09",
    category: "session-timing",
    state: "ny",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "new-york", "cuny", "8-week", "winter-session"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },
  {
    slug: "north-carolina-community-college-session-timing-guide",
    title:
      "NC College Sessions: 49 Start Dates at CPCC (2026)",
    description:
      "Central Piedmont alone publishes 49 distinct start dates per term. How NCCCS's 58 CCs structure session length and how to find the right one.",
    date: "2026-05-09",
    category: "session-timing",
    state: "nc",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "north-carolina", "ncccs", "8-week", "mini-session"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },
  {
    slug: "virginia-community-college-session-timing-guide",
    title:
      "VA College Sessions: 74 Start Dates at TCC (2026)",
    description:
      "TCC publishes 74 distinct start dates per term. How VCCS's 23 CCs structure session length, including the dynamic-dated sections unique to VA.",
    date: "2026-05-09",
    category: "session-timing",
    state: "va",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "virginia", "vccs", "8-week", "dynamic-dated"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },
  {
    slug: "connecticut-state-community-college-session-timing-guide",
    title:
      "CT State Sessions: Unified 12-Campus System (2026)",
    description:
      "CT State's 2023 merger created a unified 12-campus system. How it affects session diversity and cross-campus enrollment for 8-week and summer formats.",
    date: "2026-05-09",
    category: "session-timing",
    state: "ct",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "connecticut", "ct-state", "8-week", "unified-system"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },

  // Cluster B spoke: NY senior waivers
  {
    slug: "new-york-cuny-senior-citizens-tuition-waiver",
    title:
      "NY CUNY Free Audit for 60+: How It Works (2026)",
    description:
      "NY § 6304(5) waives tuition for residents 60+ at all 7 CUNY community colleges — audit only, no credit. What's covered and state comparisons.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "ny",
    author: "Community College Path",
    tags: ["seniors", "new-york", "cuny", "tuition-waiver", "auditing", "audit-only"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },

  // Cluster E spokes (audit-at-college): NOVA, Reynolds, TCC
  {
    slug: "nova-northern-virginia-community-college-audit-class-guide",
    title:
      "Audit a Class at NOVA: Cost & How-To (2026)",
    description:
      "NOVA, VA's largest CC, allows auditing at full credit cost — or free for VA residents 60+. The process across six campuses and online catalog.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "nova",
    author: "Community College Path",
    tags: ["auditing", "virginia", "nova", "vccs", "senior-waiver", "northern-virginia"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Northern Virginia Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact admissions", text: "Email admissions@nvcc.edu or call 703-323-3000 with the course code, section number, campus, and delivery mode. They will confirm availability and handle any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal NOVA enrollment system. Admissions may complete the registration on your behalf, or you submit an audit-status form before the add/drop deadline." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Otherwise you pay full credit-equivalent rates." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline." },
      ],
    },
  },
  {
    slug: "reynolds-community-college-audit-class-guide",
    title:
      "Audit a Class at Reynolds CC: Cost & How-To (2026)",
    description:
      "Reynolds CC in central VA allows auditing at full credit cost — or free for VA residents 60+. The process across three Richmond-area campuses.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "reynolds",
    author: "Community College Path",
    tags: ["auditing", "virginia", "reynolds", "vccs", "senior-waiver", "richmond"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Reynolds Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact admissions", text: "Email admissions@reynolds.edu or call 804-371-3000 with the course code, section number, and campus. They will confirm availability and handle any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal Reynolds enrollment system. Admissions may complete the registration on your behalf, or you submit an audit-status form before the add/drop deadline." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Otherwise you pay full credit-equivalent rates." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline." },
      ],
    },
  },
  {
    slug: "tcc-tidewater-community-college-audit-class-guide",
    title:
      "Audit a Class at Tidewater CC: Cost & How-To (2026)",
    description:
      "TCC serves Hampton Roads with four campuses and a military-affiliated student body. Auditing rules, cost (free for 60+), and notes for veterans.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "tcc",
    author: "Community College Path",
    tags: ["auditing", "virginia", "tcc", "tidewater", "vccs", "senior-waiver", "hampton-roads"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Tidewater Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact admissions", text: "Email admissions@tcc.edu or call 757-822-1122 with the course code, section number, and campus. They will confirm availability and handle any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal TCC enrollment system. Admissions may complete the registration on your behalf, or you submit an audit-status form before the add/drop deadline." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Military TA and GI Bill do not cover audit enrollment." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline." },
      ],
    },
  },

  // --- Pipeline batch 2026-05-09c: 4 senior-waiver state-spokes + 1 session + 5 audit college-spokes ---

  // Cluster B spokes (senior-waivers): CT, GA, PA, FL
  {
    slug: "connecticut-senior-citizens-ct-state-tuition-waiver",
    title:
      "CT Free Audit for 62+: CT State Community College",
    description:
      "CGS § 10a-27 lets CT residents 62+ audit courses at CT State CC tuition-free. What's covered and how the unified-system structure affects access.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "ct",
    author: "Community College Path",
    tags: ["seniors", "connecticut", "ct-state", "tuition-waiver", "auditing", "audit-only"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },
  {
    slug: "georgia-senior-citizens-tcsg-tuition-waiver",
    title:
      "GA Free College for 62+: TCSG Credit Waiver (2026)",
    description:
      "OCGA 20-4-20 waives tuition at all 22 TCSG technical colleges for residents 62+ — covering credit enrollment, not just audit. How to use it.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "ga",
    author: "Community College Path",
    tags: ["seniors", "georgia", "tcsg", "tuition-waiver", "credit-eligible"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },
  {
    slug: "pennsylvania-senior-citizens-community-college-tuition-waiver",
    title:
      "PA Free Audit for 60+ at All 14 Community Colleges",
    description:
      "24 P.S. § 19-1908-B lets PA residents 60+ audit CC courses tuition-free. How it works across 14 colleges and the sponsor-district rule.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "pa",
    author: "Community College Path",
    tags: ["seniors", "pennsylvania", "tuition-waiver", "auditing", "audit-only"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },
  {
    slug: "florida-senior-citizens-fcs-tuition-waiver",
    title:
      "FL Free College for 60+: FCS Waiver Catch (2026)",
    description:
      "FL § 1009.26(4) waives tuition at all 28 FCS colleges for residents 60+ — but credit earned doesn't count toward a degree. What that means.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "fl",
    author: "Community College Path",
    tags: ["seniors", "florida", "fcs", "tuition-waiver", "fee-waiver"],
    cluster: "senior-waivers-guide",
    clusterRole: "spoke",
  },

  // Cluster C spoke (session-timing): SC
  {
    slug: "south-carolina-technical-college-session-timing-guide",
    title:
      "SC Tech College Sessions: 83 Dates at Horry-Geo (2026)",
    description:
      "Horry-Georgetown publishes 83 distinct start dates per term; Greenville Tech 76. How SC's 16 tech colleges structure session length.",
    date: "2026-05-09",
    category: "session-timing",
    state: "sc",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "south-carolina", "technical-college", "8-week"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },
  // Cluster C spokes (session-timing): GA, FL
  {
    slug: "georgia-technical-college-session-timing-guide",
    title:
      "GA Tech Sessions: 195 Start Dates at Central GA Tech",
    description:
      "Central Georgia Tech runs 195 distinct start dates — the highest session diversity we've indexed, nearly 2.7x VCCS's most flexible campus.",
    date: "2026-05-10",
    category: "session-timing",
    state: "ga",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "georgia", "tcsg", "8-week", "workforce", "technical-college"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },
  {
    slug: "florida-community-college-session-timing-guide",
    title:
      "FL College Sessions: 111 Dates at SFS vs 4 at Valencia",
    description:
      "South Florida State runs 111 distinct start dates; Valencia runs 4 — with 5,672 sections. Rolling-start flexibility vs. high-density semesters.",
    date: "2026-05-10",
    category: "session-timing",
    state: "fl",
    author: "Community College Path",
    tags: ["sessions", "session-timing", "florida", "fcs", "8-week", "mini-mester", "summer"],
    cluster: "session-timing-guide",
    clusterRole: "spoke",
  },

  // Cluster E spokes (audit-at-college): BRCC, Brightpoint, Camp, CVCC, DCC
  {
    slug: "blue-ridge-community-college-audit-class-guide",
    title:
      "Audit a Class at Blue Ridge CC: Cost & How-To (2026)",
    description:
      "Blue Ridge CC in the Shenandoah Valley allows auditing at full credit cost — or free for VA residents 60+. Process across Weyers Cave and centers.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "brcc",
    author: "Community College Path",
    tags: ["auditing", "virginia", "brcc", "vccs", "senior-waiver", "shenandoah-valley"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Blue Ridge Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact admissions", text: "Email admissions@brcc.edu or call 540-234-9261 with the course code, section number, and location. They will confirm availability and handle any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal BRCC enrollment system. Admissions completes most audit registrations based on your email request." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Otherwise you pay full credit-equivalent rates." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline." },
      ],
    },
  },
  {
    slug: "brightpoint-community-college-audit-class-guide",
    title:
      "Audit a Class at Brightpoint CC: Cost & How-To (2026)",
    description:
      "Brightpoint CC (formerly John Tyler) serves the Tri-Cities region with two campuses. Auditing rules, cost (free for 60+), and how to apply.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "brightpoint",
    author: "Community College Path",
    tags: ["auditing", "virginia", "brightpoint", "vccs", "senior-waiver", "tri-cities"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Brightpoint Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact admissions and records", text: "Email admissionsandrecords@brightpoint.edu or call 804-796-4000 with the course code, section number, campus, and delivery mode. They will confirm availability and handle any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal Brightpoint enrollment system. The admissions and records office completes most audit registrations based on your email request." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Otherwise you pay full credit-equivalent rates." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline." },
      ],
    },
  },
  {
    slug: "camp-paul-d-camp-community-college-audit-class-guide",
    title:
      "Audit a Class at Paul D. Camp CC: Cost & How-To (2026)",
    description:
      "Paul D. Camp CC serves Western Tidewater with small classes and workforce programs. Auditing rules, cost (free for 60+), and how to enroll.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "camp",
    author: "Community College Path",
    tags: ["auditing", "virginia", "camp", "paul-d-camp", "vccs", "senior-waiver", "western-tidewater"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Paul D. Camp Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact admissions", text: "Email info@pdc.edu or call 757-569-6700 with the course code, section number, and campus. They will confirm availability and handle any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal Camp enrollment system. Admissions completes most audit registrations based on your email request." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Otherwise you pay full credit-equivalent rates." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline." },
      ],
    },
  },
  {
    slug: "central-virginia-community-college-audit-class-guide",
    title:
      "Audit a Class at Central VA CC: Cost & How-To (2026)",
    description:
      "CVCC serves the Lynchburg region from main campus plus Bedford and Amherst centers. Auditing rules, cost (free for 60+), and how to apply.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "cvcc",
    author: "Community College Path",
    tags: ["auditing", "virginia", "cvcc", "vccs", "senior-waiver", "lynchburg"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Central Virginia Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact student records", text: "Email studentrecords@centralvirginia.edu or call 434-832-7633 with the course code, section number, and campus. They will confirm availability and handle any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal CVCC enrollment system. Student records completes most audit registrations based on your email request." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Otherwise you pay full credit-equivalent rates." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline." },
      ],
    },
  },
  {
    slug: "danville-community-college-audit-class-guide",
    title:
      "Audit a Class at Danville CC: Cost & How-To (2026)",
    description:
      "DCC serves Southside Virginia with workforce programs and small classes. Auditing rules, cost (free for 60+), and how to enroll.",
    date: "2026-05-09",
    category: "senior-waivers",
    state: "va",
    college: "dcc",
    author: "Community College Path",
    tags: ["auditing", "virginia", "dcc", "danville", "vccs", "senior-waiver", "southside"],
    cluster: "audit-at-college-guide",
    clusterRole: "spoke",
    howTo: {
      name: "How to audit a class at Danville Community College",
      steps: [
        { name: "Apply for admission", text: "Apply through the VCCS portal at apply.vccs.edu. There is no separate auditor application — you apply as a regular student." },
        { name: "Contact admissions", text: "Email admissions@danville.edu or call 434-797-8467 with the course code, section number, and campus. They will confirm availability and handle any instructor-approval step." },
        { name: "Register for the course", text: "Register through the normal DCC enrollment system. Admissions completes most audit registrations based on your email request." },
        { name: "Pay tuition and fees", text: "Pay by the published deadline. If you are a senior using Virginia's 60+ tuition waiver, complete the waiver paperwork at the same time. Otherwise you pay full credit-equivalent rates." },
        { name: "Attend the course", text: "Once enrolled as an auditor, attend throughout the term. To switch between audit and credit status, file the request before the add/drop deadline." },
      ],
    },
  },

  // --- Cluster F spokes (hybrid-course-density): ME, MD, MA ---
  {
    slug: "maine-community-college-hybrid-density",
    title:
      "ME Hybrid Classes: 16.2%, 2nd Highest in East (2026)",
    description:
      "MCCS runs 16.2% hybrid sections statewide — second highest in the East. EMCC, SMCC, and YCCC each top 20%. What it means for MCCS students.",
    date: "2026-05-10",
    category: "course-format-density",
    state: "me",
    author: "Community College Path",
    tags: ["hybrid", "maine", "mccs", "course-format", "density", "adult-learners"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },
  {
    slug: "maryland-community-college-hybrid-density",
    title:
      "MD Hybrid Classes: Frederick CC at 63% (2026)",
    description:
      "MACC reports 13.7% hybrid sections statewide — but Frederick CC alone runs 63%. The state average hides extreme college-level variation.",
    date: "2026-05-10",
    category: "course-format-density",
    state: "md",
    author: "Community College Path",
    tags: ["hybrid", "maryland", "macc", "frederick", "course-format", "density"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },
  {
    slug: "massachusetts-community-college-hybrid-density",
    title:
      "MA Hybrid Classes: BHCC at 40%, State at 14.2% (2026)",
    description:
      "MassCC reports 14.2% hybrid sections statewide — but Bunker Hill CC alone runs 40%. What 'hybrid in MA' means depends on the college.",
    date: "2026-05-10",
    category: "course-format-density",
    state: "ma",
    author: "Community College Path",
    tags: ["hybrid", "massachusetts", "masscc", "bhcc", "course-format", "density"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },

  // --- Cluster G spokes (late-start-by-state): NH, GA, SC ---
  {
    slug: "new-hampshire-community-college-late-start-classes",
    title:
      "NH Late-Start Classes: 18%, Highest in the East (2026)",
    description:
      "CCSNH runs 18.1% late-start sections — highest in any East Coast CC system. LRCC, GBCC, WMCC, and MCCNH all top 21%. How to use the catalog.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "nh",
    author: "Community College Path",
    tags: ["late-start", "new-hampshire", "ccsnh", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "georgia-community-college-late-start-classes",
    title:
      "GA Late-Start Classes: TCSG 14.5%, 1,307 Sections (2026)",
    description:
      "TCSG runs 1,307 late-start sections across 22 colleges — the largest catalog on the East Coast. Albany Tech leads at 29.4%.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "ga",
    author: "Community College Path",
    tags: ["late-start", "georgia", "tcsg", "registration", "workforce", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "south-carolina-technical-college-late-start-classes",
    title:
      "SC Late-Start Classes: Piedmont Tech at 38% (2026)",
    description:
      "SC tech colleges run 11.8% late-start sections — but Piedmont Tech alone reports 38%, carrying 60% of the statewide catalog.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "sc",
    author: "Community College Path",
    tags: ["late-start", "south-carolina", "piedmont-tech", "registration", "workforce"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-10a: prereq spokes (RI, NY, PA) ---
  {
    slug: "rhode-island-community-college-prereq-bottlenecks",
    title:
      "RI Prereq Chains: CCRI's Single-College Bottleneck (2026)",
    description:
      "RI has one CC — CCRI. ENGL 0700 gates 262 downstream courses; the nursing chain runs 21 levels deep. How to sequence with no alternative campus.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "ri",
    author: "Community College Path",
    tags: ["prerequisites", "rhode-island", "ccri", "developmental", "bottlenecks", "course-sequence", "nursing"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "new-york-cuny-community-college-prereq-bottlenecks",
    title:
      "NY CUNY Prereq Chains: Max Depth 8, an Advantage (2026)",
    description:
      "Across CUNY's 7 CCs, max prereq chain depth is 8 — far below FL and SC's 21–22 levels. Co-requisite remediation explains the ceiling.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "ny",
    author: "Community College Path",
    tags: ["prerequisites", "new-york", "cuny", "developmental", "bottlenecks", "course-sequence", "co-requisite"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "pennsylvania-community-college-prereq-bottlenecks",
    title:
      "PA Prereq Chains: FNMT Math Gates Vocational Tech (2026)",
    description:
      "At CCP and across PA, FNMT developmental math — not English — drives the deepest chains. BMET reaches depth 12; DMI reaches depth 11.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "pa",
    author: "Community College Path",
    tags: ["prerequisites", "pennsylvania", "ccp", "developmental", "math", "bottlenecks", "vocational", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-10a: hybrid-density spokes (VA, SC, NC) ---
  {
    slug: "virginia-community-college-hybrid-density",
    title:
      "VA Hybrid Classes: Rural SW Leads at 35% (2026)",
    description:
      "VCCS runs 11.3% hybrid across 26,236 sections. Mountain Gateway leads at 35%; NRCC and WCC under 2%; NOVA at 17% is the largest by volume.",
    date: "2026-05-10",
    category: "planning",
    state: "va",
    author: "Community College Path",
    tags: ["hybrid", "virginia", "vccs", "online", "nova", "schedule", "format"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },
  {
    slug: "south-carolina-community-college-hybrid-density",
    title:
      "SC Hybrid Classes: Trident 23%, Greenville 0% (2026)",
    description:
      "SCCTCS runs 10.6% hybrid statewide. Trident Tech (23%) runs zero online; Greenville Tech (3,563 sections) and Midlands Tech both run 0% hybrid.",
    date: "2026-05-10",
    category: "planning",
    state: "sc",
    author: "Community College Path",
    tags: ["hybrid", "south-carolina", "scctcs", "trident", "online", "schedule", "format"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },
  {
    slug: "north-carolina-community-college-hybrid-density",
    title:
      "NC Hybrid Classes: 4.8%, Bimodal Distribution (2026)",
    description:
      "NCCCS has 55 colleges and 53,631 sections. Sandhills CC runs 31% hybrid; CPCC (4,982 sections) and Wake Tech (4,311 sections) both run 0%.",
    date: "2026-05-10",
    category: "planning",
    state: "nc",
    author: "Community College Path",
    tags: ["hybrid", "north-carolina", "ncccs", "sandhills", "wake-tech", "cpcc", "online", "schedule", "format"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-10a: late-start spokes (TN, MD, NC) ---
  {
    slug: "tennessee-community-college-late-start-classes",
    title:
      "TN Late-Start Classes: TBR at 7.8%, 1,157 Sections",
    description:
      "TBR's 12 CCs hold 1,157 late-start sections for fall 2026 — a 7.8% share. Chattanooga State leads at 26.4%; Pellissippi at 2.3%.",
    date: "2026-05-10",
    category: "planning",
    state: "tn",
    author: "Community College Path",
    tags: ["late-start", "tennessee", "tbr", "registration", "chattanooga-state", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "maryland-community-college-late-start-classes",
    title:
      "MD Late-Start Classes: AACC 14.9%, PGCC Volume (2026)",
    description:
      "MD's 12 tracked CCs hold 847 late-start sections for fall 2026 — a 9.0% share. AACC leads on rate at 14.9%; PGCC leads on volume with 267.",
    date: "2026-05-10",
    category: "planning",
    state: "md",
    author: "Community College Path",
    tags: ["late-start", "maryland", "aacc", "pgcc", "registration", "montgomery-college", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "north-carolina-community-college-late-start-classes",
    title:
      "NC Late-Start Classes: 9.6% Rate, Rural Leaders (2026)",
    description:
      "NC CCs hold 366 late-start sections in fall 2026 — a 9.6% share, above the East Coast average. College of Albemarle leads at 15.8%.",
    date: "2026-05-10",
    category: "planning",
    state: "nc",
    author: "Community College Path",
    tags: ["late-start", "north-carolina", "ncccs", "registration", "rural", "albemarle", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-10b: prereq spokes (DC, CT, NH) ---
  {
    slug: "district-of-columbia-community-college-prereq-bottlenecks",
    title:
      "DC Prereq Chains: UDC-CC Single-Institution (2026)",
    description:
      "UDC Community College is DC's sole CC. 100% of indexed courses carry explicit prereqs. MATH 151 gates 149 courses; architecture reaches depth 7.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "dc",
    author: "Community College Path",
    tags: ["prerequisites", "district-of-columbia", "udc", "developmental", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "connecticut-community-college-prereq-bottlenecks",
    title:
      "CT Prereq Chains: ENG 0930 Gates 200 Courses (2026)",
    description:
      "Across CT State's 12 campuses, ENG 0930 gates 200 downstream courses despite a max depth of only 5. Music, CMGT, and CSC chains run deep.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "ct",
    author: "Community College Path",
    tags: ["prerequisites", "connecticut", "ct-state", "developmental", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "new-hampshire-community-college-prereq-bottlenecks",
    title:
      "NH Prereq Chains: Radiologic Tech Dominates (2026)",
    description:
      "CCSNH's prereq structure is broadly shallow, but Radiologic Tech (RADT) chains reach depth 8 — the deepest in the system. Only 78 deep chains.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "nh",
    author: "Community College Path",
    tags: ["prerequisites", "new-hampshire", "ccsnh", "radiologic-technology", "bottlenecks", "course-sequence"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-10b: hybrid-density spokes (KY, AL, NY) ---
  {
    slug: "kentucky-community-college-hybrid-density",
    title:
      "KY Hybrid Classes: KCTCS 13.2%, Gateway 22.8% (2026)",
    description:
      "KCTCS runs 13.2% hybrid across 16,512 sections. Gateway CTC leads at 22.8%; Henderson CC runs 0%. Online at 48.2% dwarfs hybrid statewide.",
    date: "2026-05-10",
    category: "planning",
    state: "ky",
    author: "Community College Path",
    tags: ["hybrid", "kentucky", "kctcs", "gateway", "online", "schedule", "format", "workforce"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },
  {
    slug: "alabama-community-college-hybrid-density",
    title:
      "AL Hybrid Classes: Enterprise 35.6% vs Coastal 5.4%",
    description:
      "ACCS runs 10.9% hybrid across 8,883 sections. Enterprise State leads at 35.6% (Fort Novosel); Coastal AL runs 5.4% but holds 43% of sections.",
    date: "2026-05-10",
    category: "planning",
    state: "al",
    author: "Community College Path",
    tags: ["hybrid", "alabama", "accs", "enterprise-state", "coastal-alabama", "online", "schedule", "format"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },
  {
    slug: "new-york-community-college-hybrid-density",
    title:
      "NY Hybrid Classes: CUNY 6.2%, Kingsborough 17% (2026)",
    description:
      "CUNY's 7 CCs run 6.2% hybrid across 5,775 sections — below all East Coast peers. Kingsborough leads at 17%; BMCC and LaGuardia anchor near zero.",
    date: "2026-05-10",
    category: "planning",
    state: "ny",
    author: "Community College Path",
    tags: ["hybrid", "new-york", "cuny", "kingsborough", "bmcc", "laguardia", "online", "schedule", "format"],
    cluster: "hybrid-course-density-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-10b: late-start spokes (DE, RI, FL) ---
  {
    slug: "delaware-community-college-late-start-classes",
    title:
      "DE Late-Start Classes: Del Tech 12.5%, 12 Dates (2026)",
    description:
      "Del Tech is DE's sole CC — 275 late-start sections across 12 distinct dates, clustered in late September and mid-October windows.",
    date: "2026-05-10",
    category: "planning",
    state: "de",
    author: "Community College Path",
    tags: ["late-start", "delaware", "dtcc", "del-tech", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "rhode-island-community-college-late-start-classes",
    title:
      "RI Late-Start Classes: CCRI 12.8%, Only 4 Dates (2026)",
    description:
      "CCRI is RI's only CC — 240 late-start sections at 12.8%, but only 4 start dates. Missing one window shifts you weeks forward.",
    date: "2026-05-10",
    category: "planning",
    state: "ri",
    author: "Community College Path",
    tags: ["late-start", "rhode-island", "ccri", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "florida-community-college-late-start-classes",
    title:
      "FL Late-Start Classes: 42 Dates, 7.0% Rate (2026)",
    description:
      "FL's FCS holds 753 late-start sections across 8 colleges at 7.0% — with 42 distinct start dates. CFK leads at 22.4%; Valencia anchors volume.",
    date: "2026-05-10",
    category: "planning",
    state: "fl",
    author: "Community College Path",
    tags: ["late-start", "florida", "fcs", "valencia", "cfk", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-10c: prereq spokes (TN, VA, VT) ---
  {
    slug: "tennessee-community-college-prereq-bottlenecks",
    title:
      "TN Prereq Chains: ENGL 1010 Gates 64 Courses (2026)",
    description:
      "Across TBR's 12 CCs, ENGL 1010 gates 64 downstream courses. But CITC 1301 gates 31 — the non-obvious bottleneck. Agriculture chains reach depth 8.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "tn",
    author: "Community College Path",
    tags: ["prerequisites", "tennessee", "tbr", "developmental", "bottlenecks", "course-sequence", "cis"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "virginia-community-college-prereq-bottlenecks",
    title:
      "VA Prereq Chains: VCCS Has the Shallowest in US (2026)",
    description:
      "VCCS's max prereq depth is 4 — the shallowest in any multi-college system we've indexed. Only 19 deep chains across 292 prereq-bearing courses.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "va",
    author: "Community College Path",
    tags: ["prerequisites", "virginia", "vccs", "bottlenecks", "course-sequence", "shallow-chains"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "vermont-community-college-prereq-bottlenecks",
    title:
      "VT Prereq Chains: VTSU Post-Merger Structure (2026)",
    description:
      "VTSU merged CCV, Johnson, Lyndon, and Castleton in 2022. CIS 1100 and MAT 0310 tie as top bottlenecks at 15 each; STEM chains reach depth 5.",
    date: "2026-05-10",
    category: "mistake-avoidance",
    state: "vt",
    author: "Community College Path",
    tags: ["prerequisites", "vermont", "vtsu", "merger", "bottlenecks", "course-sequence", "stem"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-12: prereq spokes (NJ, MI, OH) ---
  {
    slug: "new-jersey-community-college-prereq-bottlenecks",
    title:
      "NJ Prereq Chains: Record 31-Level ESL-to-Nursing (2026)",
    description:
      "NJ's 12-college system holds the deepest prereq chain in the dataset — 31 levels from ESL 037 to NUR 216. ENG 087 gates 727 courses.",
    date: "2026-05-12",
    category: "mistake-avoidance",
    state: "nj",
    author: "Community College Path",
    tags: ["prerequisites", "new-jersey", "esl", "nursing", "bottlenecks", "course-sequence", "developmental"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "michigan-community-college-prereq-bottlenecks",
    title:
      "MI Prereq Chains: Reading Blocks Math, Math Blocks RN",
    description:
      "MI's ACRD 080 gates 710 downstream courses — more than any English course. Reading is the prereq for math, which is the prereq for nursing.",
    date: "2026-05-12",
    category: "mistake-avoidance",
    state: "mi",
    author: "Community College Path",
    tags: ["prerequisites", "michigan", "acrd", "reading", "nursing", "bottlenecks", "course-sequence", "developmental"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  {
    slug: "ohio-community-college-prereq-bottlenecks",
    title:
      "OH Prereq Chains: IDS 102 Gates 231 Courses (2026)",
    description:
      "Ohio's IDS 102 gates 231 downstream courses — more than any English course. The deepest chain reaches 16 levels through nursing's lec-lab-clinical.",
    date: "2026-05-12",
    category: "mistake-avoidance",
    state: "oh",
    author: "Community College Path",
    tags: ["prerequisites", "ohio", "ids", "nursing", "bottlenecks", "course-sequence", "health-sciences"],
    cluster: "prereq-chains-guide",
    clusterRole: "spoke",
  },
  // --- Pipeline batch 2026-05-10c: late-start spokes (KY, MS, MA) ---
  {
    slug: "kentucky-community-college-late-start-classes",
    title:
      "KY Late-Start Classes: KCTCS 14.9%, E-town 39.7% (2026)",
    description:
      "KCTCS runs 14.9% late-start across 13,048 sections — highest in our dataset. Elizabethtown CTC leads at 39.7%; Jefferson and Bluegrass at ~9%.",
    date: "2026-05-10",
    category: "planning",
    state: "ky",
    author: "Community College Path",
    tags: ["late-start", "kentucky", "kctcs", "elizabethtown", "registration", "workforce", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "mississippi-community-college-late-start-classes",
    title:
      "MS Late-Start Classes: Meridian CC 9.1%, 16 Dates (2026)",
    description:
      "Meridian CC is the only MS institution we track — 71 late-start sections at 9.1%, across 16 distinct dates between Sep 15 and Nov 16.",
    date: "2026-05-10",
    category: "planning",
    state: "ms",
    author: "Community College Path",
    tags: ["late-start", "mississippi", "meridian", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "massachusetts-community-college-late-start-classes",
    title:
      "MA Late-Start Classes: Middlesex Leads, STCC Zero (2026)",
    description:
      "MA's 6 tracked CCs hold 389 late-start sections at 7.5% — but STCC runs 0% across 1,087 sections. Middlesex leads at 10.9%; BHCC at 10.8%.",
    date: "2026-05-10",
    category: "planning",
    state: "ma",
    author: "Community College Path",
    tags: ["late-start", "massachusetts", "middlesex", "bhcc", "stcc", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "vermont-community-college-late-start-classes",
    title:
      "VT Late-Start Classes: VTSU 6.8% Rate (2026)",
    description:
      "VTSU runs Vermont's only community college track. Fall 2026: 112 late-start sections, 6.8% rate, 8 dates from mid-Sept to early Nov.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "vt",
    author: "Community College Path",
    tags: ["late-start", "vermont", "vtsu", "ccv", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "alabama-community-college-late-start-classes",
    title:
      "AL Late-Start Classes: 5.3%, 16 Distinct Dates (2026)",
    description:
      "ACCS fall 2026: 236 late-start sections at 5.3% across 6 colleges. Chattahoochee Valley and Enterprise State lead at 9.6%; Wallace–Dothan at 3.4%.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "al",
    author: "Community College Path",
    tags: ["late-start", "alabama", "accs", "enterprise-state", "coastal-alabama", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
  {
    slug: "district-of-columbia-community-college-late-start-classes",
    title:
      "DC Late-Start Classes: UDC-CC 5.6%, 6 Entry Points (2026)",
    description:
      "UDC Community College is DC's only public two-year. Fall 2026: 59 late-start sections at 5.6%, 6 distinct dates including a Sep 22–28 rescue window.",
    date: "2026-05-10",
    category: "registration-timing",
    state: "dc",
    author: "Community College Path",
    tags: ["late-start", "district-of-columbia", "udc-cc", "registration", "adult-learners"],
    cluster: "late-start-by-state-guide",
    clusterRole: "spoke",
  },
];
