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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
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
    author: "CC CourseMap",
    tags: ["registration", "schedule", "timing", "course-catalog"],
  },
];
